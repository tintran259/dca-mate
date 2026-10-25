import Link from "next/link";
import type { LevelView, PositionView } from "@/lib/data";
import { formatMoney, formatPct, formatPrice, formatQty, holdingAge, trendClass } from "@/lib/format";
import { ChevronRightIcon } from "./icons";
import { Chip, cn } from "./ui";

export function levelLabel(level: Pick<LevelView, "kind" | "pct">) {
  return level.kind === "dca" ? `DCA ${formatPct(level.pct)}` : `Chốt lời ${formatPct(level.pct)}`;
}

export function PositionCard({ view }: { view: PositionView }) {
  const { position, holding, nextLevel } = view;
  const price = position.lastPrice;
  return (
    <Link
      href={`/positions/${position.id}`}
      className="card group block p-4 motion-ui hover:border-primary/50 hover:shadow-sm focus-visible:ring-4 focus-visible:ring-(--ring) focus-visible:outline-none"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold tracking-wide">{position.symbol}</span>
            <Chip>{position.exchange === "UPCOM" ? "UPCoM" : position.exchange}</Chip>
          </div>
          <div className="num mt-0.5 text-xs text-muted">
            {formatQty(holding.quantity)} cp · {holdingAge(holding.firstBuyDate).toLowerCase()}
          </div>
        </div>
        <div className="text-right">
          <div className="num text-lg font-semibold">{formatPrice(price)}</div>
          <div className={cn("num text-sm font-medium", trendClass(view.pnlPct))}>{formatPct(view.pnlPct)}</div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
        <div>
          <div className="text-xs text-muted">Giá vốn</div>
          <div className="num font-medium">{formatPrice(holding.avgCost)}</div>
        </div>
        <div>
          <div className="text-xs text-muted">Vốn</div>
          <div className="num font-medium">{formatMoney(holding.totalCost)}</div>
        </div>
        <div>
          <div className="text-xs text-muted">Lãi/lỗ</div>
          <div className={cn("num font-medium", trendClass(view.pnl))}>{formatMoney(view.pnl)}</div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3 text-xs">
        {nextLevel ? (
          <NextLevel level={nextLevel} />
        ) : (
          <span className="text-muted">Chưa có nấc nào đang chờ</span>
        )}
        <ChevronRightIcon size={16} className="shrink-0 text-muted motion-ui group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}

function NextLevel({ level }: { level: LevelView }) {
  const isDca = level.kind === "dca";
  const hit = level.status === "notified";
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className={cn("size-1.5 shrink-0 rounded-full", isDca ? "bg-down" : "bg-up")} />
      <span className="truncate">
        {hit ? "Đã chạm " : "Nấc gần nhất: "}
        <b>{levelLabel(level)}</b> ở <b className="num">{formatPrice(level.trigger)}</b>
        {!hit && level.distancePct != null && (
          <span className="num text-muted"> (còn {formatPct(level.distancePct)})</span>
        )}
      </span>
    </span>
  );
}
