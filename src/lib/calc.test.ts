import { describe, expect, it } from "vitest";
import {
  breakEvenPrice,
  computeHolding,
  evaluatePrice,
  levelTriggerPrice,
  classifyTrade,
  planHints,
  simulateDca,
  tpChain,
  tpSellQuantity,
  type LevelInput,
  type PositionInput,
  type TxInput,
} from "./calc";
import { ceilToTick, floorToTick, roundLot, tickSize, type FeeRates } from "./market";

// Phí cố định 0,15% mua/bán, thuế 0,1%: không phụ thuộc biến môi trường khi chạy test
const FEES: FeeRates = { buy: 0.0015, sell: 0.0015, tax: 0.001 };

const position: PositionInput = {
  symbol: "HPG",
  exchange: "HOSE",
  maxCapital: null,
  stopLossPct: null,
  trailingPct: null,
  peakPrice: null,
  stopNotifiedAt: null,
  trailNotifiedPeak: null,
};

const buy = (id: number, price: number, quantity: number, date = "2026-01-02"): TxInput => ({
  id,
  side: "buy",
  tradeDate: date,
  price,
  quantity,
  fee: 0,
  tax: 0,
});

const level = (id: number, kind: "dca" | "tp", pct: number, extra: Partial<LevelInput> = {}): LevelInput => ({
  id,
  kind,
  pct,
  quantity: kind === "dca" ? 1000 : null,
  sellPct: kind === "tp" ? 30 : null,
  status: "pending",
  ...extra,
});

describe("market rules", () => {
  it("dùng đúng bước giá HOSE", () => {
    expect(tickSize("HOSE", 9_990)).toBe(10);
    expect(tickSize("HOSE", 25_000)).toBe(50);
    expect(tickSize("HOSE", 80_000)).toBe(100);
    expect(tickSize("HNX", 9_000)).toBe(100);
  });

  it("làm tròn giá theo bước giá", () => {
    expect(floorToTick("HOSE", 23_274)).toBe(23_250);
    expect(ceilToTick("HOSE", 23_251)).toBe(23_300);
    // Sai số số thực không được làm nhảy bước giá
    expect(ceilToTick("HOSE", 21_000 * 1.1)).toBe(23_100);
    expect(floorToTick("HOSE", 0.7 * 30_000)).toBe(21_000);
    expect(floorToTick("HNX", 12_345)).toBe(12_300);
  });

  it("làm tròn khối lượng theo lô 100", () => {
    expect(roundLot(1_050)).toBe(1_000);
    expect(roundLot(30)).toBe(100);
    expect(roundLot(0)).toBe(0);
  });
});

describe("computeHolding", () => {
  it("tính giá vốn trung bình gồm phí mua", () => {
    const h = computeHolding([
      { ...buy(1, 25_000, 1_000), fee: 37_500 },
      buy(2, 23_250, 1_000, "2026-02-01"),
    ]);
    expect(h.quantity).toBe(2_000);
    expect(h.avgCost).toBeCloseTo((25_000_000 + 37_500 + 23_250_000) / 2_000);
    expect(h.firstBuyPrice).toBe(25_000);
  });

  it("bán một phần giữ nguyên giá vốn và ghi nhận lãi đã chốt", () => {
    const h = computeHolding([
      buy(1, 20_000, 1_000),
      { id: 2, side: "sell", tradeDate: "2026-03-01", price: 22_000, quantity: 400, fee: 1_000, tax: 500 },
    ]);
    expect(h.quantity).toBe(600);
    expect(h.avgCost).toBe(20_000);
    expect(h.realizedPnl).toBe(400 * 2_000 - 1_500);
  });

  it("sắp xếp lệnh theo ngày dù nhập không theo thứ tự", () => {
    const h = computeHolding([buy(2, 23_000, 1_000, "2026-02-01"), buy(1, 25_000, 1_000, "2026-01-01")]);
    expect(h.firstBuyPrice).toBe(25_000);
  });
});

