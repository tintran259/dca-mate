import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

// Chỉ trang đăng nhập là công khai. Các trang khác là danh mục cá nhân: không cho crawl
// (nếu để trống APP_PASSWORD, danh mục có thể lộ lên kết quả tìm kiếm).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/login", disallow: ["/", "/api/"] },
    sitemap: new URL("/sitemap.xml", siteUrl()).toString(),
  };
}
