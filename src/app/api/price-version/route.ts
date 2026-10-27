import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { alerts, positions } from "@/db/schema";

// Trình duyệt hỏi định kỳ để biết giá đã được cron cập nhật ngầm chưa (xem PriceAutoRefresh).
// "Phiên bản" = lần cập nhật giá và lần tạo cảnh báo gần nhất; đổi là trang đang xem còn giữ giá cũ.
// Nằm sau proxy nên cũng cần đăng nhập như các trang khác.
export async function GET() {
  const db = await getDb();
  const [[price], [alert]] = await Promise.all([
    db.select({ at: sql<string | null>`max(${positions.lastPriceAt})::text` }).from(positions),
    db.select({ at: sql<string | null>`max(${alerts.createdAt})::text` }).from(alerts),
  ]);
  const version = `${price?.at ?? ""}|${alert?.at ?? ""}`;
  return NextResponse.json({ version }, { headers: { "Cache-Control": "no-store" } });
}
