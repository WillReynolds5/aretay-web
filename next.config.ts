import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/", destination: "/index.html" },
      { source: "/privacy", destination: "/privacy.html" },
      { source: "/support", destination: "/support.html" },
    ];
  },
};

export default nextConfig;
