import type { ReactNode } from "react";
import type { PositionDetail } from "@/lib/data";
import { formatMoney, formatPct, formatPrice, formatQty } from "@/lib/format";
import { levelLabel } from "./position-card";
import { LevelActions } from "./position-forms";
import { Chip, cn } from "./ui";

type Rung = {
  key: string;
  price: number;
  tone: "up" | "down" | "warn" | "primary" | "neutral";
  title: ReactNode;
  detail?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  current?: boolean;
  dim?: boolean;
};

const DOT = {
  up: "bg-up",
  down: "bg-down",
  warn: "bg-warn",
  primary: "bg-primary",
  neutral: "bg-muted",
};

function statusChip(status: string) {
  if (status === "notified") return <Chip tone="warn">Đã chạm, chờ xử lý</Chip>;
  if (status === "done") return <Chip tone="up">Đã làm</Chip>;
  if (status === "skipped") return <Chip>Bỏ qua</Chip>;
  return null;
}

export function PriceLadder({ detail }: { detail: PositionDetail }) {
  const { position, holding, levels } = detail;
  const price = position.lastPrice;
  const rungs: Rung[] = [];

  for (const level of levels) {
    if (level.trigger == null) continue;
    const isDca = level.kind === "dca";
    const qty = isDca ? (level.quantity ?? 0) : (level.sellQuantity ?? 0);
    const inactive = level.status === "done" || level.status === "skipped";
    rungs.push({
      key: `l${level.id}`,
      price: level.trigger,
      tone: isDca ? "down" : "up",
      title: levelLabel(level),
      detail: level.status === "skipped"
        ? `Đã bỏ qua, giữ mốc ${formatPrice(level.trigger)} cho nấc sau`
        : isDca
        ? `Mua ${formatQty(level.quantity)} cp` + (level.avgAfter ? ` → giá vốn ${formatPrice(level.avgAfter)}` : "")
        : `Bán ${formatQty(level.sellQuantity)} cp, còn ${formatQty(level.tpRemaining)} cp` +
          (level.tpProfit ? ` · ${level.tpProfit >= 0 ? "lãi" : "lỗ"} ≈ ${formatMoney(Math.abs(level.tpProfit))}` : ""),
      status: statusChip(level.status) ??
        (level.distancePct != null ? <span className="num text-xs text-muted">còn {formatPct(level.distancePct)}</span> : null),
      actions: (
        <LevelActions
          levelId={level.id}
          status={level.status}
          trade={{
            positionId: position.id,
            side: isDca ? "buy" : "sell",
            price: level.trigger,
            quantity: qty,
            levelId: level.id,
            label: levelLabel(level),
            holdingQty: holding.quantity,
            avgCost: holding.avgCost,
            exchange: position.exchange,
          }}
        />
      ),
      dim: inactive,
    });
  }

  if (holding.quantity > 0) {
    rungs.push({
      key: "avg",
      price: holding.avgCost,
      tone: "primary",
      title: "Giá vốn trung bình",
      detail: `Hòa vốn sau phí, thuế: ${formatPrice(detail.breakEven)}`,
    });
  }

  if (price) {
    rungs.push({
      key: "current",
      price,
      tone: "neutral",
      title: "Giá hiện tại",
      current: true,
    });
  }

  rungs.sort((a, b) => b.price - a.price || (a.current ? -1 : b.current ? 1 : 0));

  if (rungs.length <= 2 && levels.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-sm text-muted">
        Chưa có nấc DCA hay chốt lời. Mở mục &quot;Sửa kế hoạch&quot; bên dưới để thêm.
      </p>
    );
  }

  return (
    <ol className="relative">
      {/* đường dọc nối các bậc */}
      <span className="absolute top-3 bottom-3 left-[7px] w-px bg-line" aria-hidden="true" />
      {rungs.map((r) => (
        <li
          key={r.key}
          className={cn(
            "relative flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5 pl-7",
            r.current && "my-1 rounded-xl bg-primary-soft py-3 pr-3",
            r.dim && "opacity-55",
          )}
        >
          <span
            className={cn(
              "absolute top-1/2 left-0 size-[15px] -translate-y-1/2 rounded-full border-[3px] border-surface",
              r.current ? "bg-fg ring-2 ring-primary" : DOT[r.tone],
            )}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1 basis-40">
            <div className={cn("text-sm font-medium", r.current && "font-semibold")}>{r.title}</div>
            {r.detail && <div className="text-xs text-muted">{r.detail}</div>}
          </div>
          <div className="text-right">
            <div className={cn("num font-semibold", r.current && "text-lg")}>{formatPrice(r.price)}</div>
            {r.status}
          </div>
          {r.actions && <div className="flex w-full justify-end sm:w-auto">{r.actions}</div>}
        </li>
      ))}
    </ol>
  );
}
