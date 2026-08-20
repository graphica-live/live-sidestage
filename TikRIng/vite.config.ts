import { Readable } from 'node:stream'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const DEFAULT_LOCAL_API_ORIGIN = 'http://127.0.0.1:8788'
const READ_ONLY_METHODS = new Set(['GET', 'HEAD'])
const READ_ONLY_BYPASS_PREFIXES = ['/api/auth', '/api/checkout']

function shouldBypassReadOnlyProxy(urlPath: string) {
  return READ_ONLY_BYPASS_PREFIXES.some((prefix) => urlPath === prefix || urlPath.startsWith(`${prefix}/`))
}

function createReadOnlyApiProxyPlugin(readOnlyApiOrigin: string): Plugin {
  const targetOrigin = readOnlyApiOrigin.replace(/\/$/, '')

  return {
    name: 'readonly-api-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const method = req.method?.toUpperCase() ?? 'GET'
        const urlPath = req.url ?? '/'

        if (!READ_ONLY_METHODS.has(method) || !urlPath.startsWith('/api/') || shouldBypassReadOnlyProxy(urlPath)) {
          next()
          return
        }

        try {
          const targetUrl = new URL(urlPath, targetOrigin)
          const upstreamHeaders = new Headers()

          for (const [key, value] of Object.entries(req.headers)) {
            if (typeof value === 'string') {
              upstreamHeaders.set(key, value)
              continue
            }

            if (Array.isArray(value)) {
              upstreamHeaders.set(key, value.join(', '))
            }
          }

          upstreamHeaders.set('host', targetUrl.host)

          const upstreamResponse = await fetch(targetUrl, {
            method,
            headers: upstreamHeaders,
            redirect: 'manual',
          })

          res.statusCode = upstreamResponse.status
          upstreamResponse.headers.forEach((value, key) => {
            res.setHeader(key, value)
          })

          if (method === 'HEAD' || !upstreamResponse.body) {
            res.end()
            return
          }

          Readable.fromWeb(upstreamResponse.body).pipe(res)
        } catch (error) {
          console.error('Read-only API proxy failed:', error)
          res.statusCode = 502
          res.end('Read-only API proxy failed')
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const localApiOrigin = env.VITE_LOCAL_API_ORIGIN?.trim() || DEFAULT_LOCAL_API_ORIGIN
  const readOnlyApiOrigin = env.VITE_READONLY_API_ORIGIN?.trim() || ''

  return {
    plugins: [
      react(),
      tailwindcss(),
      ...(readOnlyApiOrigin ? [createReadOnlyApiProxyPlugin(readOnlyApiOrigin)] : []),
    ],
    server: {
      proxy: {
        '/api': {
          target: localApiOrigin,
          changeOrigin: true,
        },
      },
    },
  }
})
