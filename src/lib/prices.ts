import "server-only";
import { cacheLife } from "next/cache";
import type { DailyClose, IntradayCandle } from "./portfolio";

// Các API công khai không chính thức của công ty chứng khoán: có thể đổi bất cứ lúc nào,
// nên thử lần lượt nhiều nguồn, nguồn này lỗi thì chuyển sang nguồn khác.

type Provider = {
  name: string;
  fetch: (symbols: string[]) => Promise<Map<string, number>>;
};

const TIMEOUT_MS = 8_000;
const HEADERS = { "User-Agent": "Mozilla/5.0 (DCA Mate)", Accept: "application/json" };

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: HEADERS,
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return (await res.json()) as T;
}

// VPS: lấy nhiều mã trong 1 request, giá tính theo nghìn đồng
const vps: Provider = {
  name: "VPS",
  async fetch(symbols) {
    type Row = { sym: string; lastPrice: number; r: number };
    const rows = await getJson<Row[]>(
      `https://bgapidatafeed.vps.com.vn/getliststockdata/${symbols.join(",")}`,
    );
    const out = new Map<string, number>();
    for (const row of rows) {
      const price = row.lastPrice || row.r;
      if (price > 0) out.set(row.sym.toUpperCase(), Math.round(price * 1000));
    }
    return out;
  },
};

// SSI iBoard: từng mã một, giá tính theo đồng
const ssi: Provider = {
  name: "SSI",
  async fetch(symbols) {
    type Body = { data?: { matchedPrice?: number; refPrice?: number } };
    const out = new Map<string, number>();
    await Promise.all(
      symbols.map(async (sym) => {
        const body = await getJson<Body>(`https://iboard-query.ssi.com.vn/stock/${sym}`);
        const price = body.data?.matchedPrice || body.data?.refPrice;
        if (price && price > 0) out.set(sym, Math.round(price));
      }),
    );
    return out;
  },
};

// DNSE: nến ngày, lấy giá đóng cửa của nến gần nhất (nghìn đồng)
const dnse: Provider = {
  name: "DNSE",
  async fetch(symbols) {
    type Body = { c?: number[] };
    const to = Math.floor(Date.now() / 1000);
    const from = to - 14 * 86_400;
    const out = new Map<string, number>();
    await Promise.all(
      symbols.map(async (sym) => {
        const body = await getJson<Body>(
          `https://services.entrade.com.vn/chart-api/v2/ohlcs/stock?from=${from}&to=${to}&symbol=${sym}&resolution=1D`,
        );
        const last = body.c?.at(-1);
        if (last && last > 0) out.set(sym, Math.round(last * 1000));
      }),
    );
    return out;
  },
};

const PROVIDERS = [vps, ssi, dnse];

// Chỉ dùng khi test (E2E): MOCK_PRICES="HPG:21000,CTG:30950" thay cho mọi nguồn giá thật,
// mã không có trong danh sách coi như không lấy được giá
function mockPrices(): Map<string, number> | null {
  const raw = process.env.MOCK_PRICES;
  if (!raw) return null;
  const out = new Map<string, number>();
  for (const pair of raw.split(",")) {
    const [sym, price] = pair.split(":");
    if (sym && Number(price) > 0) out.set(sym.trim().toUpperCase(), Number(price));
  }
  return out;
}

const MARKETS: Record<string, "HOSE" | "HNX" | "UPCOM"> = {
  STO: "HOSE",
  STX: "HNX",
  UPX: "UPCOM",
  HOSE: "HOSE",
  HNX: "HNX",
  UPCOM: "UPCOM",
};

/** Tra sàn và giá hiện tại của 1 mã, dùng để điền sẵn form. */
export async function lookupSymbol(
  symbol: string,
): Promise<{ exchange: "HOSE" | "HNX" | "UPCOM"; price: number } | null> {
  const sym = symbol.toUpperCase();
  const mock = mockPrices();
  if (mock) {
    const price = mock.get(sym);
    return price ? { exchange: "HOSE", price } : null;
  }
  try {
    type Row = { sym: string; marketId: string; lastPrice: number; r: number };
    const rows = await getJson<Row[]>(`https://bgapidatafeed.vps.com.vn/getliststockdata/${sym}`);
    const row = rows.find((r) => r.sym.toUpperCase() === sym);
    const exchange = row && MARKETS[row.marketId];
    if (row && exchange) return { exchange, price: Math.round((row.lastPrice || row.r) * 1000) };
  } catch {
    // thử nguồn khác
  }
  try {
    type Body = { data?: { exchange?: string; matchedPrice?: number; refPrice?: number } };
    const body = await getJson<Body>(`https://iboard-query.ssi.com.vn/stock/${sym}`);
    const exchange = MARKETS[body.data?.exchange?.toUpperCase() ?? ""];
    const price = body.data?.matchedPrice || body.data?.refPrice;
    if (exchange && price) return { exchange, price: Math.round(price) };
  } catch {
    // bỏ qua
  }
  return null;
}

