import { headers } from "next/headers";
import { Suspense } from "react";
import { CheckIcon, XIcon } from "@/components/icons";
import { RefreshPricesButton } from "@/components/position-forms";
import { CopyField, LogoutButton, TestTelegramButton } from "@/components/settings-actions";
import { PageHeader, PageSkeleton, Section, WarnText, cn } from "@/components/ui";
import { authDisabled } from "@/lib/auth";
import { telegramConfigured } from "@/lib/telegram";

export const metadata = { title: "Cài đặt" };

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Cài đặt" subtitle="Kết nối thông báo, nguồn giá và lịch kiểm tra tự động" />
      <Suspense fallback={<PageSkeleton />}>
        <Settings />
      </Suspense>
    </>
  );
}

function Check({ ok, label, hint }: { ok: boolean; label: string; hint: string }) {
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span
        className={cn(
          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full",
          ok ? "bg-up-soft text-up" : "bg-warn-soft text-warn",
        )}
      >
        {ok ? <CheckIcon size={14} /> : <XIcon size={14} />}
      </span>
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted">{hint}</div>
      </div>
    </li>
  );
}

async function Settings() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  // APP_URL để trống trong .env thì coi như chưa đặt
  const origin = process.env.APP_URL || `${proto}://${host}`;
  const hasCron = Boolean(process.env.CRON_SECRET);
  const hasTelegram = telegramConfigured();
  // `npm run dev` tự kiểm tra giá mỗi 5 phút (src/instrumentation.ts), không cần cron-job.org
  const localCron = process.env.LOCAL_CRON_ACTIVE === "1";
  // cron-job.org chạy trên internet, không gọi được địa chỉ trong máy hay mạng nội bộ
  const privateHost = /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(new URL(origin).hostname);
  const cronOk = localCron || (hasCron && !privateHost);
  const cronHint = localCron
    ? "Đang chạy local: app tự kiểm tra mỗi 5 phút trong phiên, miễn là máy bật và npm run dev đang chạy."
    : !hasCron
      ? "Thêm CRON_SECRET để bật route kiểm tra giá định kỳ."
      : privateHost
        ? "Đã có CRON_SECRET nhưng app đang chạy ở địa chỉ nội bộ: cron-job.org không gọi tới được. Cần deploy lên Vercel."
        : "Đã có CRON_SECRET. Tạo job trên cron-job.org theo hướng dẫn bên dưới.";

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
      <Section title="Trạng thái cấu hình">
        <ul className="divide-y divide-line">
          <Check
            ok={Boolean(process.env.DATABASE_URL)}
            label="Database (Neon Postgres)"
            hint={process.env.DATABASE_URL ? "Đang dùng Neon." : "Chưa có DATABASE_URL: đang dùng database local trong .data/ (chỉ để chạy thử)."}
          />
          <Check
            ok={!authDisabled()}
            label="Mật khẩu đăng nhập"
            hint={
              authDisabled()
                ? "Chưa đặt APP_PASSWORD: ai có link cũng xem và sửa được danh mục. Nên đặt khi deploy lên mạng."
                : "Đã bật đăng nhập bằng APP_PASSWORD."
            }
          />
          <Check
            ok={hasTelegram}
            label="Telegram"
            hint={hasTelegram ? "Đã cấu hình bot và chat ID." : "Thêm TELEGRAM_BOT_TOKEN và TELEGRAM_CHAT_ID để nhận cảnh báo."}
          />
          <Check ok={cronOk} label="Kiểm tra giá tự động" hint={cronHint} />
        </ul>
      </Section>

      <Section title="Thông báo Telegram" description="Cảnh báo được gửi ngay khi giá chạm nấc">
        <ol className="mb-4 list-decimal space-y-1.5 pl-5 text-sm text-muted">
          <li>
            Mở Telegram, chat với <b className="text-fg">@BotFather</b>, gõ <code className="rounded bg-surface-2 px-1">/newbot</code> và
            lấy <b className="text-fg">token</b>.
          </li>
          <li>Nhắn một tin bất kỳ cho bot vừa tạo.</li>
          <li>
            Mở <code className="rounded bg-surface-2 px-1 break-all">https://api.telegram.org/bot&lt;token&gt;/getUpdates</code>, tìm{" "}
            <code className="rounded bg-surface-2 px-1">chat.id</code>.
          </li>
          <li>
            Thêm <code className="rounded bg-surface-2 px-1">TELEGRAM_BOT_TOKEN</code> và{" "}
            <code className="rounded bg-surface-2 px-1">TELEGRAM_CHAT_ID</code> vào biến môi trường, rồi deploy lại.
          </li>
        </ol>
        <TestTelegramButton disabled={!hasTelegram} />
      </Section>

      <Section title="Kiểm tra giá định kỳ" description="Gói Vercel miễn phí chỉ có cron 1 lần/ngày, nên dùng cron-job.org (miễn phí)">
        <ol className="mb-3 list-decimal space-y-1.5 pl-5 text-sm text-muted">
          <li>Tạo tài khoản tại cron-job.org, bấm &quot;Create cronjob&quot;.</li>
          <li>Dán URL bên dưới, chọn chạy mỗi 5 phút.</li>
          <li>
            Trong tab Advanced, thêm header <code className="rounded bg-surface-2 px-1">Authorization: Bearer &lt;CRON_SECRET&gt;</code>.
          </li>
        </ol>
        {privateHost && (
          <WarnText className="mb-2">
            Địa chỉ dưới đây là địa chỉ trong máy/mạng nội bộ nên cron-job.org không gọi được. Deploy lên Vercel rồi dùng
            URL của Vercel.{localCron && " Trong lúc chạy local, app đã tự kiểm tra giá nên không cần bước này."}
          </WarnText>
        )}
        <CopyField value={`${origin}/api/cron/check-prices`} />
        <p className="hint mt-2">Ngoài phiên (ngoài T2–T6 9h–11h30, 13h–15h) route sẽ tự bỏ qua, nên bạn có thể để job chạy cả ngày.</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <RefreshPricesButton />
          <span className="text-xs text-muted">Chạy kiểm tra ngay (bỏ qua giới hạn giờ giao dịch)</span>
        </div>
      </Section>

      {!authDisabled() && (
        <Section title="Tài khoản">
          <LogoutButton />
        </Section>
      )}
    </div>
  );
}
