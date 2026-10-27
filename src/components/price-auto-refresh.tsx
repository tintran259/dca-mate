"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const POLL_MS = 60_000;

/**
 * Giá do cron cập nhật ngầm trên server, còn trình duyệt giữ trang đã tải (staleTimes 5 phút),
 * nên trang Tổng quan đang mở hoặc nằm trong cache sẽ hiện giá cũ. Component này hỏi /api/price-version
 * mỗi phút (khi tab đang hiện) và ngay lúc quay lại tab; giá đổi thì router.refresh() để lấy dữ liệu mới
 * và bỏ cache cũ của các trang khác.
 */
export function PriceAutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    let seen: string | null = null;
    let stopped = false;

    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/price-version", { cache: "no-store" });
        // Hết phiên đăng nhập thì proxy chuyển hướng sang trang login: bỏ qua, không làm mới
        if (!res.ok || !res.headers.get("content-type")?.includes("application/json")) return;
        const { version } = (await res.json()) as { version: string };
        if (stopped) return;
        if (seen !== null && version !== seen) router.refresh();
        seen = version;
      } catch {
        // Mất mạng thì lần sau thử lại
      }
    };

    check();
    const timer = setInterval(check, POLL_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [router]);

  return null;
}
