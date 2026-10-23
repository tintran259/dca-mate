import Link from "next/link";
import { Suspense } from "react";
import { BellIcon, ChevronRightIcon, PlusIcon, TrendDownIcon } from "@/components/icons";
import { PositionCard, levelLabel } from "@/components/position-card";
import { RefreshPricesButton } from "@/components/position-forms";
import { EmptyState, Notice, PageHeader, PageSkeleton, Stat, cn } from "@/components/ui";
import { countNewAlerts, getClosedPositions, getOpenPositions } from "@/lib/data";
import { formatDateTime, formatMoney, formatPct, formatPrice, trendClass } from "@/lib/format";

export const metadata = { title: "Tổng quan" };

export default function DashboardPage({ searchParams }: PageProps<"/">) {
  return (
    <>
      <PageHeader
        title="Tổng quan"
        subtitle="Danh mục đang nắm giữ và các nấc sắp chạm"
        actions={
          <div className="hidden md:block">
            <RefreshPricesButton />
          </div>
        }
      />
      <Suspense fallback={null}>
        <ClosedNotice searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<PageSkeleton />}>
        <Dashboard />
      </Suspense>
    </>
  );
}

async function ClosedNotice({ searchParams }: Pick<PageProps<"/">, "searchParams">) {
  const closed = (await searchParams).closed;
  if (typeof closed !== "string" || !closed) return null;
  return (
    <div className="mb-4">
      <Notice tone="ok">Đã bán hết {closed}. Mã đã được đóng, xem lại lịch sử ở mục &quot;Đã đóng&quot; cuối trang.</Notice>
    </div>
  );
}

async function Dashboard() {
  const [views, closed, newAlerts] = await Promise.all([getOpenPositions(), getClosedPositions(), countNewAlerts()]);

  if (views.length === 0 && closed.length === 0) {
    return (
      <EmptyState
        icon={<TrendDownIcon />}
        title="Chưa có mã nào"
        description="Thêm lệnh mua đầu tiên và đặt kế hoạch DCA, chốt lời. App sẽ nhắc bạn khi giá chạm từng nấc."
        action={
          <Link href="/positions/new" className="btn-primary">
            <PlusIcon size={18} /> Thêm mã đầu tiên
          </Link>
        }
      />
    );
  }

  const totalCost = views.reduce((s, v) => s + v.holding.totalCost, 0);
  const marketValue = views.reduce((s, v) => s + v.marketValue, 0);
  const pnl = views.reduce((s, v) => s + v.pnl, 0);
  const realized = [...views, ...closed].reduce((s, v) => s + v.holding.realizedPnl, 0);
  const lastUpdate = views
    .map((v) => v.position.lastPriceAt)
    .filter((d): d is Date => d != null)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  const upcoming = views
    .flatMap((v) =>
      v.levels
        .filter((l) => (l.status === "pending" || l.status === "notified") && l.distancePct != null)
        .map((l) => ({ view: v, level: l })),
    )
    .filter(({ level }) => level.status === "notified" || Math.abs(level.distancePct!) <= 8)
    .sort((a, b) => Math.abs(a.level.distancePct!) - Math.abs(b.level.distancePct!))
    .slice(0, 6);

  return (
    <div className="space-y-5">
      {newAlerts > 0 && (
        <Link
          href="/alerts"
          className="flex items-center gap-3 rounded-2xl bg-warn-soft px-4 py-3 text-warn transition hover:brightness-95"
        >
          <BellIcon size={20} />
          <span className="flex-1 text-sm font-medium">
            Có {newAlerts} cảnh báo mới cần bạn xử lý
          </span>
          <ChevronRightIcon size={18} />
        </Link>
      )}

      <section className="card grid grid-cols-2 gap-4 p-4 md:grid-cols-4 md:p-5" aria-label="Tóm tắt danh mục">
        <Stat label="Vốn đang rót" value={formatMoney(totalCost)} />
        <Stat label="Giá trị thị trường" value={formatMoney(marketValue)} />
        <Stat
          label="Lãi/lỗ tạm tính"
          value={<span className={trendClass(pnl)}>{formatMoney(pnl)}</span>}
          sub={<span className={trendClass(pnl)}>{totalCost ? formatPct((pnl / totalCost) * 100) : "—"}</span>}
        />
        <Stat label="Lãi đã chốt" value={<span className={trendClass(realized)}>{formatMoney(realized)}</span>} />
        <p className="col-span-full -mt-1 text-xs text-muted">
          {lastUpdate ? `Giá cập nhật lúc ${formatDateTime(lastUpdate)}` : "Chưa cập nhật giá"} · đã trừ phí và thuế bán
        </p>
      </section>

      {upcoming.length > 0 && (
        <section className="card p-4 md:p-5">
          <h2 className="mb-3 text-base font-semibold">Sắp chạm nấc</h2>
          <ul className="divide-y divide-line">
            {upcoming.map(({ view, level }) => (
              <li key={level.id}>
                <Link href={`/positions/${view.position.id}`} className="flex items-center gap-3 py-2.5 hover:opacity-80">
                  <span className={cn("size-2 shrink-0 rounded-full", level.kind === "dca" ? "bg-down" : "bg-up")} />
                  <span className="w-14 font-bold">{view.position.symbol}</span>
                  <span className="flex-1 truncate text-sm">{levelLabel(level)}</span>
                  <span className="num text-right text-sm">
                    <span className="font-semibold">{formatPrice(level.trigger)}</span>
                    <span className="block text-xs text-muted">
                      {level.status === "notified" ? "Đã chạm" : `còn ${formatPct(level.distancePct)}`}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {views.length > 0 ? (
        <section aria-label="Vị thế đang mở">
          <h2 className="mb-3 text-base font-semibold">Đang nắm giữ ({views.length})</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {views.map((v) => (
              <PositionCard key={v.position.id} view={v} />
            ))}
          </div>
        </section>
      ) : (
        <EmptyState
          title="Không còn mã nào đang nắm giữ"
          action={
            <Link href="/positions/new" className="btn-primary">
              <PlusIcon size={18} /> Thêm mã
            </Link>
          }
        />
      )}

      {closed.length > 0 && (
        <details className="card group p-4 md:p-5">
          <summary className="flex cursor-pointer list-none items-center justify-between text-base font-semibold">
            Đã đóng ({closed.length})
            <ChevronRightIcon size={18} className="text-muted transition group-open:rotate-90" />
          </summary>
          <ul className="mt-3 divide-y divide-line">
            {closed.map((v) => (
              <li key={v.position.id}>
                <Link href={`/positions/${v.position.id}`} className="flex items-center justify-between py-2.5 hover:opacity-80">
                  <span className="font-bold">{v.position.symbol}</span>
                  <span className={cn("num text-sm font-medium", trendClass(v.holding.realizedPnl))}>
                    {formatMoney(v.holding.realizedPnl)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
