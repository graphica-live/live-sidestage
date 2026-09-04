// @ts-check
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    instrumentationHook: true,
    serverComponentsExternalPackages: ["TLC-sidestage", "ws", "bufferutil", "utf-8-validate"],
  },
};

export default nextConfig;
