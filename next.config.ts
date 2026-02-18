import type { NextConfig } from "next";
import { writeFileSync, readFileSync } from "fs";
import { join } from "path";

// Inject build timestamp into sw.js only during production build (not dev)
if (process.env.NODE_ENV === "production") {
  const swPath = join(process.cwd(), "public", "sw.js");
  try {
    let swContent = readFileSync(swPath, "utf-8");
    const buildTime = `// BUILD_TIME=${Date.now()}`;
    if (swContent.startsWith("// BUILD_TIME=")) {
      swContent = swContent.replace(/^\/\/ BUILD_TIME=\d+/, buildTime);
    } else {
      swContent = buildTime + "\n" + swContent;
    }
    writeFileSync(swPath, swContent);
  } catch {
    // Ignore errors (e.g., in CI without sw.js)
  }
}

const nextConfig: NextConfig = {
  // Output standalone for Docker deployment
  output: 'standalone',

  // Ensure sw.js and manifest.json are never cached by proxies/CDN
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, must-revalidate',
          },
          {
            key: 'Service-Worker-Allowed',
            value: '/',
          },
        ],
      },
      {
        source: '/manifest.json',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, must-revalidate',
          },
        ],
      },
      {
        source: '/.well-known/assetlinks.json',
        headers: [
          {
            key: 'Content-Type',
            value: 'application/json',
          },
          {
            key: 'Cache-Control',
            value: 'public, max-age=3600',
          },
        ],
      },
    ];
  },

  // Allow external images
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.cdn.bubble.io',
      },
      {
        protocol: 'https',
        hostname: 'db.amazpenbiz.co.il',
      },
    ],
  },

  // Empty turbopack config to silence warning about webpack config
  turbopack: {},
};

export default nextConfig;
