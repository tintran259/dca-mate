import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <h1 className="text-2xl font-bold">Không tìm thấy trang</h1>
      <p className="mt-1 text-sm text-muted">Mã này có thể đã bị xóa.</p>
      <Link href="/" className="btn-primary mt-5">
        Về tổng quan
      </Link>
    </main>
  );
}
