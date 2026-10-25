import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { connection } from "next/server";
import { getDb } from "@/db";
import {
  alerts,
  planLevels,
  positions,
  transactions,
  type Alert,
  type PlanLevel,
  type Position,
  type Transaction,
} from "@/db/schema";
import {
  breakEvenPrice,
  computeHolding,
  isActive,
  levelTriggerPrice,
  simulateDca,
  sortTransactions,
  tpChain,
  tpSellQuantity,
  unrealizedPnl,
  planHints,
  type Holding,
  type PlanHints,
  type SimulationRow,
} from "./calc";
import { todayVN } from "./format";
import {
  buildIntraday,
  buildPortfolioHistory,
  buildPriceHistory,
  type IntradayPoint,
  type PortfolioPoint,
  type PricePoint,
} from "./portfolio";
import { fetchDailyCloses, fetchIntraday } from "./prices";

export type LevelView = PlanLevel & {
  trigger: number | null;
  /** % giá hiện tại cần đi để chạm nấc (âm = cần giảm, dương = cần tăng) */
  distancePct: number | null;
  /** Giá vốn dự kiến sau khi khớp nấc DCA này */
  avgAfter: number | null;
  /** Số cổ phiếu bán dự kiến (nấc chốt lời) */
  sellQuantity: number | null;
  /** Số cổ còn lại sau khi bán nấc chốt lời này */
  tpRemaining: number | null;
  /** Tiền lời dự kiến khi chạm nấc chốt lời này */
  tpProfit: number | null;
};

export type PositionView = {
  position: Position;
  holding: Holding;
  levels: LevelView[];
  marketValue: number;
  pnl: number;
  pnlPct: number | null;
  breakEven: number;
  /** Nấc đang hoạt động gần giá hiện tại nhất */
  nextLevel: LevelView | null;
};

/** Thứ tự nối tiếp của chuỗi nấc: theo sort_order, cùng giá trị thì theo id */
export function orderLevels<T extends { id: number; sortOrder: number }>(levels: T[]): T[] {
  return [...levels].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
}

function buildView(position: Position, txs: Transaction[], levels: PlanLevel[]): PositionView {
  const holding = computeHolding(txs);
  const price = position.lastPrice;
  const ordered = orderLevels(levels);
  const chain = new Map(simulateDca(position, holding, ordered).map((r) => [r.levelId, r]));
  const tps = tpChain(position.exchange, holding.avgCost, ordered, holding);
  const levelViews: LevelView[] = ordered
    .map((level) => {
      const trigger =
        level.kind === "dca"
          ? (chain.get(level.id)?.price ?? level.filledPrice ?? levelTriggerPrice(level, position, holding))
          : (tps.get(level.id)?.price ?? levelTriggerPrice(level, position, holding));
      return {
        ...level,
        trigger,
        avgAfter: chain.get(level.id)?.avgCost ?? null,
        distancePct: trigger && price ? (trigger / price - 1) * 100 : null,
        sellQuantity: level.kind === "tp" ? (tps.get(level.id)?.sellQuantity ?? tpSellQuantity(level, holding.quantity)) : null,
        tpRemaining: tps.get(level.id)?.remainingAfter ?? null,
        tpProfit: tps.get(level.id)?.profit ?? null,
      };
    })
    // DCA trước, chốt lời sau; trong mỗi loại giữ thứ tự tạo (thứ tự nối tiếp)
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "dca" ? -1 : 1));

  const marketValue = price ? price * holding.quantity : holding.totalCost;
  const pnl = price ? unrealizedPnl(holding, price) : 0;
  const nextLevel =
    levelViews
      .filter((l) => isActive(l) && l.distancePct != null)
      .sort((a, b) => Math.abs(a.distancePct!) - Math.abs(b.distancePct!))[0] ?? null;

  return {
    position,
    holding,
    levels: levelViews,
    marketValue,
    pnl,
    pnlPct: price && holding.totalCost ? (pnl / holding.totalCost) * 100 : null,
    breakEven: breakEvenPrice(holding.avgCost),
    nextLevel,
  };
}

async function loadViews(where?: ReturnType<typeof eq>): Promise<PositionView[]> {
  await connection();
  const db = await getDb();
  const rows = await db.select().from(positions).where(where).orderBy(positions.symbol);
  if (rows.length === 0) return [];
  const ids = rows.map((p) => p.id);
  const [txs, levels] = await Promise.all([
    db.select().from(transactions).where(inArray(transactions.positionId, ids)),
    db.select().from(planLevels).where(inArray(planLevels.positionId, ids)),
  ]);
  return rows.map((p) =>
    buildView(
      p,
      txs.filter((t) => t.positionId === p.id),
      levels.filter((l) => l.positionId === p.id),
    ),
  );
}

export function getOpenPositions() {
  return loadViews(eq(positions.status, "open"));
}

export async function getClosedPositions() {
  return loadViews(eq(positions.status, "closed"));
}

export type PositionDetail = PositionView & {
  hints: PlanHints;
  transactions: Transaction[];
  simulation: SimulationRow[];
  alerts: Alert[];
};

