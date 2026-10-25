// Đăng nhập 1 người dùng: mật khẩu nằm trong APP_PASSWORD, cookie là token ký HMAC.
// Chỉ dùng Web Crypto để chạy được cả trong proxy lẫn server action.

export const SESSION_COOKIE = "dca_session";
export const SESSION_DAYS = 30;

function secret(): string | undefined {
  return process.env.SESSION_SECRET || process.env.APP_PASSWORD;
}

/**
 * Không đặt APP_PASSWORD thì bỏ qua đăng nhập (kể cả khi deploy): ai có link cũng vào được.
 * Đặt APP_PASSWORD để bật trang nhập mật khẩu.
 */
export function authDisabled(): boolean {
  return !process.env.APP_PASSWORD;
}

async function hmac(value: string, key: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(value));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** So sánh chuỗi mất thời gian như nhau dù sai ở ký tự nào, để không đoán dần được bí mật */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSessionToken(): Promise<string> {
  const key = secret();
  if (!key) throw new Error("Chưa cấu hình APP_PASSWORD");
  const expires = Date.now() + SESSION_DAYS * 86_400_000;
  return `${expires}.${await hmac(String(expires), key)}`;
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (authDisabled()) return true;
  const key = secret();
  if (!token || !key) return false;
  const [expires, sig] = token.split(".");
  if (!expires || !sig || Number(expires) < Date.now()) return false;
  return safeEqual(sig, await hmac(expires, key));
}

export async function checkPassword(input: string): Promise<boolean> {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return false;
  // So sánh qua HMAC để thời gian so sánh không phụ thuộc độ dài mật khẩu
  const key = "dca-mate-password-check";
  return safeEqual(await hmac(input, key), await hmac(expected, key));
}