describe("kế hoạch DCA", () => {
  const holding = computeHolding([buy(1, 25_000, 1_000)]);
  const levels = [level(1, "dca", -7), level(2, "dca", -15, { quantity: 1_500 })];

  it("tính giá kích hoạt theo giá mua gần nhất", () => {
    expect(levelTriggerPrice(levels[0], position, holding)).toBe(23_250);
    expect(levelTriggerPrice(levels[1], position, holding)).toBe(21_250);
  });

  it("mô phỏng giá vốn khi khớp lần lượt các nấc", () => {
    const rows = simulateDca(position, holding, levels, FEES);
    expect(rows).toHaveLength(2);
    expect(rows[0].avgCost).toBeCloseTo((25_000_000 + 23_250_000 * 1.0015) / 2_000);
    expect(rows[1].totalQuantity).toBe(3_500);
    expect(rows[1].avgCost).toBeLessThan(23_000);
    expect(rows[1].recoveryPct).toBeGreaterThan(0);
  });

  it("đánh dấu nấc vượt giới hạn vốn", () => {
    const rows = simulateDca({ ...position, maxCapital: 50_000_000 }, holding, levels, FEES);
    expect(rows[0].overCapital).toBe(false);
    expect(rows[1].overCapital).toBe(true);
  });

  it("nhắc DCA khi giá chạm nấc, bỏ qua nấc chưa chạm", () => {
    const { events } = evaluatePrice(position, holding, levels, 23_200, FEES);
    expect(events.map((e) => e.levelId)).toEqual([1]);
    expect(events[0].message).toContain("mua 1.000 cp");
  });

  it("không nhắc lại nấc đã nhắc", () => {
    const notified = [{ ...levels[0], status: "notified" as const }, levels[1]];
    expect(evaluatePrice(position, holding, notified, 23_200, FEES).events).toHaveLength(0);
  });

  it("thủng cắt lỗ thì chỉ nhắc cắt lỗ, không nhắc DCA", () => {
    const p = { ...position, stopLossPct: -10 };
    const { events } = evaluatePrice(p, holding, levels, 22_000, FEES);
    expect(events.map((e) => e.kind)).toEqual(["stop"]);
  });
});

describe("chốt lời và trailing stop", () => {
  const holding = computeHolding([buy(1, 20_000, 1_000)]);

  it("tính giá chốt lời theo giá vốn và số lượng bán theo lô", () => {
    const tp = level(3, "tp", 10);
    expect(levelTriggerPrice(tp, position, holding)).toBe(22_000);
    expect(tpSellQuantity(tp, 1_000)).toBe(300);
    expect(tpSellQuantity({ sellPct: 100 }, 1_050)).toBe(1_050);
  });

  it("nhắc chốt lời khi giá vượt mức", () => {
    const { events } = evaluatePrice(position, holding, [level(3, "tp", 10)], 22_050, FEES);
    expect(events[0].kind).toBe("tp");
    expect(events[0].message).toContain("bán 300 cp, còn lại 700 cp");
  });

  it("trailing stop chỉ nhắc khi đang lãi và giảm đủ từ đỉnh", () => {
    const p = { ...position, trailingPct: 8, peakPrice: 26_000 };
    expect(evaluatePrice(p, holding, [], 23_900, FEES).events.map((e) => e.kind)).toEqual(["trail"]);
    expect(evaluatePrice(p, holding, [], 24_500, FEES).events).toHaveLength(0);
    // Đã nhắc ở đỉnh này rồi thì không nhắc lại
    expect(evaluatePrice({ ...p, trailNotifiedPeak: 26_000 }, holding, [], 23_900, FEES).events).toHaveLength(0);
  });

  it("giá hòa vốn đã gồm phí và thuế bán", () => {
    expect(breakEvenPrice(20_000, FEES)).toBeCloseTo(20_000 / 0.9975);
  });
});

