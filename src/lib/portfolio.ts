import { computeHolding, type TxInput } from "./calc";

export type DailyClose = { date: string; close: number };

export type HistoryPosition = {
  symbol: string;
  lastPrice: number | null;
  txs: TxInput[];
};

/** Một điểm trên biểu đồ: giá trị thị trường (giá × số cổ đang giữ) và vốn đang rót tại cuối ngày đó. */
export type PortfolioPoint = {
  date: string;
  value: number;
  capital: number;
  bySymbol: Record<string, number>;
};

/** Giá gần nhất có ngày ≤ date trong danh sách đã sắp xếp tăng dần theo ngày */
function priceOn(list: DailyClose[], date: string): number | null {
  let lo = 0;
  let hi = list.length - 1;
  let found: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].date <= date) {
      found = list[mid].close;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/**
 * Dựng chuỗi giá trị danh mục theo ngày, từ ngày mua đầu tiên tới hôm nay.
 * Giá mỗi ngày lấy từ giá đóng cửa; ngày chưa có giá đóng cửa thì dùng giá khớp của lệnh gần nhất;
 * điểm hôm nay dùng giá hiện tại (lastPrice) để khớp với số liệu tổng quan.
 */
export function buildPortfolioHistory(
  positions: HistoryPosition[],
  closes: Map<string, DailyClose[]>,
  today: string,
): PortfolioPoint[] {
  const withTxs = positions.filter((p) => p.txs.length > 0);
  if (withTxs.length === 0) return [];

  const start = withTxs.flatMap((p) => p.txs.map((t) => t.tradeDate)).sort()[0];
  const dates = new Set<string>([today]);
  for (const p of withTxs) {
    for (const t of p.txs) dates.add(t.tradeDate);
    for (const c of closes.get(p.symbol) ?? []) if (c.date >= start && c.date <= today) dates.add(c.date);
  }

  // Giá theo lệnh: mốc dự phòng khi chưa có giá đóng cửa
  const tradePrices = new Map(
    withTxs.map((p) => [
      p,
      [...p.txs]
        .sort((a, b) => (a.tradeDate === b.tradeDate ? a.id - b.id : a.tradeDate < b.tradeDate ? -1 : 1))
        .map((t) => ({ date: t.tradeDate, close: t.price })),
    ]),
  );
  const sortedCloses = new Map(
    [...closes].map(([sym, list]) => [sym, [...list].sort((a, b) => (a.date < b.date ? -1 : 1))]),
  );

  return [...dates].sort().map((date) => {
    const bySymbol: Record<string, number> = {};
    let value = 0;
    let capital = 0;
    for (const p of withTxs) {
      const holding = computeHolding(p.txs.filter((t) => t.tradeDate <= date));
      if (holding.quantity === 0) continue;
      const price =
        (date === today ? p.lastPrice : null) ??
        priceOn(sortedCloses.get(p.symbol) ?? [], date) ??
        priceOn(tradePrices.get(p)!, date) ??
        holding.avgCost;
      const v = price * holding.quantity;
      bySymbol[p.symbol] = (bySymbol[p.symbol] ?? 0) + v;
      value += v;
      capital += holding.totalCost;
    }
    return { date, value, capital, bySymbol };
  });
}

/** Một điểm giá: giá đóng cửa của từng mã đang giữ trong ngày đó */
export type PricePoint = { date: string; closes: Record<string, number> };

/**
 * Lịch sử giá của các mã đang giữ (không phụ thuộc ngày mua), để xem biến động giá kể cả mã vừa mua.
 * Điểm hôm nay dùng giá hiện tại.
 */
export function buildPriceHistory(
  held: { symbol: string; lastPrice: number | null }[],
  closes: Map<string, DailyClose[]>,
  today: string,
): PricePoint[] {
  const byDate = new Map<string, Record<string, number>>();
  for (const { symbol } of held) {
    for (const c of closes.get(symbol) ?? []) {
      if (c.date > today) continue;
      byDate.set(c.date, { ...byDate.get(c.date), [symbol]: c.close });
    }
  }
  const todayCloses = { ...byDate.get(today) };
  for (const { symbol, lastPrice } of held) if (lastPrice) todayCloses[symbol] = lastPrice;
  if (Object.keys(todayCloses).length > 0) byDate.set(today, todayCloses);
  return [...byDate].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, closes]) => ({ date, closes }));
}

/** Khung thời gian dài hơn 1 ngày trên biểu đồ */
export type Period = "1w" | "1m" | "3m" | "6m" | "1y";

const MONTHS_BACK: Record<Exclude<Period, "1w">, number> = { "1m": 0, "3m": 2, "6m": 5, "1y": 11 };

/**
 * Ngày bắt đầu của khung, tính tròn theo lịch (không lấn sang ngày của tháng/tuần trước):
 * 1W từ thứ Hai tuần này, 1M từ ngày 1 tháng này, 3M/6M/1Y từ ngày 1 của tháng cách 2/5/11 tháng.
 */
export function periodStart(period: Period, today: string): string {
  const d = new Date(`${today}T00:00:00Z`);
  if (period === "1w") {
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  }
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - MONTHS_BACK[period], 1)).toISOString().slice(0, 10);
}

/** Nến trong phiên (giờ VN) */
export type IntradayCandle = { date: string; time: string; close: number };
export type IntradayPoint = { time: string; closes: Record<string, number> };

/**
 * Gộp nến của phiên gần nhất cho các mã. Mã nào chưa có nến ở một mốc giờ (chưa khớp lệnh)
 * thì giữ giá của mốc trước để đường giá liền mạch.
 */
export function buildIntraday(candles: Map<string, IntradayCandle[]>): { date: string | null; points: IntradayPoint[] } {
  const all = [...candles.values()].flat();
  if (all.length === 0) return { date: null, points: [] };
  const date = all.reduce((latest, c) => (c.date > latest ? c.date : latest), "");
  const bySymbol = [...candles].map(
    ([sym, list]) => [sym, new Map(list.filter((c) => c.date === date).map((c) => [c.time, c.close]))] as const,
  );
  const times = [...new Set(all.filter((c) => c.date === date).map((c) => c.time))].sort();
  const last: Record<string, number> = {};
  const points = times.map((time) => {
    for (const [sym, byTime] of bySymbol) {
      const close = byTime.get(time);
      if (close != null) last[sym] = close;
    }
    return { time, closes: { ...last } };
  });
  return { date, points };
}
