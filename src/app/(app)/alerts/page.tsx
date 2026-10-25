import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { AlertIcon, BellIcon, CheckIcon, TrendDownIcon, TrendUpIcon, XIcon } from "@/components/icons";
import { AlertActions, SkipAllAlertsButton, type QuickTrade } from "@/components/position-forms";
import { Chip, EmptyState, PageHeader, PageSkeleton, cn } from "@/components/ui";
import { getAlerts, getOpenPositions, type AlertRow } from "@/lib/data";
import { formatDateTime, formatPrice, formatQty } from "@/lib/format";
import { FeeRatesProvider } from "@/components/fee-rates";
import { getFeeRates } from "@/lib/fees";

export const metadata = { title: "Cảnh báo" };

// Mỗi loại có icon + chữ riêng, không chỉ dựa vào màu
const KIND: Record<AlertRow["kind"], { label: string; tone: "up" | "down" | "warn"; icon: ReactNode; tile: string }> = {
  dca: { label: "DCA", tone: "down", icon: <TrendDownIcon size={20} />, tile: "bg-down-soft text-down" },
  tp: { label: "Chốt lời", tone: "up", icon: <TrendUpIcon size={20} />, tile: "bg-up-soft text-up" },
  stop: { label: "Cắt lỗ", tone: "warn", icon: <AlertIcon size={20} />, tile: "bg-warn-soft text-warn" },
  trail: { label: "Trailing stop", tone: "warn", icon: <AlertIcon size={20} />, tile: "bg-warn-soft text-warn" },
};

export default function AlertsPage({ searchParams }: PageProps<"/alerts">) {
  return (
    <>
      <PageHeader title="Cảnh báo" subtitle="Khi giá chạm nấc, cảnh báo hiện ở đây và gửi qua Telegram" />
      <Suspense fallback={<PageSkeleton />}>
        <AlertsList searchParams={searchParams} />
      </Suspense>
    </>
  );
}

type LevelInfo = { no: number; quantity: number };

async function AlertsList({ searchParams }: Pick<PageProps<"/alerts">, "searchParams">) {
  const [all, views, sp, fees] = await Promise.all([getAlerts(), getOpenPositions(), searchParams, getFeeRates()]);
  const tab = sp.tab === "done" ? "done" : "new";
  const fresh = all.filter((a) => a.status === "new");
  const history = all.filter((a) => a.status !== "new");

  // Số thứ tự nấc và khối lượng theo kế hoạch, để hiện "Việc cần làm" và điền sẵn popup ghi lệnh
  const levels = new Map<number, LevelInfo>();
  const holdings = new Map(views.map((v) => [v.position.id, v.holding]));
  const exchanges = new Map(views.map((v) => [v.position.id, v.position.exchange]));
  for (const v of views) {
    for (const kind of ["dca", "tp"] as const) {
      v.levels
        .filter((l) => l.kind === kind)
        .forEach((l, i) =>
          levels.set(l.id, { no: i + 1, quantity: kind === "dca" ? (l.quantity ?? 0) : (l.sellQuantity ?? 0) }),
        );
    }
  }

  const quickTrade = (a: AlertRow): QuickTrade | null => {
    if (a.kind === "stop") return null;
    return {
      positionId: a.positionId,
      side: a.kind === "dca" ? "buy" : "sell",
      price: a.price,
      quantity: (a.levelId && levels.get(a.levelId)?.quantity) || null,
      levelId: a.levelId ?? undefined,
      alertId: a.id,
      label: `${a.symbol} · ${KIND[a.kind].label}`,
      holdingQty: holdings.get(a.positionId)?.quantity ?? 0,
      avgCost: holdings.get(a.positionId)?.avgCost ?? 0,
      exchange: exchanges.get(a.positionId) ?? "HOSE",
    };
  };

  if (all.length === 0) {
    return (
      <EmptyState
        icon={<BellIcon />}
        title="Chưa có cảnh báo nào"
        description="Khi giá chạm nấc DCA hoặc nấc chốt lời, cảnh báo sẽ xuất hiện ở đây và gửi qua Telegram."
        action={
          <Link href="/settings" className="btn-secondary">
            Kết nối Telegram
          </Link>
        }
      />
    );
  }

  return (
    <FeeRatesProvider rates={fees}>
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav className="grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1" aria-label="Lọc cảnh báo">
          <TabLink href="/alerts" active={tab === "new"} count={fresh.length} tone="warn">
            Cần xử lý
          </TabLink>
          <TabLink href="/alerts?tab=done" active={tab === "done"} count={history.length}>
            Đã xử lý
          </TabLink>
        </nav>
        {tab === "new" && fresh.length > 1 && (
          <div className="ml-auto">
            <SkipAllAlertsButton count={fresh.length} />
          </div>
        )}
      </div>

      {tab === "new" ? (
        fresh.length === 0 ? (
          <EmptyState
            icon={<CheckIcon />}
            title="Không còn cảnh báo cần xử lý"
            description="Bạn đang làm đúng kế hoạch. Cảnh báo mới sẽ hiện ở đây khi giá chạm nấc."
            action={
              <Link href="/" className="btn-secondary">
                Về tổng quan
              </Link>
            }
          />
        ) : (
          <ul className="space-y-3">
            {fresh.map((a) => (
              <PendingAlert key={a.id} alert={a} level={a.levelId ? levels.get(a.levelId) : undefined} trade={quickTrade(a)} />
            ))}
          </ul>
        )
      ) : history.length === 0 ? (
        <EmptyState icon={<BellIcon />} title="Chưa có cảnh báo nào được xử lý" />
      ) : (
        <ul className="card divide-y divide-line">
          {history.map((a) => (
            <HandledAlert key={a.id} alert={a} />
          ))}
        </ul>
      )}
    </div>
    </FeeRatesProvider>
  );
}

