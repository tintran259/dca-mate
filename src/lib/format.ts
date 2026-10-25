const intFormat = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat("vi-VN", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const twoDecimal = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 });

/** 25000 → "25.000" */
export function formatPrice(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return intFormat.format(Math.round(value));
}

export const formatQty = formatPrice;

/** Số tiền dạng gọn: 1,23 tỷ / 23,4 tr / 950.000đ */
export function formatMoney(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}${twoDecimal.format(abs / 1e9)} tỷ`;
  if (abs >= 1e6) return `${sign}${oneDecimal.format(abs / 1e6)} tr`;
  return `${sign}${intFormat.format(abs)}đ`;
}

/** 7 → "+7,0%" (signed) hoặc "7,0%" */
export function formatPct(value: number | null | undefined, signed = true): string {
  if (value == null || Number.isNaN(value) || !Number.isFinite(value)) return "—";
  const body = oneDecimal.format(Math.abs(value));
  if (!signed) return `${value < 0 ? "-" : ""}${body}%`;
  if (Math.abs(value) < 0.05) return `${body}%`;
  return `${value > 0 ? "+" : "-"}${body}%`;
}

/** "2026-10-23" → "23/10/2026" */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(`${value.slice(0, 10)}T00:00:00`) : value;
  return d.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  });
}

/** Ngày hôm nay theo giờ Việt Nam, dạng YYYY-MM-DD */
export function todayVN(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
}

export function daysBetween(from: string, to: string = todayVN()): number {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** Lớp màu theo dấu lãi/lỗ */
export function trendClass(value: number | null | undefined): string {
  if (value == null || Math.abs(value) < 1e-9) return "text-muted";
  return value > 0 ? "text-up" : "text-down";
}

/** "Mua hôm nay" / "Giữ 12 ngày" thay cho "giữ 0 ngày" */
export function holdingAge(firstBuyDate: string | null): string {
  if (!firstBuyDate) return "—";
  const days = daysBetween(firstBuyDate);
  return days <= 0 ? "Mua hôm nay" : `Giữ ${days} ngày`;
}
