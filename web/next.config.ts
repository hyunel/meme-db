import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  rewrites: async () => {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.BACKEND_BASE}/api/:path*`,
      },
    ];
  }
};

export default nextConfig;
