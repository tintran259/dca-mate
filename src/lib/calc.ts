import type { Exchange } from "@/db/schema";
import { formatMoney, formatPct, formatPrice, formatQty } from "./format";
import {
  BUY_FEE_RATE,
  SELL_FEE_RATE,
  SELL_TAX_RATE,
  ceilToTick,
  floorToTick,
  roundLot,
} from "./market";

// Các hàm thuần, không đụng DB, để dùng chung cho UI, cron và unit test.

export type TxInput = {
  id: number;
  side: "buy" | "sell";
  tradeDate: string;
  price: number;
  quantity: number;
  fee: number;
  tax: number;
};

export type LevelInput = {
  id: number;
  kind: "dca" | "tp";
  pct: number;
  quantity: number | null;
  sellPct: number | null;
  status: "pending" | "notified" | "done" | "skipped";
  /** Giá khớp thực tế khi nấc đã làm */
  filledPrice?: number | null;
};

export type PositionInput = {
  symbol: string;
  exchange: Exchange;
  maxCapital: number | null;
  stopLossPct: number | null;
  trailingPct: number | null;
  peakPrice: number | null;
  stopNotifiedAt: Date | null;
  trailNotifiedPeak: number | null;
};

export type Holding = {
  quantity: number;
  /** Giá vốn của khối lượng đang giữ, đã gồm phí mua */
  totalCost: number;
  avgCost: number;
  firstBuyPrice: number | null;
  firstBuyDate: string | null;
  /** Giá của lần mua gần nhất: mốc tính % cho nấc DCA đầu tiên còn lại */
  lastBuyPrice: number | null;
  realizedPnl: number;
  buyCount: number;
};

export function sortTransactions<T extends TxInput>(txs: T[]): T[] {
  return [...txs].sort((a, b) =>
    a.tradeDate === b.tradeDate ? a.id - b.id : a.tradeDate < b.tradeDate ? -1 : 1,
  );
}

export function computeHolding(txs: TxInput[]): Holding {
  let quantity = 0;
  let totalCost = 0;
  let realizedPnl = 0;
  let firstBuyPrice: number | null = null;
  let firstBuyDate: string | null = null;
  let lastBuyPrice: number | null = null;
  let buyCount = 0;

  for (const tx of sortTransactions(txs)) {
    if (tx.side === "buy") {
      if (firstBuyPrice === null || quantity === 0) {
        // Mở lại vị thế sau khi đã bán hết thì tính lại từ đầu
        firstBuyPrice = tx.price;
        firstBuyDate = tx.tradeDate;
      }
      quantity += tx.quantity;
      totalCost += tx.price * tx.quantity + tx.fee;
      lastBuyPrice = tx.price;
      buyCount++;
    } else {
      const sellQty = Math.min(tx.quantity, quantity);
      const avg = quantity > 0 ? totalCost / quantity : 0;
      const costOut = avg * sellQty;
      realizedPnl += tx.price * sellQty - tx.fee - tx.tax - costOut;
      quantity -= sellQty;
      totalCost -= costOut;
      if (quantity === 0) totalCost = 0;
    }
  }

  return {
    quantity,
    totalCost,
    avgCost: quantity > 0 ? totalCost / quantity : 0,
    firstBuyPrice,
    firstBuyDate,
    lastBuyPrice,
    realizedPnl,
    buyCount,
  };
}

/** Giá bán tối thiểu để hòa vốn sau phí bán và thuế. */
export function breakEvenPrice(avgCost: number): number {
  return avgCost / (1 - SELL_FEE_RATE - SELL_TAX_RATE);
}

/** Lãi/lỗ tạm tính nếu bán hết ở giá `price`, đã trừ phí và thuế bán. */
export function unrealizedPnl(holding: Holding, price: number): number {
  if (holding.quantity === 0) return 0;
  const gross = price * holding.quantity;
  return gross * (1 - SELL_FEE_RATE - SELL_TAX_RATE) - holding.totalCost;
}

