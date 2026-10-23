import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite chỉ dùng khi chạy local, không bundle vào server
  serverExternalPackages: ["@electric-sql/pglite"],
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
