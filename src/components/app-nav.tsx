"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { BellIcon, HomeIcon, PlusIcon, SettingsIcon } from "./icons";
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

/** Thanh tab dưới đáy trên điện thoại, dễ bấm bằng ngón cái */
export function BottomNav({ badge }: { badge: ReactNode }) {
  return <BottomNavView badge={badge} pathname={usePathname()} />;
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
              "relative inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-medium transition",
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

export function BottomNavView({ badge, pathname = "" }: NavProps) {
  return (
    <nav
      className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur md:hidden"
      aria-label="Điều hướng chính"
    >
      <ul className="mx-auto grid h-16 max-w-md grid-cols-4">
        {ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-full flex-col items-center justify-center gap-0.5 text-xs font-medium transition",
                  active ? "text-primary" : "text-muted",
                )}
              >
                <span
                  className={cn(
                    "relative flex items-center justify-center",
                    item.primary ? "size-9 rounded-full bg-primary text-primary-fg" : "h-7 w-12 rounded-full",
                    active && !item.primary && "bg-primary-soft",
                  )}
                >
                  <item.icon size={20} />
                  {item.badge && <span className="absolute -top-1 -right-0.5">{badge}</span>}
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
