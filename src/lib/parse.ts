// Đọc số từ input người dùng gõ kiểu Việt Nam: "25.000", "1.500", "-7,5"

export function parseIntInput(value: FormDataEntryValue | string | null | undefined): number | null {
  if (value == null) return null;
  const digits = String(value).replace(/[^\d-]/g, "");
  if (digits === "" || digits === "-") return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

export function parseDecimalInput(value: FormDataEntryValue | string | null | undefined): number | null {
  if (value == null) return null;
  const s = String(value).trim().replace(/\s/g, "").replace(",", ".");
  if (s === "" || s === "-" || s === "+") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Định dạng lại khi đang gõ: "25000" → "25.000" */
export function formatIntInput(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  return Number(digits).toLocaleString("vi-VN");
}
