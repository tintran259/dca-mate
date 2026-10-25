import type { Exchange } from "@/db/schema";

export const EXCHANGES: Exchange[] = ["HOSE", "HNX", "UPCOM"];

export const LOT_SIZE = 100;

// Phí giao dịch mặc định, có thể ghi đè bằng biến môi trường
export const BUY_FEE_RATE = Number(process.env.NEXT_PUBLIC_BUY_FEE_RATE ?? 0.0015);
export const SELL_FEE_RATE = Number(process.env.NEXT_PUBLIC_SELL_FEE_RATE ?? 0.0015);
export const SELL_TAX_RATE = 0.001;

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

export function buyFee(price: number, quantity: number): number {
  return Math.round(price * quantity * BUY_FEE_RATE);
}

export function sellFee(price: number, quantity: number): number {
  return Math.round(price * quantity * SELL_FEE_RATE);
}

export function sellTax(price: number, quantity: number): number {
  return Math.round(price * quantity * SELL_TAX_RATE);
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
