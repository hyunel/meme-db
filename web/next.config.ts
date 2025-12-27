import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  rewrites: async () => {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.BACKEND_BASE}/api/:path*`,
      },
    ];
  },
  turbopack: {
    rules: {
      '*.worker.js': {
        loaders: ['url-loader']
      }
    }
  }
};

export default nextConfig;
