import type { Exchange } from "@/db/schema";

export const EXCHANGES: Exchange[] = ["HOSE", "HNX", "UPCOM"];

export const LOT_SIZE = 100;

/** Tỷ lệ phí, thuế (VD 0.0015 = 0,15%). Phí mua/bán đặt trong trang Cài đặt, thuế bán theo luật. */
export type FeeRates = { buy: number; sell: number; tax: number };

export const SELL_TAX_RATE = 0.001;

/** Khi chưa lưu trong Cài đặt: 0,15% (hoặc theo biến môi trường cũ NEXT_PUBLIC_*_FEE_RATE nếu có) */
export const DEFAULT_FEES: FeeRates = {
  buy: Number(process.env.NEXT_PUBLIC_BUY_FEE_RATE || 0.0015),
  sell: Number(process.env.NEXT_PUBLIC_SELL_FEE_RATE || 0.0015),
  tax: SELL_TAX_RATE,
};

/** Phần còn lại sau phí bán và thuế khi bán 1 đồng giá trị */
export function netSellRate(fees: FeeRates): number {
  return 1 - fees.sell - fees.tax;
}

/** Lỗi khi nhập % phí (đơn vị %, VD 0,15). Phí công ty chứng khoán thực tế từ 0% đến dưới 1%. */
export function feePctError(pct: number | null): string | null {
  if (pct == null || !Number.isFinite(pct)) return "Nhập % phí, VD 0,15.";
  if (pct < 0) return "Phí không được âm.";
  if (pct >= 1) return "Phí phải dưới 1%. Ghi theo %, VD 0,15 nghĩa là 0,15%.";
  return null;
}

/** 0.0015 → "0,15%" */
export function formatRate(rate: number): string {
  return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 3 }).format(rate * 100)}%`;
}

/** Bước giá theo sàn. HOSE: <10k → 10đ, 10k–<50k → 50đ, ≥50k → 100đ. HNX/UPCoM: 100đ. */
export function tickSize(exchange: Exchange, price: number): number {
  if (exchange !== "HOSE") return 100;
  if (price < 10_000) return 10;
  if (price < 50_000) return 50;
  return 100;
}

// Sai số nhỏ để phép nhân số thực (VD 21000 × 1.1 = 23100.000000000004) không làm nhảy sang bước giá kế tiếp
const EPS = 1e-6;

export function floorToTick(exchange: Exchange, price: number): number {
  const tick = tickSize(exchange, price);
  return Math.floor(price / tick + EPS) * tick;
}

export function ceilToTick(exchange: Exchange, price: number): number {
  const tick = tickSize(exchange, price);
  return Math.ceil(price / tick - EPS) * tick;
}

/** Làm tròn khối lượng xuống lô chẵn 100, tối thiểu 100 nếu khối lượng > 0. */
export function roundLot(quantity: number): number {
  if (quantity <= 0) return 0;
  return Math.max(LOT_SIZE, Math.floor(quantity / LOT_SIZE) * LOT_SIZE);
}

export function buyFee(price: number, quantity: number, fees: FeeRates): number {
  return Math.round(price * quantity * fees.buy);
}

export function sellFee(price: number, quantity: number, fees: FeeRates): number {
  return Math.round(price * quantity * fees.sell);
}

export function sellTax(price: number, quantity: number, fees: FeeRates): number {
  return Math.round(price * quantity * fees.tax);
}

/** Trong phiên: T2–T6, 9:00–11:30 và 13:00–15:00 giờ Việt Nam (nghỉ trưa thì giá đứng yên). */
export function isTradingHours(now = new Date()): boolean {
  const vn = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
  const day = vn.getDay();
  const minutes = vn.getHours() * 60 + vn.getMinutes();
  const morning = minutes >= 9 * 60 && minutes <= 11 * 60 + 30;
  const afternoon = minutes >= 13 * 60 && minutes <= 15 * 60;
  return day >= 1 && day <= 5 && (morning || afternoon);
}