export type PriceResult = {
  prices: Map<string, number>;
  sources: Record<string, string>;
  errors: string[];
};

export async function fetchPrices(symbols: string[]): Promise<PriceResult> {
  const wanted = [...new Set(symbols.map((s) => s.toUpperCase()))];
  const prices = new Map<string, number>();
  const sources: Record<string, string> = {};
  const errors: string[] = [];

  const mock = mockPrices();
  if (mock) {
    for (const sym of wanted) {
      const price = mock.get(sym);
      if (price) {
        prices.set(sym, price);
        sources[sym] = "MOCK";
      }
    }
    return { prices, sources, errors };
  }

  for (const provider of PROVIDERS) {
    const missing = wanted.filter((s) => !prices.has(s));
    if (missing.length === 0) break;
    try {
      const got = await provider.fetch(missing);
      for (const [sym, price] of got) {
        if (!prices.has(sym)) {
          prices.set(sym, price);
          sources[sym] = provider.name;
        }
      }
    } catch (err) {
      errors.push(`${provider.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { prices, sources, errors };
}

/**
 * Giá đóng cửa theo ngày từ `fromDate` (YYYY-MM-DD) tới nay, nguồn DNSE (nến ngày, nghìn đồng).
 * Cache vài giờ: giá đóng cửa ngày cũ không đổi, điểm hôm nay đã lấy từ giá hiện tại.
 * Lỗi thì ném ra (không cache), để lần sau thử lại.
 */
export async function fetchDailyCloses(symbol: string, fromDate: string): Promise<DailyClose[]> {
  "use cache";
  cacheLife("hours");
  if (process.env.MOCK_PRICES) return [];
  type Body = { t?: number[]; c?: number[] };
  const from = Math.floor(Date.parse(`${fromDate}T00:00:00+07:00`) / 1000) - 86_400;
  const to = Math.floor(Date.now() / 1000);
  const res = await fetch(
    `https://services.entrade.com.vn/chart-api/v2/ohlcs/stock?from=${from}&to=${to}&symbol=${symbol}&resolution=1D`,
    { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) },
  );
  if (!res.ok) throw new Error(`DNSE ${res.status}`);
  const body = (await res.json()) as Body;
  const t = body.t ?? [];
  const c = body.c ?? [];
  // Mốc thời gian của nến là 9:00 giờ VN; cộng 7 tiếng để lấy đúng ngày theo giờ VN
  return t.flatMap((sec, i) =>
    c[i] > 0 ? [{ date: new Date((sec + 7 * 3600) * 1000).toISOString().slice(0, 10), close: Math.round(c[i] * 1000) }] : [],
  );
}

/**
 * Nến 5 phút của vài ngày gần nhất (giờ VN), dùng cho khung 1D. Cache vài phút vì giá trong phiên đổi liên tục.
 * Lỗi thì ném ra (không cache).
 */
export async function fetchIntraday(symbol: string): Promise<IntradayCandle[]> {
  "use cache";
  cacheLife("minutes");
  if (process.env.MOCK_PRICES) return [];
  type Body = { t?: number[]; c?: number[] };
  const to = Math.floor(Date.now() / 1000);
  // Lùi 7 ngày để luôn có phiên gần nhất, kể cả sau kỳ nghỉ cuối tuần
  const from = to - 7 * 86_400;
  const res = await fetch(
    `https://services.entrade.com.vn/chart-api/v2/ohlcs/stock?from=${from}&to=${to}&symbol=${symbol}&resolution=5`,
    { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) },
  );
  if (!res.ok) throw new Error(`DNSE ${res.status}`);
  const body = (await res.json()) as Body;
  const c = body.c ?? [];
  return (body.t ?? []).flatMap((sec, i) => {
    if (!(c[i] > 0)) return [];
    const vn = new Date((sec + 7 * 3600) * 1000).toISOString();
    return [{ date: vn.slice(0, 10), time: vn.slice(11, 16), close: Math.round(c[i] * 1000) }];
  });
}
