"use client";

import { useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import type { PortfolioHistory } from "@/lib/data";
import { periodStart, type Period } from "@/lib/portfolio";
import { formatMoney, formatPct, formatPrice, trendClass } from "@/lib/format";
import { SELL_FEE_RATE, SELL_TAX_RATE } from "@/lib/market";
import { Segmented } from "./form-controls";
import { cn } from "./ui";

// Màu gắn theo thứ tự tạo mã (không theo xếp hạng), tối đa 6 màu; từ mã thứ 7 gộp vào "Khác"
const SLOTS = 6;
const OTHER = "Khác";

type Range = "1d" | Period;
const RANGES: { value: Range; label: string; long: string }[] = [
  { value: "1d", label: "1D", long: "trong phiên" },
  { value: "1w", label: "1W", long: "từ đầu tuần" },
  { value: "1m", label: "1M", long: "từ đầu tháng" },
  { value: "3m", label: "3M", long: "trong 3 tháng" },
  { value: "6m", label: "6M", long: "trong 6 tháng" },
  { value: "1y", label: "1Y", long: "trong 12 tháng" },
];
type View = "price" | "total" | "symbol";

const VIEW_INFO: Record<View, { label: string; description: string }> = {
  price: { label: "Giá", description: "% thay đổi giá từng mã đang giữ so với đầu kỳ" },
  total: { label: "Tài sản", description: "Giá trị thị trường so với vốn đang rót" },
  symbol: { label: "Theo mã", description: "Giá trị từng mã đang giữ" },
};

// Lãi/lỗ tính giống ô tổng quan: bán hết ở giá đó, đã trừ phí và thuế bán
const NET_RATE = 1 - SELL_FEE_RATE - SELL_TAX_RATE;

type Series = { key: string; color: string };
/** `x` là ngày (YYYY-MM-DD) ở các khung theo ngày, hoặc giờ (HH:mm) ở khung 1D */
type Row = { x: string } & Record<string, number | string | undefined>;

const dateFormat = new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit" });
const fullDate = new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
const asDate = (d: string) => new Date(`${d}T00:00:00`);
const compact = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 });

