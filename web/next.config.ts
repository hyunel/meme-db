import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone', // Self-contained server for the Docker image
  allowedDevOrigins: ['10.*.*.*'],
  // Metadata in the head for every client, not streamed after the body: pages wait for the same data anyway.
  htmlLimitedBots: /.*/,
}

export default nextConfig
