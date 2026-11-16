import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // The dev indicator floats at bottom-left by default, where the sidebar's
  // sign-out button sits, and intercepts its clicks in Playwright runs.
  devIndicators: false,
  cacheComponents: true,
  partialPrefetching: true,
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