describe("DCA nối tiếp theo giá mua của nấc trước", () => {
  const p = position;
  const holding = computeHolding([buy(1, 25_000, 1_000)]);
  // Nấc 1: -7% so với giá mua 25.000; nấc 2: -10% so với giá mua của nấc 1
  const levels = [level(1, "dca", -7), level(2, "dca", -10)];

  it("nấc sau tính % trên giá mua của nấc trước", () => {
    const [r1, r2] = simulateDca(p, holding, levels, FEES);
    expect(r1.price).toBe(23_250);
    expect(r1.avgCost).toBeCloseTo((25_000_000 + 23_250_000 * 1.0015) / 2_000);
    expect(r2.basePrice).toBe(23_250);
    expect(r2.price).toBe(20_900); // 23.250 × 0,9 = 20.925 → làm tròn xuống bước giá 50
  });

  it("ví dụ 21.000, mỗi nấc -10%", () => {
    const h = computeHolding([buy(1, 21_000, 1_000)]);
    const rows = simulateDca(p, h, [level(1, "dca", -10), level(2, "dca", -10), level(3, "dca", -10)], FEES);
    // 18.900 × 0,9 = 17.010 → làm tròn xuống bước giá 50 của HOSE = 17.000
    expect(rows.map((r) => r.price)).toEqual([18_900, 17_000, 15_300]);
  });

  it("nấc đầu tiên còn lại tính từ giá khớp của nấc DCA đã làm", () => {
    const h = computeHolding([buy(1, 25_000, 1_000), buy(2, 23_250, 1_000, "2026-02-01")]);
    const [r] = simulateDca(p, h, [level(1, "dca", -7, { status: "done", filledPrice: 23_250 }), level(2, "dca", -10)], FEES);
    expect(r.basePrice).toBe(23_250);
    expect(r.baseSource).toBe("filled");
    expect(r.price).toBe(20_900);
  });

  it("mua thêm ngoài kế hoạch: chưa khớp nấc nào thì tính từ giá vốn TB", () => {
    // Mua 21.000 rồi mua thêm 21.200 (không phải nấc DCA)
    const h = computeHolding([buy(1, 21_000, 2_000), buy(2, 21_200, 1_200, "2026-02-01")]);
    const [r1, r2] = simulateDca(p, h, [level(1, "dca", -10), level(2, "dca", -10)], FEES);
    expect(r1.basePrice).toBeCloseTo(h.avgCost);
    expect(r1.baseLevelId).toBeNull();
    expect(r1.price).toBe(floorToTick("HOSE", h.avgCost * 0.9));
    expect(r2.basePrice).toBe(r1.price);
  });

  it("giữ đúng thứ tự người dùng đặt, kể cả khi % không tăng dần", () => {
    const rows = simulateDca(p, holding, [level(1, "dca", -10), level(2, "dca", -5)], FEES);
    expect(rows.map((r) => r.levelId)).toEqual([1, 2]);
    expect(rows[0].price).toBe(22_500);
    expect(rows[1].price).toBe(21_350); // 22.500 × 0,95 = 21.375 → 21.350
  });

  it("bỏ qua nấc đã bỏ qua, nấc kế tiếp tính từ giá vốn thực tế", () => {
    const rows = simulateDca(p, holding, [level(1, "dca", -7, { status: "skipped" }), level(2, "dca", -10)], FEES);
    expect(rows).toHaveLength(1);
    expect(rows[0].price).toBe(22_500);
  });

  it("chỉ nhắc nấc 2 khi giá chạm mức tính theo chuỗi", () => {
    const notified = [{ ...levels[0], status: "notified" as const }, levels[1]];
    expect(evaluatePrice(p, holding, notified, 21_000, FEES).events).toHaveLength(0);
    expect(evaluatePrice(p, holding, notified, 20_900, FEES).events.map((e) => e.levelId)).toEqual([2]);
  });
});

describe("chốt lời nối tiếp", () => {
  const tp = [level(11, "tp", 10), level(12, "tp", 20)];

  it("chưa DCA: tính từ giá gốc, nấc sau tính từ nấc trước", () => {
    const h = computeHolding([buy(1, 21_000, 1_000)]);
    const chain = tpChain("HOSE", h.avgCost, tp, FEES);
    expect([chain.get(11)?.price, chain.get(12)?.price]).toEqual([23_100, 27_750]);
    expect(chain.get(12)?.basePrice).toBe(23_100);
  });

  it("đã DCA: tính từ giá vốn TB sau DCA, số cổ bán theo khối lượng mới", () => {
    const h = computeHolding([buy(1, 21_000, 1_000), buy(2, 18_900, 1_000, "2026-02-01")]);
    expect(h.avgCost).toBe(19_950);
    const chain = tpChain("HOSE", h.avgCost, [level(11, "tp", 10, { sellPct: 50 }), level(12, "tp", 20, { sellPct: 100 })], FEES, h);
    // 19.950 × 1,1 = 21.945 → 21.950; 21.950 × 1,2 = 26.340 → 26.350
    expect([chain.get(11)?.price, chain.get(12)?.price]).toEqual([21_950, 26_350]);
    expect([chain.get(11)?.sellQuantity, chain.get(12)?.sellQuantity]).toEqual([1_000, 1_000]);
  });

  it("bỏ qua nấc đã bỏ qua", () => {
    const chain = tpChain("HOSE", 21_000, [{ ...tp[0], status: "skipped" as const }, tp[1]], FEES);
    expect(chain.get(12)?.price).toBe(25_200);
  });

  it("nhắc nấc chốt lời 2 theo giá trong chuỗi", () => {
    const h = computeHolding([buy(1, 21_000, 1_000)]);
    const levels = [{ ...tp[0], status: "done" as const }, tp[1]];
    expect(evaluatePrice(position, h, levels, 27_700, FEES).events).toHaveLength(0);
    expect(evaluatePrice(position, h, levels, 27_750, FEES).events.map((e) => e.levelId)).toEqual([12]);
  });
});