/** Giá kích hoạt của 1 nấc theo trạng thái hiện tại. */
export function levelTriggerPrice(
  level: Pick<LevelInput, "kind" | "pct">,
  position: PositionInput,
  holding: Holding,
): number | null {
  if (level.kind === "dca") {
    if (!holding.avgCost) return null;
    return floorToTick(position.exchange, holding.avgCost * (1 + level.pct / 100));
  }
  if (!holding.avgCost) return null;
  return ceilToTick(position.exchange, holding.avgCost * (1 + level.pct / 100));
}

export type TpStep = {
  price: number;
  /** Giá làm mốc: giá vốn TB (nấc 1) hoặc giá chốt lời nấc trước */
  basePrice: number;
  /** Thứ tự trong chuỗi (0 = nấc chốt lời đầu tiên) */
  index: number;
  /** Số cổ bán ở nấc này (0 với nấc đã làm hoặc khi đã bán hết) */
  sellQuantity: number;
  /** Số cổ còn giữ sau khi bán nấc này */
  remainingAfter: number;
  /** Tiền lời (âm = lỗ) của phần bán ở nấc này so với giá vốn, đã trừ phí và thuế bán */
  profit: number;
  profitPct: number;
  /** Tổng lời cộng dồn tới nấc này */
  cumulativeProfit: number;
};

/**
 * Chuỗi chốt lời nối tiếp: nấc 1 tính % tăng từ giá vốn TB đang giữ (chưa DCA thì là giá gốc, đã DCA thì là
 * giá vốn sau DCA), nấc 2 tính từ giá nấc 1, cứ thế theo thứ tự người dùng đặt. Nấc đã bỏ qua không tính.
 *
 * "% KL" của mỗi nấc tính trên số cổ còn lại sau nấc trước (VD 30/50/100% của 1.000 cp = 300/350/350).
 * Nấc 100% bán hết phần còn lại.
 */
export function tpChain(
  exchange: Exchange,
  startPrice: number | null,
  levels: Pick<LevelInput, "id" | "kind" | "pct" | "sellPct" | "status" | "filledPrice">[],
  holding?: { quantity: number; avgCost: number },
): Map<number, TpStep> {
  const out = new Map<number, TpStep>();
  let base = startPrice ?? 0;
  if (!base) return out;

  const tps = levels.filter((l) => l.kind === "tp" && l.status !== "skipped" && l.pct > 0);
  const avgCost = holding?.avgCost ?? 0;
  const netRate = 1 - SELL_FEE_RATE - SELL_TAX_RATE;

  // Nấc đã bán thì số còn lại đã nằm trong khối lượng đang giữ
  let remaining = holding?.quantity ?? 0;
  let cumulativeProfit = 0;
  for (const level of tps) {
    // Nấc đã bán: dùng giá bán thực tế làm mốc cho các nấc sau
    const price =
      level.status === "done" && level.filledPrice ? level.filledPrice : ceilToTick(exchange, base * (1 + level.pct / 100));
    let sellQuantity = 0;
    if (level.status !== "done" && remaining > 0) {
      sellQuantity = tpSellQuantity(level, remaining);
      remaining -= sellQuantity;
    }
    const profit = avgCost ? (price * netRate - avgCost) * sellQuantity : 0;
    cumulativeProfit += profit;
    out.set(level.id, {
      price,
      basePrice: base,
      index: out.size,
      sellQuantity,
      remainingAfter: remaining,
      profit,
      profitPct: avgCost ? ((price * netRate) / avgCost - 1) * 100 : 0,
      cumulativeProfit,
    });
    base = price;
  }
  return out;
}

export function stopLossPrice(position: PositionInput, holding: Holding): number | null {
  if (position.stopLossPct == null || !holding.firstBuyPrice) return null;
  return floorToTick(position.exchange, holding.firstBuyPrice * (1 + position.stopLossPct / 100));
}

export function tpSellQuantity(level: Pick<LevelInput, "sellPct">, quantity: number): number {
  const pct = level.sellPct ?? 100;
  if (pct >= 100) return quantity;
  return Math.min(quantity, roundLot((quantity * pct) / 100));
}

export function isActive(level: Pick<LevelInput, "status">) {
  return level.status === "pending" || level.status === "notified";
}

