import type { Exchange } from "@/db/schema";
import { formatMoney, formatPrice, formatQty } from "./format";
import { tickSize } from "./market";

// Kiểm tra giá trị nhập, dùng chung cho form (báo lỗi ngay dưới ô) và server action.
// Ô còn trống không báo lỗi ở đây; ô bắt buộc do thuộc tính `required` lo.

export const MIN_PRICE = 1_000;
export const MAX_PRICE = 5_000_000;
/** Phí, thuế không thể vượt 1% giá trị lệnh (thực tế khoảng 0,15% và 0,1%) */
export const MAX_COST_RATE = 0.01;

export function priceError(exchange: Exchange, price: number | null): string | null {
  if (price == null) return null;
  if (price < MIN_PRICE) return `Giá tính theo đồng, tối thiểu ${formatPrice(MIN_PRICE)}.`;
  if (price > MAX_PRICE) return `Giá tối đa ${formatPrice(MAX_PRICE)}.`;
  const tick = tickSize(exchange, price);
  if (price % tick !== 0) {
    const lo = Math.floor(price / tick) * tick;
    return `Giá phải theo bước ${tick}đ của ${exchange === "UPCOM" ? "UPCoM" : exchange}, VD ${formatPrice(lo)} hoặc ${formatPrice(lo + tick)}.`;
  }
  return null;
}

export type TradeField = "price" | "quantity" | "fee" | "tax";
export type TradeErrors = Partial<Record<TradeField, string>>;

export function tradeErrors(input: {
  exchange: Exchange;
  side: "buy" | "sell";
  price: number | null;
  quantity: number | null;
  fee: number | null;
  tax: number | null;
  /** Đang giữ, để chặn bán quá số */
  holdingQty?: number;
}): TradeErrors {
  const errors: TradeErrors = {};
  const price = priceError(input.exchange, input.price);
  if (price) errors.price = price;

  const q = input.quantity;
  if (q != null) {
    if (q <= 0) errors.quantity = "Khối lượng phải lớn hơn 0.";
    else if (input.side === "sell" && input.holdingQty != null && q > input.holdingQty)
      errors.quantity = `Chỉ đang giữ ${formatQty(input.holdingQty)} cp, không bán quá số này.`;
  }

  const value = (input.price ?? 0) * (q ?? 0);
  const maxCost = Math.round(value * MAX_COST_RATE);
  if (input.fee != null && input.fee < 0) errors.fee = "Phí không được âm.";
  else if (input.fee != null && value > 0 && input.fee > maxCost)
    errors.fee = `Phí tối đa 1% giá trị lệnh (${formatMoney(maxCost)}).`;
  if (input.tax != null && input.tax < 0) errors.tax = "Thuế không được âm.";
  else if (input.tax != null && value > 0 && input.tax > maxCost)
    errors.tax = `Thuế tối đa 1% giá trị lệnh (${formatMoney(maxCost)}).`;
  return errors;
}

export function firstError(errors: Partial<Record<string, string>>): string | null {
  return Object.values(errors).find(Boolean) ?? null;
}

// ---------- Nấc kế hoạch ----------

export type LevelErrors = { pct?: string; amount?: string };

/** Nấc DCA: % giảm (số dương nhập trong form) và số cổ mua thêm */
export function dcaLevelErrors(pct: number | null, quantity: number | null): LevelErrors {
  const errors: LevelErrors = {};
  if (pct != null && (pct < 0.1 || pct > 99)) errors.pct = "Giá giảm từ 0,1% đến 99%.";
  if (quantity != null) {
    if (quantity <= 0) errors.amount = "Khối lượng phải lớn hơn 0.";
    else if (quantity % 100 !== 0) errors.amount = "Khối lượng là bội số của 100.";
  }
  return errors;
}

/** Nấc chốt lời: % tăng và % bán trên số cổ còn lại */
export function tpLevelErrors(pct: number | null, sellPct: number | null): LevelErrors {
  const errors: LevelErrors = {};
  if (pct != null && (pct < 0.1 || pct > 1000)) errors.pct = "Giá tăng từ 0,1% đến 1000%.";
  if (sellPct != null && (sellPct < 0.1 || sellPct > 100)) errors.amount = "% bán từ 0,1% đến 100%.";
  return errors;
}
