import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // E2E build vào thư mục riêng để không đụng .next của `next dev` đang chạy
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // tsconfig riêng cho E2E đã khai báo sẵn thư mục .next-e2e, để Next không tự sửa tsconfig.json
  ...(process.env.NEXT_DIST_DIR && { typescript: { tsconfigPath: "tsconfig.e2e.json" } }),
  // PGlite chỉ dùng khi chạy local, không bundle vào server
  serverExternalPackages: ["@electric-sql/pglite"],
  cacheComponents: true,
  experimental: {
    // Chuyển qua lại giữa các trang trong 5 phút thì dùng lại dữ liệu đã tải, không gọi server.
    // Giá do cron cập nhật ngầm; ghi lệnh, sửa kế hoạch, cập nhật giá đều gọi revalidatePath nên vẫn thấy ngay.
    staleTimes: { dynamic: 300 },
  },
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