function TabLink({
  href,
  active,
  count,
  tone,
  children,
}: {
  href: string;
  active: boolean;
  count: number;
  tone?: "warn";
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium motion-ui",
        active ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg",
      )}
    >
      {children}
      <span
        className={cn(
          "num inline-flex min-w-6 items-center justify-center rounded-full px-1.5 text-xs leading-5 font-semibold",
          tone === "warn" && count > 0 ? "bg-down text-bg" : "bg-line text-fg",
        )}
      >
        {count}
      </span>
    </Link>
  );
}

function PendingAlert({ alert, level, trade }: { alert: AlertRow; level?: LevelInfo; trade: QuickTrade | null }) {
  const kind = KIND[alert.kind];
  const action =
    alert.kind === "dca"
      ? level?.quantity
        ? `Mua ${formatQty(level.quantity)} cp`
        : "Mua theo nấc"
      : alert.kind === "tp"
        ? level?.quantity
          ? `Bán ${formatQty(level.quantity)} cp`
          : "Bán theo nấc"
        : alert.kind === "trail"
          ? "Cân nhắc bán"
          : "Xem lại luận điểm";
  return (
    <li className="card p-4">
      <div className="flex gap-3">
        <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl", kind.tile)}>{kind.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link href={`/positions/${alert.positionId}`} className="text-lg font-bold hover:text-primary">
              {alert.symbol}
            </Link>
            <Chip tone={kind.tone}>{kind.label}</Chip>
            <span className="ml-auto text-xs text-muted">{formatDateTime(alert.createdAt)}</span>
          </div>
          <dl className="num mt-3 grid grid-cols-[1fr_1.4fr_1fr] gap-2 rounded-xl bg-surface-2 p-3 text-sm">
            <div>
              <dt className="text-xs text-muted">Giá chạm</dt>
              <dd className="font-semibold">{formatPrice(alert.price)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Việc cần làm</dt>
              <dd className={cn("font-semibold whitespace-nowrap", alert.kind === "dca" ? "text-up" : alert.kind === "tp" ? "text-down" : "text-warn")}>
                {action}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Nấc</dt>
              <dd className="font-semibold">{level ? `${kind.label} ${level.no}` : "—"}</dd>
            </div>
          </dl>
          <details className="group mt-2">
            <summary className="cursor-pointer list-none text-xs font-medium text-primary">
              <span className="group-open:hidden">Xem chi tiết</span>
              <span className="hidden group-open:inline">Ẩn chi tiết</span>
            </summary>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{alert.message}</p>
          </details>
        </div>
      </div>
      <div className="mt-4 border-t border-line pt-3">
        <AlertActions alertId={alert.id} symbol={alert.symbol} trade={trade} />
      </div>
    </li>
  );
}

function HandledAlert({ alert }: { alert: AlertRow }) {
  const kind = KIND[alert.kind];
  const done = alert.status === "done";
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", kind.tile)}>{kind.icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link href={`/positions/${alert.positionId}`} className="font-bold hover:text-primary">
            {alert.symbol}
          </Link>
          <span className="text-sm text-muted">{kind.label}</span>
          <span className="num text-sm">· {formatPrice(alert.price)}</span>
        </div>
        <div className="text-xs text-muted">{formatDateTime(alert.createdAt)}</div>
      </div>
      <Chip tone={done ? "up" : "neutral"}>
        {done ? <CheckIcon size={12} /> : <XIcon size={12} />}
        {done ? "Đã làm" : "Bỏ qua"}
      </Chip>
    </li>
  );
}
