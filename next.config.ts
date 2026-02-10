import type { NextConfig } from "next";
import { writeFileSync, readFileSync } from "fs";
import { join } from "path";

// Inject build timestamp into sw.js so the browser detects a new version on each deploy
const swPath = join(process.cwd(), "public", "sw.js");
try {
  let swContent = readFileSync(swPath, "utf-8");
  // Replace or add the BUILD_TIME comment at the top
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

  // Empty turbopack config to silence warning about webpack config
  turbopack: {},
};

export default nextConfig;
