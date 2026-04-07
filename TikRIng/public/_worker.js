import { onRequestGet as healthGet } from '../functions/api/health';

import { onRequestPost as uploadPost } from '../functions/api/upload';
import { onRequestPost as sharePost } from '../functions/api/share/index';
import { onRequestGet as shareThumbnailGet } from '../functions/api/share/thumbnail/[id].png';

import {
  onRequestGet as framesIndexGet,
  onRequestDelete as framesIndexDelete,
  onRequestPut as framesIndexPut,
} from '../functions/api/frames/index';
import {
  onRequestGet as framesGet,
  onRequestPost as framesPost,
} from '../functions/api/frames/[id]';

import { onRequestPost as checkoutPost } from '../functions/api/checkout/index';
import { onRequestPost as donatePost } from '../functions/api/checkout/donate';
import { onRequestPost as cancelPost } from '../functions/api/checkout/cancel';
import { onRequestPost as syncPost } from '../functions/api/checkout/sync';
import { onRequestPost as webhookPost } from '../functions/api/checkout/webhook';

import { onRequestPost as cleanupPost } from '../functions/api/admin/cleanup';

import { onRequestGet as meGet, onRequestPost as mePost } from '../functions/api/auth/me';
import { onRequestPost as displayNamePost } from '../functions/api/auth/display-name';
import { onRequestPost as logoutPost } from '../functions/api/auth/logout';
import { onRequestGet as googleAuthGet } from '../functions/api/auth/google';
import { onRequestGet as googleCallbackGet } from '../functions/api/auth/google/callback';
import { onRequestGet as lineAuthGet } from '../functions/api/auth/line';
import { onRequestGet as lineCallbackGet } from '../functions/api/auth/line/callback';

function notFound() {
  return new Response('Not Found', { status: 404 });
}

function methodNotAllowed() {
  return new Response('Method Not Allowed', { status: 405 });
}

function buildListenerMeta(request, frameId) {
  const url = new URL(request.url);
  const pageUrl = new URL(url.pathname, url.origin);
  pageUrl.searchParams.set('f', frameId);

  const imageUrl = new URL(`/api/share/thumbnail/${encodeURIComponent(frameId)}.png`, url.origin);

  return {
    title: 'TikRing - アイコンを着せ替えよう！',
    description: 'ライバーが作成した専用フレームをあなたのアイコンに重ねて応援しよう！',
    pageUrl: pageUrl.toString(),
    imageUrl: imageUrl.toString(),
  };
}

function isDashboardRequest(request, response) {
  const url = new URL(request.url);
  return url.searchParams.get('dashboard') === '1' && response.headers.get('content-type')?.includes('text/html');
}

