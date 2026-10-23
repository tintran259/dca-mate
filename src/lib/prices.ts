import "server-only";

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
