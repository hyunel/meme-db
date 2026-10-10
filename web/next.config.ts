import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // The browser talks to the API through this origin; BACKEND_BASE is the API server.
  rewrites: async () => [
    {
      source: '/api/:path*',
      destination: `${process.env.BACKEND_BASE ?? 'http://localhost:8080'}/api/:path*`,
    },
  ],
}

export default nextConfig
