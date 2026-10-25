import "server-only";
import { eq } from "drizzle-orm";
import { connection } from "next/server";
import { cache } from "react";
import { getDb } from "@/db";
import { appSettings } from "@/db/schema";
import { DEFAULT_FEES, SELL_TAX_RATE, type FeeRates } from "./market";

/** Tỷ lệ phí đang dùng: lấy từ Cài đặt, chưa lưu thì dùng mặc định. Đọc 1 lần mỗi request. */
export const getFeeRates = cache(async (): Promise<FeeRates> => {
  // Đọc lúc có request (giống các hàm đọc dữ liệu khác), không prerender lúc build
  await connection();
  const db = await getDb();
  const [row] = await db.select().from(appSettings).where(eq(appSettings.id, 1));
  return {
    buy: row?.buyFeeRate ?? DEFAULT_FEES.buy,
    sell: row?.sellFeeRate ?? DEFAULT_FEES.sell,
    tax: SELL_TAX_RATE,
  };
});

export async function saveFeeRates(buy: number, sell: number): Promise<void> {
  const db = await getDb();
  await db
    .insert(appSettings)
    .values({ id: 1, buyFeeRate: buy, sellFeeRate: sell })
    .onConflictDoUpdate({ target: appSettings.id, set: { buyFeeRate: buy, sellFeeRate: sell, updatedAt: new Date() } });
}
