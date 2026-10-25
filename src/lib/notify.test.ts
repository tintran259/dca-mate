// Test luồng thông báo: lấy giá → so với kế hoạch → lưu cảnh báo → gửi Telegram.
// Chạy thật check.ts trên database tạm (PGlite), giá giả lập qua MOCK_PRICES, Telegram thay bằng fetch giả.
// Đặt TELEGRAM_LIVE=1 (kèm TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID) để gửi tin thật cho nhóm case cuối.
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/cache", () => ({ cacheLife: () => {} }));

const LIVE = process.env.TELEGRAM_LIVE === "1";
// Chế độ gửi thật: lấy token, chat ID từ .env.local nếu chưa có trong môi trường
if (LIVE && !process.env.TELEGRAM_BOT_TOKEN && existsSync(".env.local")) process.loadEnvFile(".env.local");
const live = { token: process.env.TELEGRAM_BOT_TOKEN, chatId: process.env.TELEGRAM_CHAT_ID };

process.env.PGLITE_DIR = mkdtempSync(join(tmpdir(), "dca-notify-"));
delete process.env.DATABASE_URL;
delete process.env.VERCEL;

type Modules = {
  db: Awaited<ReturnType<typeof import("@/db")["getDb"]>>;
  schema: typeof import("@/db/schema");
  check: typeof import("./check");
  eq: typeof import("drizzle-orm")["eq"];
};
let m: Modules;

beforeAll(async () => {
  const { getDb } = await import("@/db");
  m = {
    db: await getDb(),
    schema: await import("@/db/schema"),
    check: await import("./check"),
    eq: (await import("drizzle-orm")).eq,
  };
});

// Tin nhắn Telegram đã gửi (fetch giả)
let sent: { chatId: string; text: string }[] = [];
let telegramStatus = 200;

function useFakeTelegram() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (!String(url).startsWith("https://api.telegram.org/")) throw new Error(`fetch ngoài dự kiến: ${url}`);
      const body = JSON.parse(String(init?.body));
      sent.push({ chatId: String(body.chat_id), text: body.text });
      return new Response(telegramStatus === 200 ? '{"ok":true}' : '{"ok":false}', { status: telegramStatus });
    }),
  );
}

