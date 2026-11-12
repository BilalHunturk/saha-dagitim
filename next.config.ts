import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every page is per-user and cookie-dependent; no cached static shells.
  cacheComponents: false,
  partialPrefetching: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