export type SimulationRow = {
  levelId: number;
  pct: number;
  /** Giá làm mốc để tính % của nấc này */
  basePrice: number;
  /** Nấc làm mốc: nấc trước trong chuỗi, hoặc nấc DCA gần nhất đã khớp; null = mốc là giá vốn TB */
  baseLevelId: number | null;
  /** Mốc là giá khớp thực tế của nấc đã làm */
  baseIsFilled: boolean;
  price: number;
  quantity: number;
  cost: number;
  /** Trạng thái trước khi khớp nấc này */
  quantityBefore: number;
  capitalBefore: number;
  avgBefore: number;
  totalQuantity: number;
  totalCapital: number;
  /** Giá vốn sau khi khớp nấc này */
  avgCost: number;
  breakEven: number;
  /** % giảm của giá mua nấc này so với giá mua đầu */
  dropFromFirstPct: number | null;
  /** % giá cần hồi từ giá khớp nấc này để hòa vốn */
  recoveryPct: number;
  /** Lãi/lỗ tạm tính (đồng) nếu bán hết ngay tại giá khớp nấc này, đã trừ phí và thuế bán */
  pnlAtPrice: number;
  pnlPctAtPrice: number;
  overCapital: boolean;
  belowStop: boolean;
};

/**
 * Chuỗi DCA nối tiếp, theo đúng thứ tự người dùng đặt:
 * - Nấc đầu tiên còn chờ tính % giảm từ giá khớp thực tế của nấc DCA gần nhất đã làm;
 *   chưa khớp nấc nào thì tính từ giá vốn TB (lệnh mua thêm ngoài kế hoạch chỉ làm đổi giá vốn).
 * - Các nấc sau tính từ giá mua của nấc trước.
 * Nấc đã nhắc nhưng chưa ghi lệnh được coi như sẽ khớp.
 */
export function simulateDca(
  position: PositionInput,
  holding: Holding,
  levels: LevelInput[],
): SimulationRow[] {
  const stop = stopLossPrice(position, holding);
  let quantity = holding.quantity;
  let capital = holding.totalCost;
  const lastFilled = levels.filter((l) => l.kind === "dca" && l.status === "done" && l.filledPrice).at(-1);
  let basePrice = lastFilled?.filledPrice ?? holding.avgCost;
  let baseLevelId: number | null = lastFilled?.id ?? null;
  let baseIsFilled = lastFilled != null;
  const rows: SimulationRow[] = [];

  const active = levels.filter((l) => l.kind === "dca" && isActive(l) && l.pct < 0);

  for (const level of active) {
    const avgBefore = quantity > 0 ? capital / quantity : 0;
    if (!basePrice) break;
    const price = floorToTick(position.exchange, basePrice * (1 + level.pct / 100));
    const qty = level.quantity ?? 0;
    const cost = price * qty * (1 + BUY_FEE_RATE);
    const quantityBefore = quantity;
    const capitalBefore = capital;
    quantity += qty;
    capital += cost;
    const avgCost = quantity > 0 ? capital / quantity : 0;
    const breakEven = breakEvenPrice(avgCost);
    rows.push({
      levelId: level.id,
      pct: level.pct,
      basePrice,
      baseLevelId,
      baseIsFilled,
      price,
      quantity: qty,
      cost,
      quantityBefore,
      capitalBefore,
      avgBefore,
      totalQuantity: quantity,
      totalCapital: capital,
      avgCost,
      breakEven,
      dropFromFirstPct: holding.firstBuyPrice ? (price / holding.firstBuyPrice - 1) * 100 : null,
      recoveryPct: (breakEven / price - 1) * 100,
      pnlAtPrice: quantity * price * (1 - SELL_FEE_RATE - SELL_TAX_RATE) - capital,
      pnlPctAtPrice: capital ? ((quantity * price * (1 - SELL_FEE_RATE - SELL_TAX_RATE)) / capital - 1) * 100 : 0,
      overCapital: position.maxCapital != null && capital > position.maxCapital,
      belowStop: stop != null && price <= stop,
    });
    basePrice = price;
    baseLevelId = level.id;
    baseIsFilled = false;
  }
  return rows;
}

