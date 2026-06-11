/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    instrumentationHook: true,
    serverComponentsExternalPackages: ["tiktok-live-connector", "ws", "bufferutil", "utf-8-validate"],
  },
};

export default nextConfig;
