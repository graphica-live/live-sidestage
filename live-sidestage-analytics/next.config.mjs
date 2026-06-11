/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    instrumentationHook: true,
  },
  serverExternalPackages: ["tiktok-live-connector", "ws", "bufferutil", "utf-8-validate"],
};

export default nextConfig;
