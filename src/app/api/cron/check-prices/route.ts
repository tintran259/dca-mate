import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/auth";
import { runPriceCheck } from "@/lib/check";
import { isTradingHours } from "@/lib/market";

// cron-job.org gọi vào đây mỗi 5 phút:
//   GET /api/cron/check-prices   với header  Authorization: Bearer <CRON_SECRET>
//   (hoặc ?secret=<CRON_SECRET> nếu dịch vụ cron không cho đặt header)
// Thêm ?force=1 để chạy cả ngoài giờ giao dịch.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  const provided = auth?.replace(/^Bearer\s+/i, "") ?? request.nextUrl.searchParams.get("secret");
  if (!secret || !provided || !safeEqual(provided, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!isTradingHours() && request.nextUrl.searchParams.get("force") !== "1") {
    return NextResponse.json({ skipped: "Ngoài giờ giao dịch" });
  }

  const summary = await runPriceCheck();
  return NextResponse.json(summary);
}