describe("lãi/lỗ tạm tính khi khớp hết nấc DCA", () => {
  it("tính tại giá nấc cuối, đã trừ phí và thuế bán", () => {
    const h = computeHolding([buy(1, 25_000, 1_000)]);
    const [row] = simulateDca(position, h, [level(1, "dca", -10)], FEES);
    const capital = 25_000_000 + 22_500_000 * 1.0015;
    expect(row.totalCapital).toBeCloseTo(capital);
    expect(row.pnlAtPrice).toBeCloseTo(2_000 * 22_500 * 0.9975 - capital);
    expect(row.pnlAtPrice).toBeLessThan(0);
  });
});

describe("số cổ bán, còn lại và tiền lời mỗi nấc chốt lời", () => {
  const plan = [
    level(11, "tp", 10, { sellPct: 30 }),
    level(12, "tp", 20, { sellPct: 50 }),
    level(13, "tp", 30, { sellPct: 100 }),
  ];

  it("% bán tính trên số cổ còn lại sau nấc trước", () => {
    const h = computeHolding([buy(1, 21_000, 1_000)]);
    const steps = [...tpChain("HOSE", h.avgCost, plan, FEES, h).values()];
    // 30% của 1.000 = 300; 50% của 700 = 350 → lô chẵn 300; 100% của 400 = 400
    expect(steps.map((s) => s.sellQuantity)).toEqual([300, 300, 400]);
    expect(steps.map((s) => s.remainingAfter)).toEqual([700, 400, 0]);
    expect(steps[0].profit).toBeCloseTo((23_100 * 0.9975 - 21_000) * 300);
    expect(steps[2].cumulativeProfit).toBeCloseTo(steps.reduce((s, x) => s + x.profit, 0));
  });

  it("sau khi đã bán nấc 1, nấc sau tính trên số cổ còn giữ", () => {
    const h = computeHolding([
      buy(1, 21_000, 1_000),
      { id: 2, side: "sell", tradeDate: "2026-03-01", price: 23_100, quantity: 300, fee: 0, tax: 0 },
    ]);
    const done = [{ ...plan[0], status: "done" as const }, plan[1], plan[2]];
    const steps = tpChain("HOSE", 21_000, done, FEES, h);
    expect(steps.get(11)?.sellQuantity).toBe(0);
    expect(steps.get(12)?.sellQuantity).toBe(300);
    expect(steps.get(13)?.sellQuantity).toBe(400);
    expect(steps.get(13)?.remainingAfter).toBe(0);
  });

  it("không có nấc 100% thì giữ lại phần còn lại", () => {
    const h = computeHolding([buy(1, 21_000, 1_000)]);
    const steps = tpChain("HOSE", 21_000, [level(11, "tp", 10, { sellPct: 50 })], FEES, h);
    expect(steps.get(11)?.sellQuantity).toBe(500);
    expect(steps.get(11)?.remainingAfter).toBe(500);
  });
});