beforeEach(async () => {
  sent = [];
  telegramStatus = 200;
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.TELEGRAM_CHAT_ID = "42";
  delete process.env.APP_URL;
  useFakeTelegram();
  const { alerts, planLevels, transactions, positions } = m.schema;
  await m.db.delete(alerts);
  await m.db.delete(planLevels);
  await m.db.delete(transactions);
  await m.db.delete(positions);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

type LevelSpec = { kind: "dca" | "tp"; pct: number; quantity?: number; sellPct?: number; status?: "pending" | "notified" | "done" | "skipped"; filledPrice?: number };

/** Tạo vị thế: mua `qty` cp ở `price` (phí 0,15%), kèm các nấc kế hoạch. Trả về id vị thế và id các nấc. */
async function createPosition(symbol: string, price: number, qty: number, levels: LevelSpec[], status: "open" | "closed" = "open") {
  const { positions, transactions, planLevels } = m.schema;
  const [p] = await m.db
    .insert(positions)
    .values({ symbol, exchange: "HOSE", status, lastPrice: price, peakPrice: price })
    .returning({ id: positions.id });
  await m.db.insert(transactions).values({
    positionId: p.id,
    side: "buy",
    tradeDate: "2026-10-01",
    price,
    quantity: qty,
    fee: Math.round(price * qty * 0.0015),
  });
  const rows = levels.length
    ? await m.db
        .insert(planLevels)
        .values(
          levels.map((l, i) => ({
            positionId: p.id,
            kind: l.kind,
            pct: l.pct,
            quantity: l.quantity ?? null,
            sellPct: l.sellPct ?? null,
            status: l.status ?? "pending",
            filledPrice: l.filledPrice ?? null,
            sortOrder: i,
          })),
        )
        .returning({ id: planLevels.id })
    : [];
  return { positionId: p.id, levelIds: rows.map((r) => r.id) };
}

async function levelStatus(id: number) {
  const [row] = await m.db.select().from(m.schema.planLevels).where(m.eq(m.schema.planLevels.id, id));
  return row.status;
}

async function alertCount() {
  return (await m.db.select().from(m.schema.alerts)).length;
}

const runAt = (prices: string) => {
  process.env.MOCK_PRICES = prices;
  return m.check.runPriceCheck();
};

// HPG mua 21.000 × 1.000 (phí 31.500) → giá vốn 21.031,5.
// DCA −10% từ giá vốn → ≤ 18.900; nấc sau −10% từ 18.900 → ≤ 17.000. Chốt lời +10% từ giá vốn → ≥ 23.150.
const HPG_PLAN: LevelSpec[] = [
  { kind: "dca", pct: -10, quantity: 1000 },
  { kind: "dca", pct: -10, quantity: 1000 },
  { kind: "tp", pct: 10, sellPct: 30 },
];

describe("thông báo khi giá chạm nấc", () => {
  it("N01: chạm nấc DCA → lưu cảnh báo, nấc chuyển 'Đã nhắc', gửi 1 tin Telegram", async () => {
    const { levelIds } = await createPosition("HPG", 21_000, 1000, HPG_PLAN);
    const s = await runAt("HPG:18900");
    expect(s.alerts).toHaveLength(1);
    expect(s.telegram).toBe("sent");
    expect(await levelStatus(levelIds[0])).toBe("notified");
    expect(sent).toHaveLength(1);
    expect(sent[0].chatId).toBe("42");
    expect(sent[0].text).toContain("📉 HPG 18.900");
    expect(sent[0].text).toContain("chạm nấc DCA -10,0%: mua 1.000 cp");
    expect(sent[0].text).toContain("Giá vốn sau DCA ≈ 19.980");
  });

  it("N02: giá chưa chạm nấc nào → không cảnh báo, không gửi tin", async () => {
    await createPosition("HPG", 21_000, 1000, HPG_PLAN);
    const s = await runAt("HPG:19000");
    expect(s.alerts).toHaveLength(0);
    expect(s.telegram).toBe("none");
    expect(sent).toHaveLength(0);
  });

  it("N03: kiểm tra lại khi giá vẫn ở nấc đã nhắc → không nhắc lại (mỗi nấc 1 lần)", async () => {
    await createPosition("HPG", 21_000, 1000, HPG_PLAN);
    await runAt("HPG:18900");
    await runAt("HPG:18850");
    await runAt("HPG:18900");
    expect(sent).toHaveLength(1);
    expect(await alertCount()).toBe(1);
  });

  it("N04: chạm nấc chốt lời → gửi tin bán bao nhiêu, còn lại, lãi ước tính", async () => {
    const { levelIds } = await createPosition("HPG", 21_000, 1000, HPG_PLAN);
    const s = await runAt("HPG:23150");
    expect(s.alerts).toHaveLength(1);
    expect(await levelStatus(levelIds[2])).toBe("notified");
    expect(sent[0].text).toContain("🎯 HPG 23.150 chạm nấc chốt lời 1");
    expect(sent[0].text).toContain("bán 300 cp, còn lại 700 cp");
    expect(sent[0].text).toMatch(/Lãi ≈ [\d.,]+/);
  });

  it("N05: giá rơi qua 2 nấc DCA trong 1 lần kiểm tra → nhắc cả 2, gộp trong 1 tin", async () => {
    const { levelIds } = await createPosition("HPG", 21_000, 1000, HPG_PLAN);
    const s = await runAt("HPG:16900");
    expect(s.alerts).toHaveLength(2);
    expect(await levelStatus(levelIds[0])).toBe("notified");
    expect(await levelStatus(levelIds[1])).toBe("notified");
    expect(sent).toHaveLength(1);
    expect(sent[0].text.match(/📉 HPG/g)).toHaveLength(2);
  });

  it("N06: nhiều mã cùng chạm nấc → 1 tin chứa cả hai mã", async () => {
    await createPosition("HPG", 21_000, 1000, HPG_PLAN);
    await createPosition("FPT", 100_000, 100, [{ kind: "tp", pct: 10, sellPct: 100 }]);
    const s = await runAt("HPG:18900,FPT:111000");
    expect(s.alerts).toHaveLength(2);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain("📉 HPG");
    expect(sent[0].text).toContain("🎯 FPT");
  });

  it("N07: nấc đã làm hoặc đã bỏ qua → không nhắc", async () => {
    await createPosition("HPG", 21_000, 1000, [
      { kind: "dca", pct: -10, quantity: 1000, status: "skipped" },
      { kind: "tp", pct: 10, sellPct: 30, status: "done" },
    ]);
    const s = await runAt("HPG:23150");
    expect(s.alerts).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("N08: mã đã đóng (bán hết) → không kiểm tra, không nhắc", async () => {
    await createPosition("HPG", 21_000, 1000, HPG_PLAN, "closed");
    const s = await runAt("HPG:16000");
    expect(s.checked).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("N09: nhập giá tay chạm nấc → gửi tin ngay", async () => {
    const { positionId } = await createPosition("HPG", 21_000, 1000, HPG_PLAN);
    const res = await m.check.applyManualPrice(positionId, 18_900);
    expect(res.alerts).toHaveLength(1);
    expect(res.telegram).toBe("sent");
    expect(sent[0].text).toContain("📉 HPG 18.900");
  });

  it("N10: chưa cấu hình Telegram → cảnh báo vẫn lưu trên web, không gửi", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    await createPosition("HPG", 21_000, 1000, HPG_PLAN);
    const s = await runAt("HPG:18900");
    expect(s.telegram).toBe("skipped");
    expect(await alertCount()).toBe(1);
    expect(sent).toHaveLength(0);
  });

  it("N11: Telegram lỗi → cảnh báo vẫn lưu, báo gửi thất bại", async () => {
    telegramStatus = 500;
    await createPosition("HPG", 21_000, 1000, HPG_PLAN);
    const s = await runAt("HPG:18900");
    expect(s.telegram).toBe("failed");
    expect(await alertCount()).toBe(1);
  });

  it("N12: có APP_URL → tin kèm link mở trang Cảnh báo", async () => {
    process.env.APP_URL = "https://dca-mate.vercel.app";
    await createPosition("HPG", 21_000, 1000, HPG_PLAN);
    await runAt("HPG:18900");
    expect(sent[0].text.endsWith("\n\nhttps://dca-mate.vercel.app/alerts")).toBe(true);
  });

  it("N13: không lấy được giá → báo thiếu giá, không cảnh báo", async () => {
    await createPosition("HPG", 21_000, 1000, HPG_PLAN);
    const s = await runAt("CTG:30000");
    expect(s.missing).toEqual(["HPG"]);
    expect(s.alerts).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("N14: khôi phục nấc đã nhắc về 'chờ' → chạm lại thì nhắc lại", async () => {
    const { levelIds } = await createPosition("HPG", 21_000, 1000, HPG_PLAN);
    await runAt("HPG:18900");
    await m.db
      .update(m.schema.planLevels)
      .set({ status: "pending", notifiedAt: null })
      .where(m.eq(m.schema.planLevels.id, levelIds[0]));
    await runAt("HPG:18900");
    expect(sent).toHaveLength(2);
  });

  it("N15: nấc 1 đã khớp ở 18.900 → nấc 2 chỉ nhắc khi giá ≤ 17.000 (tính từ giá khớp)", async () => {
    await createPosition("HPG", 21_000, 1000, [
      { kind: "dca", pct: -10, quantity: 1000, status: "done", filledPrice: 18_900 },
      { kind: "dca", pct: -10, quantity: 1000 },
    ]);
    expect((await runAt("HPG:17050")).alerts).toHaveLength(0);
    const s = await runAt("HPG:17000");
    expect(s.alerts).toHaveLength(1);
    expect(sent[0].text).toContain("📉 HPG 17.000");
  });
});

// Gửi tin thật vào chat của bạn để xem tin nhắn hiển thị thế nào. Chỉ chạy khi TELEGRAM_LIVE=1.
describe.runIf(LIVE && live.token && live.chatId)("gửi thật qua Telegram", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    process.env.TELEGRAM_BOT_TOKEN = live.token;
    process.env.TELEGRAM_CHAT_ID = live.chatId;
    process.env.APP_URL = "https://dca-mate.vercel.app";
  });

  it("L1: chạm nấc DCA", async () => {
    await createPosition("HPG", 21_000, 1000, HPG_PLAN);
    expect((await runAt("HPG:18900")).telegram).toBe("sent");
  });

  it("L2: chạm nấc chốt lời", async () => {
    await createPosition("HPG", 21_000, 1000, HPG_PLAN);
    expect((await runAt("HPG:23150")).telegram).toBe("sent");
  });

  it("L3: rơi qua 2 nấc DCA và mã khác chạm chốt lời cùng lúc (1 tin gộp)", async () => {
    await createPosition("HPG", 21_000, 1000, HPG_PLAN);
    await createPosition("FPT", 100_000, 100, [{ kind: "tp", pct: 10, sellPct: 100 }]);
    const s = await runAt("HPG:16900,FPT:111000");
    expect(s.alerts).toHaveLength(3);
    expect(s.telegram).toBe("sent");
  });
});
