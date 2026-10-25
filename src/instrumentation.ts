// Chạy local (`next dev`): tự gọi /api/cron/check-prices mỗi 5 phút, thay cho cron-job.org.
// Route tự bỏ qua khi ngoài phiên. Trên Vercel không chạy được tác vụ nền nên vẫn dùng cron-job.org.
// Tắt bằng LOCAL_CRON=0.
const INTERVAL_MS = 5 * 60_000;

export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "development" || process.env.VERCEL || process.env.LOCAL_CRON === "0") return;

  const globalForCron = globalThis as unknown as { dcaCron?: NodeJS.Timeout };
  if (globalForCron.dcaCron) return;

  // Local chưa đặt CRON_SECRET thì tạo tạm 1 chuỗi cho phiên chạy này
  process.env.CRON_SECRET ||= crypto.randomUUID();
  // Trang Cài đặt đọc cờ này để báo "đang tự kiểm tra giá"
  process.env.LOCAL_CRON_ACTIVE = "1";

  const tick = async () => {
    const url = `http://localhost:${process.env.PORT ?? 3000}/api/cron/check-prices`;
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
      const body = await res.json();
      if (body.skipped) return;
      if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(body)}`);
      console.log(
        `[cron] Cập nhật giá ${body.updated.length}/${body.checked} mã` +
          (body.alerts.length ? `, ${body.alerts.length} cảnh báo mới` : "") +
          (body.errors.length ? `, lỗi: ${body.errors.join("; ")}` : ""),
      );
    } catch (err) {
      console.error("[cron] Kiểm tra giá lỗi:", err);
    }
  };
  globalForCron.dcaCron = setInterval(tick, INTERVAL_MS);
  // Chạy lần đầu sau khi server sẵn sàng, không chặn register()
  setTimeout(tick, 5_000);
}