describe("đối chiếu lệnh tay với kế hoạch", () => {
  const plan = [
    level(1, "dca", -10, { status: "done", filledPrice: 18_900 }),
    level(2, "dca", -10),
    level(3, "dca", -10),
    level(11, "tp", 10, { sellPct: 30 }),
    level(12, "tp", 20, { sellPct: 100 }),
  ];
  // Đã mua 21.000 × 1.000 và nấc 1 khớp ở 18.900 → giá vốn 19.950, nấc 2 chờ ở 17.000
  const h = computeHolding([buy(1, 21_000, 1_000), buy(2, 18_900, 1_000, "2026-02-01")]);
  const hints = planHints(position, h, plan, FEES);

  it("tóm tắt kế hoạch hiện tại", () => {
    expect(hints.dca).toEqual({ base: 18_900, next: { levelId: 2, levelNo: 2, price: 17_000 } });
    // chốt lời 1 = 19.950 × 1,1 = 21.945 → 21.950
    expect(hints.tp).toEqual({ base: 19_950, next: { levelId: 11, levelNo: 1, price: 21_950 } });
  });

  it("mua ≤ giá nấc đang chờ → khớp nấc đó", () => {
    expect(classifyTrade(hints, "buy", 16_900)).toEqual({ kind: "match", level: { levelId: 2, levelNo: 2, price: 17_000 } });
  });

  it("mua dưới giá vốn nhưng chưa tới nấc → đề nghị thêm nấc mới, % tính từ mốc", () => {
    // 18.000 / 18.900 - 1 = -4,76% → -4,8%
    expect(classifyTrade(hints, "buy", 18_000)).toEqual({
      kind: "insert",
      pct: -4.8,
      before: { levelId: 2, levelNo: 2, price: 17_000 },
    });
  });

  it("mua dưới giá vốn nhưng cao hơn mốc, hoặc trên giá vốn → ngoài kế hoạch", () => {
    expect(classifyTrade(hints, "buy", 19_500).kind).toBe("none");
    expect(classifyTrade(hints, "buy", 21_200).kind).toBe("none");
  });

  it("bán ≥ nấc chốt lời đang chờ → khớp; trên giá vốn nhưng chưa tới → thêm nấc mới", () => {
    expect(classifyTrade(hints, "sell", 22_000)).toEqual({ kind: "match", level: { levelId: 11, levelNo: 1, price: 21_950 } });
    expect(classifyTrade(hints, "sell", 21_000)).toEqual({
      kind: "insert",
      pct: 5.3,
      before: { levelId: 11, levelNo: 1, price: 21_950 },
    });
    expect(classifyTrade(hints, "sell", 19_000).kind).toBe("none");
  });

  it("nấc chốt lời đã bán dùng giá bán thực tế làm mốc cho nấc sau", () => {
    const done = plan.map((l) => (l.id === 11 ? { ...l, status: "done" as const, filledPrice: 21_000 } : l));
    const steps = tpChain("HOSE", h.avgCost, done, FEES, h);
    expect(steps.get(11)?.price).toBe(21_000);
    expect(steps.get(12)?.price).toBe(25_200); // 21.000 × 1,2
  });
});

describe("bỏ qua nấc vẫn giữ mốc cho nấc sau", () => {
  // Giá vốn 21.000, 3 nấc DCA -10%: 18.900 → 17.000 → 15.300
  const h = computeHolding([buy(1, 21_000, 1_000)]);

  it("bỏ qua nấc 1 thì nấc 2, 3 giữ nguyên giá, không bị kéo về giá của nấc 1", () => {
    const plan = [
      level(1, "dca", -10, { status: "skipped", filledPrice: 18_900 }),
      level(2, "dca", -10),
      level(3, "dca", -10),
    ];
    const rows = simulateDca(position, h, plan, FEES);
    expect(rows.map((r) => r.price)).toEqual([17_000, 15_300]);
    expect(rows[0].baseSource).toBe("skipped");
    expect(rows[0].baseLevelId).toBe(1);
    // Giá đang ở 18.900 (giá của nấc vừa bỏ qua) thì không nhắc nấc 2
    expect(evaluatePrice(position, h, plan, 18_900, FEES).events).toHaveLength(0);
  });

  it("nấc bỏ qua không mua nên giá vốn sau nấc 2 tính từ khối lượng thật", () => {
    const rows = simulateDca(position, h, [level(1, "dca", -10, { status: "skipped", filledPrice: 18_900 }), level(2, "dca", -10)], FEES);
    expect(rows[0].quantityBefore).toBe(1_000);
  });

  it("nấc đang chờ đứng trước nấc bỏ qua vẫn tính từ giá vốn", () => {
    const rows = simulateDca(position, h, [level(1, "dca", -10), level(2, "dca", -10, { status: "skipped", filledPrice: 17_000 }), level(3, "dca", -10)], FEES);
    expect(rows.map((r) => r.price)).toEqual([18_900, 15_300]);
  });

  it("chốt lời: bỏ qua nấc 1 thì nấc 2 vẫn tính từ mốc của nấc 1 và không bán ở nấc bỏ qua", () => {
    const tp = [
      level(11, "tp", 10, { sellPct: 30, status: "skipped", filledPrice: 23_100 }),
      level(12, "tp", 10, { sellPct: 100 }),
    ];
    const steps = tpChain("HOSE", h.avgCost, tp, FEES, h);
    expect(steps.get(11)?.sellQuantity).toBe(0);
    expect(steps.get(12)?.price).toBe(25_450); // 23.100 × 1,1 = 25.410 → bước 50 làm tròn lên
    expect(steps.get(12)?.sellQuantity).toBe(1_000);
    expect(evaluatePrice(position, h, tp, 23_100, FEES).events).toHaveLength(0);
  });
});
