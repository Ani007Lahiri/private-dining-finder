import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The seed dataset is imported directly by server code; keep it out of the client bundle.
  experimental: { serverSourceMaps: false },
}

export default nextConfig
