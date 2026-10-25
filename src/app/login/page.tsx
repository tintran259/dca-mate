import type { Metadata } from "next";
import { Suspense } from "react";
import { SITE_DESCRIPTION, openGraph } from "@/lib/site";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Đăng nhập",
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/login" },
  openGraph: openGraph("/login"),
};

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <svg viewBox="0 0 64 64" className="mb-3 size-14" aria-hidden="true">
            <rect width="64" height="64" rx="14" fill="var(--primary)" />
            <path d="M12 22l12 12 8-8 20 20M40 46h12V34" fill="none" stroke="var(--primary-fg)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h1 className="text-2xl font-bold">DCA Mate</h1>
          <p className="mt-1 text-sm text-muted">Lập kế hoạch lúc tỉnh táo, làm đúng kế hoạch khi thị trường biến động.</p>
        </div>
        <Suspense>
          <LoginForm nextPromise={searchParams.then((sp) => (typeof sp.next === "string" ? sp.next : "/"))} />
        </Suspense>
      </div>
    </main>
  );
}
