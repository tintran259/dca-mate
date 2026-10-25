import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // E2E build vào thư mục riêng để không đụng .next của `next dev` đang chạy
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // tsconfig riêng cho E2E đã khai báo sẵn thư mục .next-e2e, để Next không tự sửa tsconfig.json
  ...(process.env.NEXT_DIST_DIR && { typescript: { tsconfigPath: "tsconfig.e2e.json" } }),
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
