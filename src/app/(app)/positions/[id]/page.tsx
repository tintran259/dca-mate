import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeftIcon, ChevronDownIcon } from "@/components/icons";
import {
  DeleteTransactionButton,
  ManualPriceForm,
  OpenDetailsButton,
  PlanForm,
  ThesisForm,
  TradeForm,
  type TradePrefill,
} from "@/components/position-forms";
import { PriceLadder } from "@/components/price-ladder";
import { Chip, Notice, PageSkeleton, Section, Stat, cn } from "@/components/ui";
import { getPositionDetail } from "@/lib/data";
import {
  daysBetween,
  formatDate,
  formatDateTime,
  formatMoney,
  formatPct,
  formatPrice,
  formatQty,
  trendClass,
} from "@/lib/format";

export default function PositionPage({ params, searchParams }: PageProps<"/positions/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PositionDetailView params={params} searchParams={searchParams} />
    </Suspense>
  );
}

function first(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

async function PositionDetailView({ params, searchParams }: PageProps<"/positions/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const positionId = Number(id);
  if (!Number.isInteger(positionId)) notFound();
  const detail = await getPositionDetail(positionId);
  if (!detail) notFound();

  const { position, holding } = detail;
  const price = position.lastPrice;

  // Số thứ tự nấc theo loại (đúng thứ tự chuỗi) và nhãn cho lịch sử lệnh
  const dcaLevels = detail.levels.filter((l) => l.kind === "dca" && l.status !== "skipped");
  const levelNo = new Map<number, number>();
  for (const kind of ["dca", "tp"] as const) {
    detail.levels.filter((l) => l.kind === kind).forEach((l, i) => levelNo.set(l.id, i + 1));
  }
  const planLabel = new Map(
    detail.levels
      .filter((l) => l.status === "done")
      .map((l) => [l.id, `${l.kind === "dca" ? "Nấc DCA" : "Nấc chốt lời"} ${levelNo.get(l.id)}`]),
  );

  const tradeSide = first(sp.trade);
  const prefill: TradePrefill | undefined =
    tradeSide === "buy" || tradeSide === "sell"
      ? {
          side: tradeSide,
          price: Number(first(sp.price)) || undefined,
          quantity: Number(first(sp.qty)) || undefined,
          levelId: Number(first(sp.level)) || undefined,
          alertId: Number(first(sp.alert)) || undefined,
          label: "Lệnh này sẽ đánh dấu nấc/cảnh báo là đã làm.",
        }
      : undefined;
  const prefillKey = JSON.stringify(prefill ?? {});


  return (
    <div>
      <Link href="/" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeftIcon size={16} /> Tổng quan
      </Link>

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold tracking-wide">{position.symbol}</h1>
            <Chip>{position.exchange === "UPCOM" ? "UPCoM" : position.exchange}</Chip>
            {position.status === "closed" && <Chip tone="neutral">Đã đóng</Chip>}
          </div>
          <p className="mt-1 text-sm text-muted">
            {position.lastPriceAt ? `Giá cập nhật ${formatDateTime(position.lastPriceAt)}` : "Giá lúc mua"}
          </p>
        </div>
        <div className="text-right">
          <div className="num text-3xl font-bold">{formatPrice(price)}</div>
          <div className={cn("num text-sm font-medium", trendClass(detail.pnlPct))}>
            {formatMoney(detail.pnl)} ({formatPct(detail.pnlPct)})
          </div>
        </div>
      </div>

      {first(sp.created) && (
        <div className="mb-4">
          <Notice tone="ok">Đã tạo vị thế {position.symbol}. App sẽ nhắc bạn khi giá chạm các nấc bên dưới.</Notice>
        </div>
      )}

      {/* Lối tắt trên điện thoại */}
      <div className="mb-4 grid grid-cols-2 gap-2 lg:hidden">
        <a href="#trade" className="btn-primary">Ghi lệnh</a>
        <OpenDetailsButton targetId="plan" className="btn-secondary">
          Sửa kế hoạch
        </OpenDetailsButton>
      </div>

      <section className="card mb-4 grid grid-cols-2 gap-4 p-4 sm:grid-cols-4 md:p-5" aria-label="Chỉ số vị thế">
        <Stat label="Đang giữ" value={`${formatQty(holding.quantity)} cp`} sub={<span className="text-muted">{holding.buyCount} lần mua</span>} />
        <Stat label="Giá vốn TB" value={formatPrice(holding.avgCost)} sub={<span className="text-muted">Hòa vốn {formatPrice(detail.breakEven)}</span>} />
        <Stat
          label="Vốn đang rót"
          value={formatMoney(holding.totalCost)}
        />
        <Stat
          label="Thời gian giữ"
          value={holding.firstBuyDate ? `${daysBetween(holding.firstBuyDate)} ngày` : "—"}
          sub={<span className="text-muted">Từ {formatDate(holding.firstBuyDate)}</span>}
        />
        {holding.realizedPnl !== 0 && (
          <Stat label="Lãi đã chốt" value={<span className={trendClass(holding.realizedPnl)}>{formatMoney(holding.realizedPnl)}</span>} />
        )}
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <div className="space-y-4">
          <Section title="Bậc thang kế hoạch" description="Các nấc xếp theo giá, so với giá hiện tại">
            <PriceLadder detail={detail} />
          </Section>

          {dcaLevels.length > 0 && (
            <Section title="Mô phỏng DCA" description="Theo kế hoạch hiện tại: các nấc đã làm và nếu lần lượt khớp các nấc còn lại">
              <div className="-mx-4 overflow-x-auto px-4 md:-mx-5 md:px-5">
                <table className="num w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-muted">
                      <th className="py-2 pr-3 font-medium">Nấc</th>
                      <th className="py-2 pr-3 text-right font-medium">Giá mua</th>
                      <th className="py-2 pr-3 text-right font-medium">Tổng KL</th>
                      <th className="py-2 pr-3 text-right font-medium">Tổng vốn</th>
                      <th className="py-2 pr-3 text-right font-medium">Lãi/lỗ tạm tính</th>
                      <th className="py-2 pr-3 text-right font-medium">Giá vốn TB</th>
                      <th className="py-2 text-right font-medium">Cần hồi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dcaLevels
                      .filter((l) => l.status === "done")
                      .map((l) => (
                        <tr key={l.id} className="border-b border-line text-muted">
                          <td className="py-2.5 pr-3">
                            <span className="font-medium">Nấc {levelNo.get(l.id)}</span> {formatPct(l.pct)}{" "}
                            <Chip tone="up">Đã làm</Chip>
                          </td>
                          <td className="py-2.5 pr-3 text-right">{formatPrice(l.filledPrice ?? l.trigger)}</td>
                          <td className="py-2.5 pr-3 text-right" colSpan={5}>
                            Đã mua {formatQty(l.quantity)} cp, đã tính vào giá vốn hiện tại
                          </td>
                        </tr>
                      ))}
                    <tr className="border-b border-line bg-primary-soft/50">
                      <td className="py-2.5 pr-3 font-medium">Hiện tại</td>
                      <td className="py-2.5 pr-3 text-right">{formatPrice(price)}</td>
                      <td className="py-2.5 pr-3 text-right">{formatQty(holding.quantity)}</td>
                      <td className="py-2.5 pr-3 text-right">{formatMoney(holding.totalCost)}</td>
                      <td className={cn("py-2.5 pr-3 text-right", trendClass(detail.pnl))}>
                        {formatMoney(detail.pnl)}
                        <span className="block text-xs">{formatPct(detail.pnlPct)}</span>
                      </td>
                      <td className="py-2.5 pr-3 text-right font-semibold">{formatPrice(holding.avgCost)}</td>
                      <td className="py-2.5 text-right">
                        {price ? formatPct((detail.breakEven / price - 1) * 100) : "—"}
                      </td>
                    </tr>
                    {detail.simulation.map((row) => (
                      <tr key={row.levelId} className="border-b border-line last:border-0">
                        <td className="py-2.5 pr-3">
                          <span className="font-medium">Nấc {levelNo.get(row.levelId)}</span>{" "}
                          <span className="text-down">{formatPct(row.pct)}</span>
                        </td>
                        <td className="py-2.5 pr-3 text-right">{formatPrice(row.price)}</td>
                        <td className="py-2.5 pr-3 text-right">{formatQty(row.totalQuantity)}</td>
                        <td className="py-2.5 pr-3 text-right">{formatMoney(row.totalCapital)}</td>
                        <td className={cn("py-2.5 pr-3 text-right", trendClass(row.pnlAtPrice))}>
                          {formatMoney(row.pnlAtPrice)}
                          <span className="block text-xs">{formatPct(row.pnlPctAtPrice)}</span>
                        </td>
                        <td className="py-2.5 pr-3 text-right font-semibold">{formatPrice(row.avgCost)}</td>
                        <td className="py-2.5 text-right">{formatPct(row.recoveryPct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="hint mt-2">
                &quot;Lãi/lỗ tạm tính&quot;: nếu bán hết ngay tại giá của dòng đó. &quot;Cần hồi&quot;: % giá phải tăng để hòa vốn. Đã
                tính phí và thuế.
              </p>
            </Section>
          )}

          <details id="plan" className="card group scroll-mt-20" open={detail.levels.length === 0}>
            <summary className="flex cursor-pointer list-none items-center justify-between p-4 md:p-5">
              <div>
                <h2 className="text-base font-semibold">Sửa kế hoạch</h2>
                <p className="text-sm text-muted">Nấc DCA và nấc chốt lời</p>
              </div>
              <ChevronDownIcon size={20} className="text-muted transition group-open:rotate-180" />
            </summary>
            <div className="border-t border-line p-4 md:p-5">
              <PlanForm
                key={detail.levels.map((l) => `${l.id}:${l.pct}:${l.status}`).join("|")}
                positionId={position.id}
                exchange={position.exchange}
                firstPrice={holding.firstBuyPrice}
                quantity={holding.quantity}
                avgCost={holding.avgCost}
                totalCost={holding.totalCost}
                initial={{
                  levels: detail.levels,
                }}
              />
            </div>
          </details>

          <Section title="Lịch sử lệnh" description={`${detail.transactions.length} lệnh`}>
            <ul className="divide-y divide-line">
              {detail.transactions.map((tx) => (
                <li key={tx.id} className="flex items-center gap-3 py-2.5">
                  <span
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                      tx.side === "buy" ? "bg-up-soft text-up" : "bg-down-soft text-down",
                    )}
                  >
                    {tx.side === "buy" ? "MUA" : "BÁN"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="num text-sm font-medium">
                      {formatQty(tx.quantity)} cp × {formatPrice(tx.price)}
                    </div>
                    <div className="truncate text-xs text-muted">
                      {formatDate(tx.tradeDate)}
                      {tx.fee + tx.tax > 0 && ` · phí ${formatMoney(tx.fee + tx.tax)}`}
                      {tx.note && ` · ${tx.note}`}
                    </div>
                    {tx.levelId && planLabel.has(tx.levelId) && (
                      <div className="mt-1">
                        <Chip tone="up">Done theo kế hoạch · {planLabel.get(tx.levelId)}</Chip>
                      </div>
                    )}
                  </div>
                  <div className="num text-right text-sm font-medium">{formatMoney(tx.price * tx.quantity)}</div>
                  <DeleteTransactionButton id={tx.id} />
                </li>
              ))}
            </ul>
          </Section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20">
          <Section id="trade" title="Ghi lệnh mua / bán">
            <TradeForm
              key={prefillKey}
              positionId={position.id}
              exchange={position.exchange}
              holdingQty={holding.quantity}
              prefill={prefill}
              hints={detail.hints}
              sellPlan={detail.levels
                .filter((l) => l.kind === "tp" && (l.status === "pending" || l.status === "notified") && (l.sellQuantity ?? 0) > 0)
                .map((l) => ({ levelNo: levelNo.get(l.id) ?? 0, sellPct: l.sellPct ?? 100, quantity: l.sellQuantity!, price: l.trigger }))}
            />
          </Section>

          <Section title="Luận điểm đầu tư" description="Đọc lại trước khi DCA hoặc cắt lỗ">
            <ThesisForm positionId={position.id} thesis={position.thesis} />
          </Section>

          <Section title="Nhập giá tay" description="Khi nguồn giá lỗi hoặc muốn thử kịch bản">
            <ManualPriceForm positionId={position.id} exchange={position.exchange} />
          </Section>

          {detail.alerts.length > 0 && (
            <Section title="Cảnh báo gần đây">
              <ul className="space-y-2">
                {detail.alerts.slice(0, 5).map((a) => (
                  <li key={a.id} className="rounded-xl bg-surface-2 p-2.5 text-xs">
                    <div className="mb-0.5 text-muted">{formatDateTime(a.createdAt)}</div>
                    {a.message}
                  </li>
                ))}
              </ul>
              <Link href="/alerts" className="mt-2 inline-block text-sm font-medium text-primary">
                Xem tất cả →
              </Link>
            </Section>
          )}

        </aside>
      </div>
    </div>
  );
}
