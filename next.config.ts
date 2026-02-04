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

  // Configure Turbopack to handle PDF.js dependencies
  turbopack: {
    resolveAlias: {
      canvas: false,
      encoding: false,
    },
  },

  // Fallback webpack config for older builds
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    config.resolve.alias.encoding = false;
    return config;
  },
};

export default nextConfig;
