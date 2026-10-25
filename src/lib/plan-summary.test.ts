import { describe, expect, it } from "vitest";
import { computeHolding, tpChain, type LevelInput } from "./calc";
import type { FeeRates } from "./market";
import { tpPlanSummary } from "./plan-summary";

const FEES: FeeRates = { buy: 0.0015, sell: 0.0015, tax: 0.001 };

// HPG mua 21.000 × 1.000 (phí 31.500) → giá vốn 21.031,5
const holding = computeHolding([{ id: 1, side: "buy", tradeDate: "2026-10-01", price: 21_000, quantity: 1_000, fee: 31_500, tax: 0 }]);

const tp = (id: number, pct: number, sellPct: number, extra: Partial<LevelInput> = {}): LevelInput => ({
  id,
  kind: "tp",
  pct,
  quantity: null,
  sellPct,
  status: "pending",
  ...extra,
});

/** Ghép kết quả tpChain thành dạng LevelView như trang hiển thị */
function views(levels: LevelInput[]) {
  const chain = tpChain("HOSE", holding.avgCost, levels, FEES, holding);
  return levels.map((l) => {
    const step = chain.get(l.id);
    return {
      kind: l.kind,
      status: l.status,
      trigger: step?.price ?? null,
      distancePct: null,
      sellQuantity: step?.sellQuantity ?? null,
      tpRemaining: step?.remainingAfter ?? null,
      tpProfit: step?.profit ?? null,
    };
  });
}

describe("lãi dự kiến theo kế hoạch chốt lời", () => {
  it("3 nấc +10/+20/+30% bán 30/50/100%: cộng lời từng nấc, kế hoạch bán hết", () => {
    const s = tpPlanSummary(holding, views([tp(1, 10, 30), tp(2, 20, 50), tp(3, 30, 100)]));
    // 23.150 × 300, 27.800 × 300, 36.150 × 400; mỗi phần (giá × 0,9975 − 21.031,5) × số cổ
    expect(s.plannedProfit).toBeCloseTo(618_187.5 + 2_009_700 + 6_011_250);
    expect(s.sellQuantity).toBe(1_000);
    expect(s.remainingAfter).toBe(0);
    expect(s.steps).toBe(3);
    expect(s.next?.trigger).toBe(23_150);
    expect(s.plannedPct).toBeCloseTo((8_639_137.5 / 21_031_500) * 100);
  });

  it("kế hoạch không bán hết: báo số cổ còn giữ, phần đó không tính vào lãi dự kiến", () => {
    const s = tpPlanSummary(holding, views([tp(1, 10, 30)]));
    expect(s.sellQuantity).toBe(300);
    expect(s.remainingAfter).toBe(700);
    expect(s.plannedProfit).toBeCloseTo(618_187.5);
  });

  it("nấc đã làm hoặc bỏ qua không tính; nấc tiếp theo là nấc còn chờ đầu tiên", () => {
    const s = tpPlanSummary(holding, views([tp(1, 10, 30, { status: "skipped" }), tp(2, 20, 100)]));
    expect(s.steps).toBe(1);
    expect(s.next?.trigger).toBe(25_250);
  });

  it("chưa có nấc chốt lời nào", () => {
    const s = tpPlanSummary(holding, []);
    expect(s).toMatchObject({ hasPlan: false, plannedProfit: 0, remainingAfter: 1_000, next: null });
  });
});