function applyCacheHeaders(request, response) {
  const headers = new Headers(response.headers);

  if (isDashboardRequest(request, response)) {
    headers.set('Cache-Control', 'private, max-age=300, stale-while-revalidate=60');
    headers.delete('Pragma');
    headers.delete('Expires');
  } else {
    headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    headers.set('Pragma', 'no-cache');
    headers.set('Expires', '0');
    headers.delete('ETag');
    headers.delete('Last-Modified');
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function makeContext(request, env, ctx, params = {}) {
  return {
    request,
    env,
    params,
    waitUntil: (promise) => ctx.waitUntil(promise),
  };
}

async function routeApi(request, env, ctx) {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method.toUpperCase();

  // /api/health
  if (pathname === '/api/health') {
    if (method !== 'GET') return methodNotAllowed();
    return healthGet(makeContext(request, env, ctx));
  }

  // /api/upload
  if (pathname === '/api/upload') {
    if (method !== 'POST') return methodNotAllowed();
    return uploadPost(makeContext(request, env, ctx));
  }

  // /api/share
  if (pathname === '/api/share') {
    if (method !== 'POST') return methodNotAllowed();
    return sharePost(makeContext(request, env, ctx));
  }

  // /api/share/thumbnail/:id.png
  if (pathname.startsWith('/api/share/thumbnail/')) {
    const suffix = pathname.slice('/api/share/thumbnail/'.length);
    if (!suffix.endsWith('.png')) return notFound();
    const id = suffix.slice(0, -4);
    if (!id) return notFound();
    if (method !== 'GET') return methodNotAllowed();
    return shareThumbnailGet(makeContext(request, env, ctx, { id }));
  }

  // /api/frames
  if (pathname === '/api/frames') {
    if (method === 'GET') return framesIndexGet(makeContext(request, env, ctx));
    if (method === 'DELETE') return framesIndexDelete(makeContext(request, env, ctx));
    if (method === 'PUT') return framesIndexPut(makeContext(request, env, ctx));
    return methodNotAllowed();
  }

  // /api/frames/:id
  if (pathname.startsWith('/api/frames/')) {
    const id = pathname.slice('/api/frames/'.length);
    if (!id) return notFound();
    if (method === 'GET') return framesGet(makeContext(request, env, ctx, { id }));
    if (method === 'POST') return framesPost(makeContext(request, env, ctx, { id }));
    return methodNotAllowed();
  }

  // /api/checkout
  if (pathname === '/api/checkout') {
    if (method !== 'POST') return methodNotAllowed();
    return checkoutPost(makeContext(request, env, ctx));
  }

  // /api/checkout/donate
  if (pathname === '/api/checkout/donate') {
    if (method !== 'POST') return methodNotAllowed();
    return donatePost(makeContext(request, env, ctx));
  }

  // /api/checkout/cancel
  if (pathname === '/api/checkout/cancel') {
    if (method !== 'POST') return methodNotAllowed();
    return cancelPost(makeContext(request, env, ctx));
  }

  // /api/checkout/sync
  if (pathname === '/api/checkout/sync') {
    if (method !== 'POST') return methodNotAllowed();
    return syncPost(makeContext(request, env, ctx));
  }

  // /api/checkout/webhook
  if (pathname === '/api/checkout/webhook') {
    if (method !== 'POST') return methodNotAllowed();
    return webhookPost(makeContext(request, env, ctx));
  }

  // /api/admin/cleanup
  if (pathname === '/api/admin/cleanup') {
    if (method !== 'POST') return methodNotAllowed();
    return cleanupPost(makeContext(request, env, ctx));
  }

  // /api/auth/*
  if (pathname === '/api/auth/me') {
    if (method === 'GET') return meGet(makeContext(request, env, ctx));
    if (method === 'POST') return mePost(makeContext(request, env, ctx));
    return methodNotAllowed();
  }

  if (pathname === '/api/auth/display-name') {
    if (method !== 'POST') return methodNotAllowed();
    return displayNamePost(makeContext(request, env, ctx));
  }

  if (pathname === '/api/auth/logout') {
    if (method !== 'POST') return methodNotAllowed();
    return logoutPost(makeContext(request, env, ctx));
  }

  if (pathname === '/api/auth/google') {
    if (method !== 'GET') return methodNotAllowed();
    return googleAuthGet(makeContext(request, env, ctx));
  }

  if (pathname === '/api/auth/google/callback') {
    if (method !== 'GET') return methodNotAllowed();
    return googleCallbackGet(makeContext(request, env, ctx));
  }

  if (pathname === '/api/auth/line') {
    if (method !== 'GET') return methodNotAllowed();
    return lineAuthGet(makeContext(request, env, ctx));
  }

  if (pathname === '/api/auth/line/callback') {
    if (method !== 'GET') return methodNotAllowed();
    return lineCallbackGet(makeContext(request, env, ctx));
  }

  return notFound();
}

function maybeRewriteListenerHtml(request, response) {
  const url = new URL(request.url);
  const frameId = url.searchParams.get('f');
  const contentType = response.headers.get('content-type') || '';

  if (!frameId) return response;
  if (!contentType.includes('text/html')) return response;

  const listenerMeta = buildListenerMeta(request, frameId);
  const newTitle = listenerMeta.title;
  const newDescription = listenerMeta.description;

  return new HTMLRewriter()
    .on('title', {
      element(element) {
        element.setInnerContent(newTitle);
      },
    })
    .on('meta', {
      element(element) {
        const property = element.getAttribute('property');
        const name = element.getAttribute('name');

        if (name === 'description') {
          element.remove();
          return;
        }

        if (
          property === 'og:title'
          || property === 'og:description'
          || property === 'og:type'
          || property === 'og:url'
          || property === 'og:image'
          || property === 'og:image:url'
          || property === 'og:image:secure_url'
          || property === 'og:image:type'
          || property === 'og:image:width'
          || property === 'og:image:height'
          || property === 'og:image:alt'
          || property === 'og:site_name'
          || name === 'twitter:card'
          || name === 'twitter:title'
          || name === 'twitter:description'
          || name === 'twitter:image'
        ) {
          element.remove();
        }
      },
    })
    .on('link', {
      element(element) {
        if (element.getAttribute('rel') === 'canonical') {
          element.remove();
        }
      },
    })
    .on('head', {
      element(element) {
        element.append(`<meta name="description" content="${newDescription}" />`, { html: true });
        element.append(`<link rel="canonical" href="${listenerMeta.pageUrl}" />`, { html: true });
        element.append(`<meta property="og:title" content="${newTitle}" />`, { html: true });
        element.append(`<meta property="og:description" content="${newDescription}" />`, { html: true });
        element.append(`<meta property="og:type" content="website" />`, { html: true });
        element.append(`<meta property="og:url" content="${listenerMeta.pageUrl}" />`, { html: true });
        element.append(`<meta property="og:image" content="${listenerMeta.imageUrl}" />`, { html: true });
        element.append(`<meta property="og:image:url" content="${listenerMeta.imageUrl}" />`, { html: true });
        element.append(`<meta property="og:image:secure_url" content="${listenerMeta.imageUrl}" />`, { html: true });
        element.append(`<meta property="og:image:type" content="image/png" />`, { html: true });
        element.append(`<meta property="og:image:width" content="1200" />`, { html: true });
        element.append(`<meta property="og:image:height" content="630" />`, { html: true });
        element.append(`<meta property="og:image:alt" content="TikRing listener frame preview" />`, { html: true });
        element.append(`<meta property="og:site_name" content="TikRing" />`, { html: true });
        element.append(`<meta name="twitter:card" content="summary_large_image" />`, { html: true });
        element.append(`<meta name="twitter:title" content="${newTitle}" />`, { html: true });
        element.append(`<meta name="twitter:description" content="${newDescription}" />`, { html: true });
        element.append(`<meta name="twitter:image" content="${listenerMeta.imageUrl}" />`, { html: true });
      },
    })
    .transform(response);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      return applyCacheHeaders(request, await routeApi(request, env, ctx));
    }

    // Static assets / SPA
    if (!env.ASSETS || typeof env.ASSETS.fetch !== 'function') {
      return new Response('ASSETS binding is missing', { status: 500 });
    }

    const response = await env.ASSETS.fetch(request);
    return applyCacheHeaders(request, maybeRewriteListenerHtml(request, response));
  },

  async scheduled(event, env, ctx) {
    const token = env.CLEANUP_TOKEN;
    if (!token) return;

    const nowMs = Date.now();
    const rows = await env.DB.prepare(
      'SELECT id, image_key FROM frames WHERE expires_at IS NOT NULL AND expires_at < ? ORDER BY expires_at ASC LIMIT 500'
    )
      .bind(nowMs)
      .all();

    const expired = rows.results ?? [];
    for (const row of expired) {
      try {
        await env.FRAMES_BUCKET.delete(row.image_key);
        await env.FRAMES_BUCKET.delete(`previews/${row.id}.png`);
      } catch {
        continue;
      }
      try {
        await env.DB.prepare('DELETE FROM share_urls WHERE frame_id = ?').bind(row.id).run();
        await env.DB.prepare('DELETE FROM frames WHERE id = ?').bind(row.id).run();
      } catch {
        // best-effort
      }
    }
  },
};
