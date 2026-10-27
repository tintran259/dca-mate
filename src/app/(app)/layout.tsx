import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { MobileMenu, MobileMenuView, TopNav, TopNavView } from "@/components/app-nav";
import { PriceAutoRefresh } from "@/components/price-auto-refresh";
import { RefreshPricesButton } from "@/components/position-forms";
import { countNewAlerts } from "@/lib/data";

/** Chấm đỏ trên nút menu điện thoại khi có cảnh báo mới */
async function AlertDot() {
  const count = await countNewAlerts();
  if (count === 0) return null;
  return (
    <span className="block size-2.5 rounded-full bg-down ring-2 ring-bg">
      <span className="sr-only">Có cảnh báo mới</span>
    </span>
  );
}

async function AlertBadge() {
  const count = await countNewAlerts();
  if (count === 0) return null;
  return (
    <span className="num inline-flex min-w-5 items-center justify-center rounded-full bg-down px-1.5 text-xs leading-5 font-bold text-white">
      {count > 99 ? "99+" : count}
      <span className="sr-only"> cảnh báo mới</span>
    </span>
  );
}

// Các trang trong app chứa danh mục cá nhân: không cho công cụ tìm kiếm index hay theo link
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AppLayout({ children }: LayoutProps<"/">) {
  const badge = (
    <Suspense fallback={null}>
      <AlertBadge />
    </Suspense>
  );
  const dot = (
    <Suspense fallback={null}>
      <AlertDot />
    </Suspense>
  );
  return (
    <>
      <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 md:h-16 md:px-6">
          <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
            <svg viewBox="0 0 64 64" className="size-8" aria-hidden="true">
              <rect width="64" height="64" rx="14" fill="var(--primary)" />
              <path d="M12 22l12 12 8-8 20 20M40 46h12V34" fill="none" stroke="var(--primary-fg)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="text-lg">DCA Mate</span>
          </Link>
          <div className="flex items-center gap-2">
            <Suspense fallback={<TopNavView badge={null} />}>
              <TopNav badge={badge} />
            </Suspense>
            <div className="md:hidden">
              <RefreshPricesButton compact />
            </div>
            <Suspense fallback={<MobileMenuView badge={null} hasAlerts={null} />}>
              <MobileMenu badge={badge} hasAlerts={dot} />
            </Suspense>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 pt-5 pb-12 md:px-6 md:pt-8">{children}</main>
      <PriceAutoRefresh />
    </>
  );
}
