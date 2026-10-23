import { headers } from "next/headers";
import { Suspense } from "react";
import { CheckIcon, XIcon } from "@/components/icons";
import { RefreshPricesButton } from "@/components/position-forms";
import { CopyField, LogoutButton, TestTelegramButton } from "@/components/settings-actions";
import { PageHeader, PageSkeleton, Section, cn } from "@/components/ui";
import { authDisabled } from "@/lib/auth";
import { telegramConfigured } from "@/lib/telegram";

export const metadata = { title: "Cài đặt" };

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Cài đặt" subtitle="Kết nối thông báo, nguồn giá và lịch kiểm tra tự động" />
      <Suspense fallback={<PageSkeleton />}>
        <Settings />
      </Suspense>
    </div>
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
  const origin = process.env.APP_URL ?? `${proto}://${host}`;
  const hasCron = Boolean(process.env.CRON_SECRET);
  const hasTelegram = telegramConfigured();

  return (
    <div className="space-y-4">
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
            hint={authDisabled() ? "Chưa đặt APP_PASSWORD: ai mở được link cũng xem được (chỉ chấp nhận khi chạy local)." : "Đã bật đăng nhập bằng APP_PASSWORD."}
          />
          <Check
            ok={hasTelegram}
            label="Telegram"
            hint={hasTelegram ? "Đã cấu hình bot và chat ID." : "Thêm TELEGRAM_BOT_TOKEN và TELEGRAM_CHAT_ID để nhận cảnh báo."}
          />
          <Check
            ok={hasCron}
            label="Kiểm tra giá tự động"
            hint={hasCron ? "Đã có CRON_SECRET. Tạo job trên cron-job.org theo hướng dẫn bên dưới." : "Thêm CRON_SECRET để bật route kiểm tra giá định kỳ."}
          />
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
        <CopyField value={`${origin}/api/cron/check-prices`} />
        <p className="hint mt-2">Ngoài giờ giao dịch (T2–T6, 9h–15h) route sẽ tự bỏ qua, nên bạn có thể để job chạy cả ngày.</p>
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
