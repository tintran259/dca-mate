"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { BellIcon, HomeIcon, MenuIcon, PlusIcon, SettingsIcon, XIcon } from "./icons";
import { cn } from "./ui";

const ITEMS = [
  { href: "/", label: "Tổng quan", icon: HomeIcon },
  { href: "/alerts", label: "Cảnh báo", icon: BellIcon, badge: true },
  { href: "/positions/new", label: "Thêm mã", icon: PlusIcon, primary: true },
  { href: "/settings", label: "Cài đặt", icon: SettingsIcon },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/" || (pathname.startsWith("/positions/") && pathname !== "/positions/new");
  return pathname === href || pathname.startsWith(`${href}/`);
}

type NavProps = { badge: ReactNode; pathname?: string };

/** Menu ngang trên desktop */
export function TopNav({ badge }: { badge: ReactNode }) {
  return <TopNavView badge={badge} pathname={usePathname()} />;
}

/** Menu trên điện thoại: nút ☰ ở thanh trên cùng, mở drawer từ cạnh phải */
export function MobileMenu({ badge, hasAlerts }: { badge: ReactNode; hasAlerts: ReactNode }) {
  return <MobileMenuView badge={badge} hasAlerts={hasAlerts} pathname={usePathname()} />;
}

// Bản không đọc URL, hiển thị trong lúc chờ (prerender) trước khi biết trang hiện tại
export function TopNavView({ badge, pathname = "" }: NavProps) {
  return (
    <nav className="hidden items-center gap-1 md:flex" aria-label="Điều hướng chính">
      {ITEMS.filter((i) => !i.primary).map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-medium motion-ui",
              active ? "bg-primary-soft text-primary" : "text-muted hover:bg-surface-2 hover:text-fg",
            )}
          >
            <item.icon size={18} />
            {item.label}
            {item.badge && badge}
          </Link>
        );
      })}
      <Link href="/positions/new" className="btn-primary ml-2 h-10 min-h-10">
        <PlusIcon size={18} /> Thêm mã
      </Link>
    </nav>
  );
}

export function MobileMenuView({
  badge,
  hasAlerts,
  pathname = "",
}: NavProps & { hasAlerts: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  // Chuyển trang thì đóng menu
  useEffect(() => {
    ref.current?.close();
  }, [pathname]);
  return (
    <div className="md:hidden">
      <button
        type="button"
        className="btn-ghost relative size-10 min-h-10 p-0"
        aria-label="Mở menu"
        aria-haspopup="dialog"
        onClick={() => {
          ref.current?.showModal();
          // Không để trình duyệt tự focus (và hiện viền) nút đóng menu
          ref.current?.focus();
        }}
      >
        <MenuIcon size={22} />
        {/* Chấm đỏ khi có cảnh báo mới, vì menu đang đóng thì không thấy số cảnh báo */}
        <span className="absolute top-1.5 right-1.5">{hasAlerts}</span>
      </button>
      <dialog
        ref={ref}
        aria-label="Menu"
        tabIndex={-1}
        className="drawer"
        onClick={(e) => e.target === e.currentTarget && e.currentTarget.close()}
      >
        <div className="flex h-full flex-col">
          <div className="flex h-14 items-center justify-between border-b border-line px-4">
            <span className="font-bold tracking-tight">Menu</span>
            <form method="dialog">
              <button type="submit" className="btn-ghost size-10 min-h-10 p-0" aria-label="Đóng menu">
                <XIcon size={20} />
              </button>
            </form>
          </div>
          <nav
            aria-label="Điều hướng chính"
            className="flex-1 overflow-y-auto p-3"
            // Bấm link của chính trang đang mở thì URL không đổi: vẫn đóng menu
            onClick={(e) => (e.target as HTMLElement).closest("a") && ref.current?.close()}
          >
            <Link href="/positions/new" className="btn-primary mb-3 w-full">
              <PlusIcon size={18} /> Thêm mã
            </Link>
            <ul className="space-y-1">
              {ITEMS.filter((i) => !i.primary).map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex min-h-12 items-center gap-3 rounded-xl px-3 text-base font-medium motion-ui",
                        active ? "bg-primary-soft text-primary" : "text-fg active:bg-surface-2",
                      )}
                    >
                      <item.icon size={20} />
                      <span className="flex-1">{item.label}</span>
                      {item.badge && badge}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>
      </dialog>
    </div>
  );
}