export async function getPositionDetail(id: number): Promise<PositionDetail | null> {
  await connection();
  const db = await getDb();
  const [position] = await db.select().from(positions).where(eq(positions.id, id));
  if (!position) return null;
  const [txs, levels, positionAlerts] = await Promise.all([
    db.select().from(transactions).where(eq(transactions.positionId, id)),
    db.select().from(planLevels).where(eq(planLevels.positionId, id)),
    db.select().from(alerts).where(eq(alerts.positionId, id)).orderBy(desc(alerts.createdAt)).limit(20),
  ]);
  const view = buildView(position, txs, levels);
  return {
    ...view,
    hints: planHints(position, view.holding, orderLevels(levels)),
    transactions: sortTransactions(txs).reverse(),
    simulation: simulateDca(position, view.holding, view.levels),
    alerts: positionAlerts,
  };
}

export type AlertRow = Alert & { symbol: string };

export async function getAlerts(status?: Alert["status"]): Promise<AlertRow[]> {
  await connection();
  const db = await getDb();
  const rows = await db
    .select({ alert: alerts, symbol: positions.symbol })
    .from(alerts)
    .innerJoin(positions, eq(alerts.positionId, positions.id))
    .where(status ? eq(alerts.status, status) : undefined)
    .orderBy(desc(alerts.createdAt))
    .limit(100);
  return rows.map((r) => ({ ...r.alert, symbol: r.symbol }));
}

export async function countNewAlerts(): Promise<number> {
  await connection();
  const db = await getDb();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(alerts)
    .where(and(eq(alerts.status, "new")));
  return row?.n ?? 0;
}

export type PortfolioHistory = {
  points: PortfolioPoint[];
  /** Giá đóng cửa của các mã đang giữ, tối đa 1 năm, không phụ thuộc ngày mua */
  prices: PricePoint[];
  /** Số cổ, vốn và giá vốn TB hiện tại của các mã đang giữ (đường giá vốn, giá trị trong phiên) */
  holdings: Record<string, { quantity: number; totalCost: number; avgCost: number }>;
  /** Phiên gần nhất (khung 1D): nến 5 phút và giá tham chiếu (đóng cửa phiên trước) của từng mã */
  intraday: { date: string | null; points: IntradayPoint[]; refPrices: Record<string, number> };
  /** Các mã theo thứ tự tạo vị thế: màu trên biểu đồ gắn theo thứ tự này nên không đổi khi lọc */
  symbols: string[];
};

/** Giá trị danh mục và giá các mã theo ngày cho biểu đồ ở trang tổng quan. */
export async function getPortfolioHistory(): Promise<PortfolioHistory> {
  await connection();
  const db = await getDb();
  const [rows, txs] = await Promise.all([
    db.select().from(positions).orderBy(positions.id),
    db.select().from(transactions),
  ]);
  const list = rows.map((p) => ({
    symbol: p.symbol,
    status: p.status,
    lastPrice: p.lastPrice,
    txs: txs.filter((t) => t.positionId === p.id),
  }));
  const symbols = [...new Set(list.filter((p) => p.txs.length > 0).map((p) => p.symbol))];
  const today = todayVN();
  const yearAgo = new Date(Date.parse(`${today}T00:00:00Z`) - 366 * 86_400_000).toISOString().slice(0, 10);
  const closes = new Map(
    await Promise.all(
      symbols.map(async (sym) => {
        const firstTrade = list
          .filter((p) => p.symbol === sym)
          .flatMap((p) => p.txs.map((t) => t.tradeDate))
          .sort()[0];
        const from = firstTrade < yearAgo ? firstTrade : yearAgo;
        // Nguồn giá lỗi: biểu đồ vẫn vẽ được theo giá khớp lệnh và giá hiện tại
        const data = await fetchDailyCloses(sym, from).catch(() => []);
        return [sym, data] as const;
      }),
    ),
  );
  const held = list
    .filter((p) => p.status === "open")
    .map((p) => ({ ...p, holding: computeHolding(p.txs) }))
    .filter((p) => p.holding.quantity > 0);
  const candles = new Map(
    await Promise.all(held.map(async (p) => [p.symbol, await fetchIntraday(p.symbol).catch(() => [])] as const)),
  );
  const session = buildIntraday(candles);
  // Giá tham chiếu = giá đóng cửa gần nhất trước phiên đang xem
  const refPrices = Object.fromEntries(
    held.flatMap((p) => {
      const before = (closes.get(p.symbol) ?? []).filter((c) => session.date && c.date < session.date);
      const ref = before.at(-1)?.close;
      return ref ? [[p.symbol, ref]] : [];
    }),
  );
  return {
    points: buildPortfolioHistory(list, closes, today),
    prices: buildPriceHistory(held, closes, today),
    holdings: Object.fromEntries(
      held.map((p) => [p.symbol, { quantity: p.holding.quantity, totalCost: p.holding.totalCost, avgCost: p.holding.avgCost }]),
    ),
    intraday: { ...session, refPrices },
    symbols,
  };
}