type NextLevel = { levelId: number; levelNo: number; price: number };

export type PlanHints = {
  symbol: string;
  avgCost: number;
  quantity: number;
  /** DCA: mốc tính nấc đang chờ đầu tiên (giá khớp nấc gần nhất hoặc giá vốn TB) và nấc đó */
  dca: { base: number; next: NextLevel | null };
  /** Chốt lời: mốc tính nấc đang chờ đầu tiên (giá nấc trước hoặc giá vốn TB) và nấc đó */
  tp: { base: number; next: NextLevel | null };
};

/** Tóm tắt kế hoạch hiện tại để đối chiếu một lệnh mua/bán tay. `levels` theo đúng thứ tự chuỗi. */
export function planHints(position: PositionInput, holding: Holding, levels: LevelInput[]): PlanHints {
  const levelNo = (kind: "dca" | "tp", id: number) => levels.filter((l) => l.kind === kind).findIndex((l) => l.id === id) + 1;

  const dcaRows = simulateDca(position, holding, levels);
  const lastFilled = levels.filter((l) => l.kind === "dca" && l.status === "done" && l.filledPrice).at(-1);
  const dcaNext = dcaRows[0];

  const steps = tpChain(position.exchange, holding.avgCost, levels, holding);
  const tpNextLevel = levels.find((l) => l.kind === "tp" && isActive(l) && steps.has(l.id));
  const tpNextStep = tpNextLevel ? steps.get(tpNextLevel.id)! : null;
  const lastStep = [...steps.values()].at(-1);

  return {
    symbol: position.symbol,
    avgCost: holding.avgCost,
    quantity: holding.quantity,
    dca: {
      base: dcaNext?.basePrice ?? lastFilled?.filledPrice ?? holding.avgCost,
      next: dcaNext ? { levelId: dcaNext.levelId, levelNo: levelNo("dca", dcaNext.levelId), price: dcaNext.price } : null,
    },
    tp: {
      base: tpNextStep?.basePrice ?? lastStep?.price ?? holding.avgCost,
      next: tpNextLevel && tpNextStep ? { levelId: tpNextLevel.id, levelNo: levelNo("tp", tpNextLevel.id), price: tpNextStep.price } : null,
    },
  };
}

export type TradeFit =
  /** Lệnh thực hiện đúng nấc đang chờ */
  | { kind: "match"; level: NextLevel }
  /** Lệnh lệch kế hoạch: có thể thêm thành nấc mới (đã làm) đặt trước nấc đang chờ */
  | { kind: "insert"; pct: number; before: NextLevel | null }
  /** Lệnh ngoài kế hoạch (mua trên giá vốn, bán dưới giá vốn...) */
  | { kind: "none" };

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Đối chiếu một lệnh tay với kế hoạch:
 * - Mua: giá ≥ giá vốn TB → ngoài kế hoạch; giá ≤ nấc DCA đang chờ → khớp nấc đó;
 *   giá dưới giá vốn và dưới mốc nhưng chưa tới nấc → lệch kế hoạch, đề nghị thêm nấc mới.
 * - Bán: đối xứng với chốt lời.
 */
export function classifyTrade(hints: PlanHints, side: "buy" | "sell", price: number): TradeFit {
  if (!hints.quantity && side === "sell") return { kind: "none" };
  if (side === "buy") {
    if (price >= hints.avgCost) return { kind: "none" };
    const next = hints.dca.next;
    if (next && price <= next.price) return { kind: "match", level: next };
    const pct = round1((price / hints.dca.base - 1) * 100);
    return pct < 0 ? { kind: "insert", pct, before: next } : { kind: "none" };
  }
  if (price <= hints.avgCost) return { kind: "none" };
  const next = hints.tp.next;
  if (next && price >= next.price) return { kind: "match", level: next };
  const pct = round1((price / hints.tp.base - 1) * 100);
  return pct > 0 ? { kind: "insert", pct, before: next } : { kind: "none" };
}

export type PriceEvent = {
  kind: "dca" | "tp" | "stop" | "trail";
  levelId: number | null;
  message: string;
};

export type Evaluation = {
  events: PriceEvent[];
  peakPrice: number | null;
};

