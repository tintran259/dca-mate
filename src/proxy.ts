import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (await verifySessionToken(token)) return NextResponse.next();

  const url = new URL("/login", request.url);
  const next = request.nextUrl.pathname + request.nextUrl.search;
  if (next !== "/") url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

export const config = {
  // Bỏ qua trang đăng nhập, route cron (tự kiểm tra CRON_SECRET), file tĩnh và file SEO
  // (robots, sitemap, ảnh Open Graph, icon iOS) để công cụ tìm kiếm, mạng xã hội đọc được khi bật mật khẩu
  matcher: ["/((?!login|api/cron|_next/static|_next/image|favicon.ico|icon|apple-icon|opengraph-image|robots.txt|sitemap.xml|manifest|.*\\.(?:svg|png|ico|webmanifest)$).*)"],
};
