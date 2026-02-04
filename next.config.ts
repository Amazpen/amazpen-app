import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Output standalone for Docker deployment
  output: 'standalone',

  // Allow external images
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.cdn.bubble.io',
      },
    ],
  },

  // Configure webpack to handle PDF.js worker
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    config.resolve.alias.encoding = false;
    return config;
  },
};

export default nextConfig;
