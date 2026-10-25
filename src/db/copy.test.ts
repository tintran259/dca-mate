import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import { compareCounts, copyDatabase } from "./copy";
import type { DB } from "./index";
import * as schema from "./schema";

async function freshDb(): Promise<DB> {
  const db = drizzle({ client: new PGlite(), schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  return db as unknown as DB;
}

let source: DB;
let target: DB;

beforeEach(async () => {
  [source, target] = await Promise.all([freshDb(), freshDb()]);
  // Dữ liệu mẫu, có id nhảy cóc như sau khi xóa bớt
  await source.insert(schema.positions).values([
    { id: 3, symbol: "CTG", exchange: "HOSE", lastPrice: 30_950 },
    { id: 7, symbol: "MBB", exchange: "HOSE", status: "closed" },
  ]);
  await source.insert(schema.planLevels).values([
    { id: 10, positionId: 3, kind: "dca", pct: -10, quantity: 1000 },
    { id: 11, positionId: 3, kind: "tp", pct: 10, sellPct: 50, status: "done", filledPrice: 36_150 },
  ]);
  await source.insert(schema.transactions).values([
    { id: 20, positionId: 3, side: "buy", tradeDate: "2026-10-20", price: 34_000, quantity: 100, fee: 5_100, levelId: null },
    { id: 21, positionId: 7, side: "buy", tradeDate: "2026-10-21", price: 25_000, quantity: 200, fee: 7_500 },
  ]);
  await source.insert(schema.alerts).values({ id: 30, positionId: 3, levelId: 10, kind: "dca", price: 28_400, message: "📉 CTG" });
  await source.insert(schema.appSettings).values({ id: 1, buyFeeRate: 0.001, sellFeeRate: 0.002 });
});

describe("chép dữ liệu sang database mới", () => {
  it("chép đủ mọi bảng, giữ nguyên id, liên kết và giá trị", async () => {
    const counts = await copyDatabase(source, target);
    expect(counts).toEqual([
      { table: "positions", source: 2, target: 2 },
      { table: "plan_levels", source: 2, target: 2 },
      { table: "transactions", source: 2, target: 2 },
      { table: "alerts", source: 1, target: 1 },
      { table: "app_settings", source: 1, target: 1 },
    ]);
    const tx = await target.select().from(schema.transactions);
    expect(tx.map((t) => [t.id, t.positionId, t.price, t.fee])).toEqual([
      [20, 3, 34_000, 5_100],
      [21, 7, 25_000, 7_500],
    ]);
    const [setting] = await target.select().from(schema.appSettings);
    expect([setting.buyFeeRate, setting.sellFeeRate]).toEqual([0.001, 0.002]);
    const levels = await target.select().from(schema.planLevels);
    expect(levels.find((l) => l.id === 11)).toMatchObject({ positionId: 3, status: "done", filledPrice: 36_150 });
  });

  it("đặt lại bộ đếm id: thêm mới sau khi chép không bị trùng", async () => {
    await copyDatabase(source, target);
    const [p] = await target.insert(schema.positions).values({ symbol: "HPG", exchange: "HOSE" }).returning();
    expect(p.id).toBe(8);
    const [t] = await target
      .insert(schema.transactions)
      .values({ positionId: p.id, side: "buy", tradeDate: "2026-10-25", price: 21_000, quantity: 100 })
      .returning();
    expect(t.id).toBe(22);
  });

  it("database đích đã có dữ liệu thì dừng, không ghi gì thêm", async () => {
    await target.insert(schema.positions).values({ symbol: "FPT", exchange: "HOSE" });
    await expect(copyDatabase(source, target)).rejects.toThrow(/đã có dữ liệu/);
    const counts = await compareCounts(source, target);
    expect(counts.find((c) => c.table === "positions")?.target).toBe(1);
    expect(counts.find((c) => c.table === "transactions")?.target).toBe(0);
  });

  it("không sửa database nguồn", async () => {
    const before = await compareCounts(source, source);
    await copyDatabase(source, target);
    expect(await compareCounts(source, source)).toEqual(before);
  });
});