/** So giá hiện tại với kế hoạch, trả về các cảnh báo cần gửi. */
export function evaluatePrice(
  position: PositionInput,
  holding: Holding,
  levels: LevelInput[],
  price: number,
): Evaluation {
  const events: PriceEvent[] = [];
  const sym = position.symbol;
  if (holding.quantity === 0) return { events, peakPrice: position.peakPrice };

  const stop = stopLossPrice(position, holding);
  const stopHit = stop != null && price <= stop;
  const vsFirst = holding.firstBuyPrice ? (price / holding.firstBuyPrice - 1) * 100 : 0;
  const vsAvg = (price / holding.avgCost - 1) * 100;

  if (stopHit && !position.stopNotifiedAt) {
    events.push({
      kind: "stop",
      levelId: null,
      message:
        `⛔ ${sym} ${formatPrice(price)} (${formatPct(vsFirst)} so với giá mua đầu) đã thủng ngưỡng ` +
        `cắt lỗ ${formatPct(position.stopLossPct)}. Ngừng DCA và xem lại luận điểm đầu tư.`,
    });
  }

  if (!stopHit) {
    for (const row of simulateDca(position, holding, levels)) {
      const level = levels.find((l) => l.id === row.levelId);
      if (level?.status !== "pending" || price > row.price) continue;
      // Ước tính lại theo giá thực tế lúc chạm nấc
      const newCapital = row.capitalBefore + price * row.quantity * (1 + BUY_FEE_RATE);
      const newAvg = newCapital / (row.quantityBefore + row.quantity);
      const over = position.maxCapital != null && newCapital > position.maxCapital;
      events.push({
        kind: "dca",
        levelId: row.levelId,
        message:
          `📉 ${sym} ${formatPrice(price)} (${formatPct(vsFirst)} so với giá mua đầu) chạm nấc DCA ` +
          `${formatPct(row.pct)}: mua ${formatQty(row.quantity)} cp (~${formatMoney(price * row.quantity)}). ` +
          `Giá vốn sau DCA ≈ ${formatPrice(newAvg)}.` +
          (over ? ` ⚠️ Vượt giới hạn vốn ${formatMoney(position.maxCapital)}.` : ""),
      });
    }
  }

  const tps = tpChain(position.exchange, holding.avgCost, levels, holding);
  for (const level of levels) {
    const step = tps.get(level.id);
    if (!step || level.status !== "pending" || price < step.price || step.sellQuantity === 0) continue;
    const qty = step.sellQuantity;
    const profit = (price * (1 - SELL_FEE_RATE - SELL_TAX_RATE) - holding.avgCost) * qty;
    events.push({
      kind: "tp",
      levelId: level.id,
      message:
        `🎯 ${sym} ${formatPrice(price)} chạm nấc chốt lời ${step.index + 1} (${formatPct(level.pct)} từ ` +
        `${formatPrice(step.basePrice)}): bán ${formatQty(qty)} cp, còn lại ${formatQty(step.remainingAfter)} cp. ` +
        `${profit >= 0 ? "Lãi" : "Lỗ"} ≈ ${formatMoney(Math.abs(profit))} ` +
        `(giá vốn ${formatPrice(holding.avgCost)}).`,
    });
  }

  const peakPrice = Math.max(position.peakPrice ?? price, price);
  if (position.trailingPct) {
    const trailPrice = floorToTick(position.exchange, peakPrice * (1 - position.trailingPct / 100));
    const inProfit = peakPrice > breakEvenPrice(holding.avgCost);
    if (inProfit && price <= trailPrice && position.trailNotifiedPeak !== peakPrice) {
      events.push({
        kind: "trail",
        levelId: null,
        message:
          `🔻 ${sym} ${formatPrice(price)} đã giảm ${formatPct((price / peakPrice - 1) * 100)} từ đỉnh ` +
          `${formatPrice(peakPrice)} (trailing stop ${formatPct(position.trailingPct, false)}). ` +
          `Cân nhắc chốt phần còn lại, đang ${formatPct(vsAvg)} so với giá vốn.`,
      });
    }
  }

  return { events, peakPrice };
}
