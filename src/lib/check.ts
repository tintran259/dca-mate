import "server-only";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { alerts, planLevels, positions } from "@/db/schema";
import { evaluatePrice } from "./calc";
import { getFeeRates } from "./fees";
import type { FeeRates } from "./market";
import { getOpenPositions, type PositionView } from "./data";
import { fetchPrices } from "./prices";
import { sendTelegram } from "./telegram";

export type CheckSummary = {
  checked: number;
  updated: string[];
  missing: string[];
  alerts: string[];
  errors: string[];
  telegram: "sent" | "skipped" | "failed" | "none";
};

/** Ghi giá mới cho 1 vị thế, so với kế hoạch, lưu cảnh báo. Trả về nội dung các cảnh báo mới. */
async function applyPrice(view: PositionView, price: number, fees: FeeRates): Promise<string[]> {
  const db = await getDb();
  const { position, holding } = view;
  const { events, peakPrice } = evaluatePrice(position, holding, view.levels, price, fees);
  const now = new Date();

  await db
    .update(positions)
    .set({
      lastPrice: price,
      lastPriceAt: now,
      peakPrice,
      ...(events.some((e) => e.kind === "stop") && { stopNotifiedAt: now }),
      ...(events.some((e) => e.kind === "trail") && { trailNotifiedPeak: peakPrice }),
    })
    .where(eq(positions.id, position.id));

  if (events.length === 0) return [];

  await db.insert(alerts).values(
    events.map((e) => ({
      positionId: position.id,
      levelId: e.levelId,
      kind: e.kind,
      price,
      message: e.message,
    })),
  );

  const levelIds = events.flatMap((e) => (e.levelId ? [e.levelId] : []));
  if (levelIds.length > 0) {
    await db
      .update(planLevels)
      .set({ status: "notified", notifiedAt: now })
      .where(inArray(planLevels.id, levelIds));
  }

  return events.map((e) => e.message);
}

async function notify(messages: string[]): Promise<CheckSummary["telegram"]> {
  if (messages.length === 0) return "none";
  if (!process.env.TELEGRAM_BOT_TOKEN) return "skipped";
  const res = await sendTelegram(messages.join("\n\n"));
  return res.ok ? "sent" : "failed";
}

/** Lấy giá mới nhất cho mọi vị thế đang mở và gửi cảnh báo nếu chạm nấc. */
export async function runPriceCheck(): Promise<CheckSummary> {
  const views = (await getOpenPositions()).filter((v) => v.holding.quantity > 0);
  const summary: CheckSummary = {
    checked: views.length,
    updated: [],
    missing: [],
    alerts: [],
    errors: [],
    telegram: "none",
  };
  if (views.length === 0) return summary;

  const [{ prices, errors }, fees] = await Promise.all([fetchPrices(views.map((v) => v.position.symbol)), getFeeRates()]);
  summary.errors = errors;

  for (const view of views) {
    const price = prices.get(view.position.symbol);
    if (!price) {
      summary.missing.push(view.position.symbol);
      continue;
    }
    summary.updated.push(view.position.symbol);
    summary.alerts.push(...(await applyPrice(view, price, fees)));
  }

  summary.telegram = await notify(summary.alerts);
  return summary;
}

/** Nhập giá tay cho 1 mã (khi nguồn giá lỗi hoặc muốn thử kịch bản). */
export async function applyManualPrice(positionId: number, price: number) {
  const view = (await getOpenPositions()).find((v) => v.position.id === positionId);
  if (!view) return { alerts: [] as string[], telegram: "none" as const };
  const messages = await applyPrice(view, price, await getFeeRates());
  return { alerts: messages, telegram: await notify(messages) };
}
