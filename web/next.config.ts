import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone', // Self-contained server for the Docker image
  allowedDevOrigins: ['10.*.*.*'],

  rewrites: async () => [
    {
      source: '/api/:path*',
      destination: `${process.env.BACKEND_BASE ?? 'http://localhost:8080'}/api/:path*`,
    },
  ],
}

export default nextConfig