/** Nhãn trục Y gọn: 850k / 12tr / 1,2 tỷ */
function tickMoney(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${compact.format(v / 1e9)} tỷ`;
  if (abs >= 1e6) return `${compact.format(v / 1e6)}tr`;
  if (abs >= 1e3) return `${compact.format(v / 1e3)}k`;
  return String(v);
}

export function PortfolioChart({ points, prices, holdings, intraday, symbols }: PortfolioHistory) {
  const [range, setRange] = useState<Range>("3m");
  // Danh mục mới (ít điểm lịch sử) thì mở sẵn biểu đồ giá, vì giá có lịch sử dù mới mua
  const [view, setView] = useState<View>(points.length >= 5 ? "total" : "price");
  // Chỉ 1 mã thì "Theo mã" trùng hệt "Tài sản": ẩn đi
  const views: View[] = symbols.length > 1 ? ["price", "total", "symbol"] : ["price", "total"];
  const activeView = views.includes(view) ? view : "total";
  const intradayMode = range === "1d";

  const series: Series[] = useMemo(() => {
    const keys = symbols.length > SLOTS ? [...symbols.slice(0, SLOTS), OTHER] : symbols;
    return keys.map((key, i) => ({ key, color: key === OTHER ? "var(--muted)" : `var(--chart-${i + 1})` }));
  }, [symbols]);
  const colorOf = useMemo(() => new Map(series.map((s) => [s.key, s.color])), [series]);
  const priceKeys = useMemo(() => Object.keys(holdings), [holdings]);

  // Giá trị danh mục (Tài sản, Theo mã)
  const valueRows: Row[] = useMemo(() => {
    const shown = new Set(symbols.slice(0, SLOTS));
    const keyOf = (sym: string) => (shown.has(sym) ? sym : OTHER);
    const toRow = (x: string, value: number, capital: number, bySymbol: Record<string, number>): Row => {
      const row: Row = { x, value, capital, pnl: value * NET_RATE - capital };
      for (const s of series) row[s.key] = 0;
      for (const [sym, v] of Object.entries(bySymbol)) row[keyOf(sym)] = Number(row[keyOf(sym)]) + v;
      return row;
    };
    if (intradayMode) {
      // Trong phiên: giá trị theo số cổ đang giữ hiện tại, vốn không đổi
      const capital = Object.values(holdings).reduce((s, h) => s + h.totalCost, 0);
      return intraday.points.map((p) => {
        const bySymbol = Object.fromEntries(
          Object.entries(holdings).flatMap(([sym, h]) => (p.closes[sym] ? [[sym, p.closes[sym] * h.quantity]] : [])),
        );
        const value = Object.values(bySymbol).reduce((s, v) => s + v, 0);
        return toRow(p.time, value, capital, bySymbol);
      });
    }
    const last = points.at(-1)?.date;
    const from = last ? periodStart(range as Period, last) : "";
    return points.filter((p) => p.date >= from).map((p) => toRow(p.date, p.value, p.capital, p.bySymbol));
  }, [points, symbols, series, range, intradayMode, intraday, holdings]);

  // % biến động giá so với đầu kỳ (Giá): đưa các mã về cùng một mốc để so trên một trục.
  // Khung 1D so với giá tham chiếu (đóng cửa phiên trước), như bảng giá chứng khoán.
  const { rows: priceRows, base: priceBase } = useMemo(() => {
    const source = intradayMode
      ? intraday.points.map((p) => ({ x: p.time, closes: p.closes }))
      : (() => {
          const last = prices.at(-1)?.date;
          const from = last ? periodStart(range as Period, last) : "";
          return prices.filter((p) => p.date >= from).map((p) => ({ x: p.date, closes: p.closes }));
        })();
    const base: Record<string, number> = intradayMode ? { ...intraday.refPrices } : {};
    const rows = source.map((p) => {
      const row: Row = { x: p.x };
      for (const [sym, close] of Object.entries(p.closes)) {
        base[sym] ??= close;
        row[sym] = (close / base[sym] - 1) * 100;
        row[`${sym}:price`] = close;
      }
      return row;
    });
    return { rows, base };
  }, [prices, range, intradayMode, intraday]);

  const config = useMemo<ChartConfig>(
    () => ({
      value: { label: "Giá trị thị trường", color: "var(--chart-1)" },
      capital: { label: "Vốn đang rót", color: "var(--muted)" },
      ...Object.fromEntries(series.map((s) => [s.key, { label: s.key, color: s.color }])),
    }),
    [series],
  );

  if (points.length === 0) return null;

  const rows = activeView === "price" ? priceRows : valueRows;
  const first = valueRows[0];
  const last = valueRows.at(-1);
  // Lãi/lỗ trong kỳ = thay đổi của (giá trị − vốn): tiền rót thêm hay rút ra không bị tính là lãi/lỗ
  const periodPnl = first && last && valueRows.length > 1 ? Number(last.pnl) - Number(first.pnl) : null;
  const rangeInfo = RANGES.find((r) => r.value === range)!;
  const sessionLabel = intraday.date ? `phiên ${fullDate.format(asDate(intraday.date))}` : null;
  const formatX = (x: string) => (intradayMode ? x : dateFormat.format(asDate(x)));
  const formatXFull = (x: string) =>
    intradayMode ? `${x}${intraday.date ? ` · ${fullDate.format(asDate(intraday.date))}` : ""}` : fullDate.format(asDate(x));
  // Đường giá vốn trên biểu đồ giá (chỉ khi có 1 mã, nhiều mã thì rối): quy về % so với mốc như các đường giá
  const only = priceKeys.length === 1 ? priceKeys[0] : null;
  const costLine = only && priceBase[only] ? (holdings[only].avgCost / priceBase[only] - 1) * 100 : null;

  return (
    <section className="card p-4 md:p-5" aria-labelledby="portfolio-chart-title">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="portfolio-chart-title" className="text-base font-semibold">
            Biểu đồ danh mục
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            {intradayMode && activeView === "price"
              ? "% thay đổi giá so với giá tham chiếu (đóng cửa phiên trước)"
              : VIEW_INFO[activeView].description}
            {intradayMode && sessionLabel && ` · ${sessionLabel}`}
          </p>
          {activeView !== "price" && periodPnl != null && (
            <p className="mt-1 text-sm">
              <span className="text-muted">Lãi/lỗ {rangeInfo.long}: </span>
              <span className={cn("num font-semibold", trendClass(periodPnl))}>
                {periodPnl > 0 ? "+" : ""}
                {formatMoney(periodPnl)}
              </span>
            </p>
          )}
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Segmented
            name="chart-view"
            value={activeView}
            onChange={setView}
            options={views.map((v) => ({ value: v, label: VIEW_INFO[v].label }))}
          />
          <Segmented
            name="chart-range"
            value={range}
            onChange={setRange}
            options={RANGES.map((r) => ({ value: r.value, label: r.label }))}
          />
        </div>
      </div>

      {rows.length < 2 ? (
        <p className="flex h-64 items-center justify-center rounded-xl bg-surface-2 px-6 text-center text-sm text-muted md:h-72">
          {intradayMode
            ? "Chưa có dữ liệu trong phiên. Biểu đồ 1D có khi thị trường mở cửa."
            : "Chưa đủ dữ liệu cho khoảng này. Biểu đồ sẽ có thêm điểm sau mỗi phiên giao dịch."}
        </p>
      ) : (
        <div
          role="img"
          aria-label={`Biểu đồ ${activeView === "price" ? "biến động giá các mã" : "giá trị danh mục"} từ ${formatXFull(rows[0].x)} đến ${formatXFull(rows.at(-1)!.x)}`}
        >
          <ChartContainer config={config} className="aspect-auto h-64 w-full md:h-72">
            <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--line)" />
              <XAxis dataKey="x" tickLine={false} axisLine={false} minTickGap={32} tickMargin={8} tickFormatter={formatX} />
              <YAxis
                width={activeView === "price" ? 52 : 60}
                tickLine={false}
                axisLine={false}
                tickMargin={4}
                tickCount={5}
                tickFormatter={(v: number) => (activeView === "price" ? formatPct(v) : tickMoney(v))}
                domain={activeView === "symbol" ? [0, "auto"] : ["auto", "auto"]}
              />
              <Tooltip
                cursor={{ stroke: "var(--muted)", strokeWidth: 1 }}
                content={(props) => (
                  <ChartTooltip
                    {...props}
                    view={activeView}
                    series={series}
                    priceKeys={priceKeys}
                    colorOf={colorOf}
                    formatLabel={formatXFull}
                  />
                )}
              />
              {activeView === "price" && <ReferenceLine y={0} stroke="var(--muted)" strokeOpacity={0.5} />}
              {activeView === "price" && only && costLine != null && (
                <ReferenceLine
                  y={costLine}
                  stroke="var(--text)"
                  strokeDasharray="4 4"
                  ifOverflow="extendDomain"
                  label={{
                    value: `Giá vốn ${formatPrice(holdings[only].avgCost)}`,
                    position: "insideTopRight",
                    fill: "var(--text)",
                    fontSize: 12,
                  }}
                />
              )}
              {activeView === "price" &&
                priceKeys.map((sym) => (
                  <Line
                    key={sym}
                    dataKey={sym}
                    type="monotone"
                    stroke={colorOf.get(sym) ?? "var(--muted)"}
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                    activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }}
                  />
                ))}
              {activeView === "total" && (
                <>
                  <Area
                    dataKey="value"
                    type="monotone"
                    stroke="var(--color-value)"
                    strokeWidth={2}
                    fill="var(--color-value)"
                    fillOpacity={0.1}
                    isAnimationActive={false}
                    activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }}
                  />
                  <Line
                    dataKey="capital"
                    type="stepAfter"
                    stroke="var(--color-capital)"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                    activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }}
                  />
                </>
              )}
              {activeView === "symbol" &&
                series.map((s) => (
                  <Area
                    key={s.key}
                    dataKey={s.key}
                    stackId="symbols"
                    type="monotone"
                    stroke={s.color}
                    strokeWidth={2}
                    fill={s.color}
                    fillOpacity={0.1}
                    isAnimationActive={false}
                    activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }}
                  />
                ))}
            </ComposedChart>
          </ChartContainer>
        </div>
      )}

      {/* Chú thích luôn có, kèm số liệu cuối kỳ để không phải dựa vào màu hay tooltip */}
      <ul className="mt-3 grid grid-cols-1 gap-x-5 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {activeView === "price" &&
          priceKeys.map((sym) => {
            const end = [...priceRows].reverse().find((r) => r[sym] != null);
            return (
              <LegendItem
                key={sym}
                color={colorOf.get(sym) ?? "var(--muted)"}
                label={sym}
                value={
                  end
                    ? `${formatPrice(Number(end[`${sym}:price`]))} · ${formatPct(Number(end[sym]))} ${rangeInfo.long}` +
                      ` · giá vốn ${formatPrice(holdings[sym].avgCost)}`
                    : "—"
                }
              />
            );
          })}
        {activeView === "total" && last && (
          <>
            <LegendItem color="var(--chart-1)" label="Giá trị thị trường" value={formatMoney(Number(last.value))} swatch="rect" />
            <LegendItem color="var(--muted)" label="Vốn đang rót" value={formatMoney(Number(last.capital))} />
          </>
        )}
        {activeView === "symbol" &&
          last &&
          series
            .map((s) => ({ ...s, amount: Number(last[s.key] ?? 0) }))
            .filter((s) => s.amount > 0)
            .map((s) => (
              <LegendItem
                key={s.key}
                color={s.color}
                label={s.key}
                value={`${formatMoney(s.amount)} · ${formatPct((s.amount / Number(last.value)) * 100, false)}`}
                swatch="rect"
              />
            ))}
      </ul>

      <details className="mt-3">
        <summary className="inline-flex cursor-pointer list-none text-sm font-medium text-primary">Xem dạng bảng</summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <DataTable view={activeView} rows={rows} priceKeys={priceKeys} formatLabel={formatXFull} />
        </div>
      </details>
      {activeView !== "price" && (
        <p className="hint">
          {intradayMode
            ? "Giá trị theo số cổ đang giữ hiện tại và giá trong phiên. Lãi/lỗ đã trừ phí và thuế bán, giống phần tổng quan."
            : "Giá trị theo giá đóng cửa mỗi ngày. Lãi/lỗ đã trừ phí và thuế bán, giống phần tổng quan."}
        </p>
      )}
    </section>
  );
}

function DataTable({
  view,
  rows,
  priceKeys,
  formatLabel,
}: {
  view: View;
  rows: Row[];
  priceKeys: string[];
  formatLabel: (x: string) => string;
}) {
  const newestFirst = [...rows].reverse();
  const th = "py-2 pr-3 text-right font-medium";
  return (
    <table className="num w-full text-sm">
      <thead className="sticky top-0 bg-surface">
        <tr className="border-b border-line text-left text-xs text-muted">
          <th className="py-2 pr-3 font-medium">Thời điểm</th>
          {view === "price" ? (
            priceKeys.map((sym) => (
              <th key={sym} className={th}>
                {sym}
              </th>
            ))
          ) : (
            <>
              <th className={th}>Giá trị</th>
              <th className={th}>Vốn</th>
              <th className={th}>Lãi/lỗ</th>
            </>
          )}
        </tr>
      </thead>
      <tbody>
        {newestFirst.map((r) => (
          <tr key={r.x} className="border-b border-line last:border-0">
            <td className="py-1.5 pr-3">{formatLabel(r.x)}</td>
            {view === "price" ? (
              priceKeys.map((sym) => (
                <td key={sym} className="py-1.5 pr-3 text-right">
                  {r[sym] == null ? "—" : `${formatPrice(Number(r[`${sym}:price`]))} (${formatPct(Number(r[sym]))})`}
                </td>
              ))
            ) : (
              <>
                <td className="py-1.5 pr-3 text-right">{formatMoney(Number(r.value))}</td>
                <td className="py-1.5 pr-3 text-right">{formatMoney(Number(r.capital))}</td>
                <td className={cn("py-1.5 pr-3 text-right", trendClass(Number(r.pnl)))}>{formatMoney(Number(r.pnl))}</td>
              </>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LegendItem({
  color,
  label,
  value,
  swatch = "line",
}: {
  color: string;
  label: string;
  value: string;
  swatch?: "line" | "rect";
}) {
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-x-2">
      <span
        aria-hidden
        className={cn("shrink-0", swatch === "line" ? "h-0.5 w-3 rounded-full" : "size-2.5 rounded-sm")}
        style={{ background: color }}
      />
      <span className="text-muted">{label}</span>
      <span className="num font-medium">{value}</span>
    </li>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
  view,
  series,
  priceKeys,
  colorOf,
  formatLabel,
}: TooltipContentProps & {
  view: View;
  series: Series[];
  priceKeys: string[];
  colorOf: Map<string, string>;
  formatLabel: (x: string) => string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload as Row;
  const items =
    view === "price"
      ? priceKeys
          .filter((sym) => row[sym] != null)
          .map((sym) => ({
            key: sym,
            color: colorOf.get(sym) ?? "var(--muted)",
            value: `${formatPrice(Number(row[`${sym}:price`]))} · ${formatPct(Number(row[sym]))}`,
          }))
      : view === "total"
        ? [
            { key: "Giá trị thị trường", color: "var(--chart-1)", value: formatMoney(Number(row.value)) },
            { key: "Vốn đang rót", color: "var(--muted)", value: formatMoney(Number(row.capital)) },
          ]
        : series
            .filter((s) => Number(row[s.key] ?? 0) > 0)
            .map((s) => ({ key: s.key, color: s.color, value: formatMoney(Number(row[s.key])) }))
            // Cùng thứ tự với các lớp chồng trên biểu đồ (trên cùng trước)
            .reverse();
  return (
    <div className="min-w-44 rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      <div className="mb-1.5 text-muted">{formatLabel(String(label))}</div>
      <ul className="space-y-1">
        {items.map((i) => (
          <li key={i.key} className="flex items-center gap-2">
            <span aria-hidden className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: i.color }} />
            <span className="num font-semibold">{i.value}</span>
            <span className="text-muted">{i.key}</span>
          </li>
        ))}
      </ul>
      {view !== "price" && (
        <div className={cn("mt-1.5 border-t border-line pt-1.5 font-medium", trendClass(Number(row.pnl)))}>
          Lãi/lỗ {formatMoney(Number(row.pnl))}
        </div>
      )}
    </div>
  );
}
