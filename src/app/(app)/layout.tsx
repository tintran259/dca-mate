import Link from "next/link";
import { Suspense } from "react";
import { BottomNav, BottomNavView, TopNav, TopNavView } from "@/components/app-nav";
import { RefreshPricesButton } from "@/components/position-forms";
import { countNewAlerts } from "@/lib/data";

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

export default function AppLayout({ children }: LayoutProps<"/">) {
  const badge = (
    <Suspense fallback={null}>
      <AlertBadge />
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
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 pt-5 pb-28 md:px-6 md:pt-8 md:pb-12">{children}</main>
      <Suspense fallback={<BottomNavView badge={null} />}>
        <BottomNav badge={badge} />
      </Suspense>
    </>
  );
}
