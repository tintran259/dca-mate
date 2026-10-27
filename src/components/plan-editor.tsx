"use client";

import { useId, useMemo, useState } from "react";
import type { Exchange, PlanLevel } from "@/db/schema";
import {
  breakEvenPrice,
  computeHolding,
  simulateDca,
  tpChain,
  type LevelInput,
  type PositionInput,
  type SimulationRow,
  type TpStep,
} from "@/lib/calc";
import { formatMoney, formatPct, formatPrice, formatQty, trendClass } from "@/lib/format";
import { roundLot } from "@/lib/market";
import { parseDecimalInput, parseIntInput } from "@/lib/parse";
import { DecimalInput, FieldError, IntInput, invalidProps } from "./form-controls";
import { dcaLevelErrors, tpLevelErrors } from "@/lib/validate";
import { PlusIcon, TrashIcon } from "./icons";
import { Chip, WarnText, cn } from "./ui";
import { useFeeRates } from "./fee-rates";

type Row = {
  key: string;
  id?: number;
  kind: "dca" | "tp";
  pct: string;
  quantity: string;
  sellPct: string;
  status?: PlanLevel["status"];
  filledPrice?: number | null;
};

export type PlanInitial = {
  levels: Pick<PlanLevel, "id" | "kind" | "pct" | "quantity" | "sellPct" | "status" | "filledPrice">[];
};

// Mẫu nhanh: % giảm mỗi nấc (so với giá vốn sau nấc trước) và hệ số KL so với KL đang giữ
const DCA_PRESETS = [
  { label: "Nhẹ", pcts: [5, 5, 7], mult: [1, 1, 1.5] },
  { label: "Cân bằng", pcts: [7, 10, 10], mult: [1, 1.5, 2] },
  { label: "Sâu", pcts: [10, 12, 15], mult: [1, 1.5, 2] },
];
type DcaPreset = (typeof DCA_PRESETS)[number];

// Mẫu chốt lời: [% tăng, % bán trên số cổ còn lại sau nấc trước]
const TP_PRESETS = [
  { label: "3 nấc", rows: [[10, 30], [20, 50], [30, 100]] },
  { label: "2 nấc", rows: [[15, 50], [30, 100]] },
  { label: "Bán hết +20%", rows: [[20, 100]] },
];

let keySeq = 0;
const newKey = () => `n${++keySeq}`;

const toInputPct = (n: number) => String(n).replace(".", ",");

function statusChip(status?: PlanLevel["status"]) {
  if (status === "notified") return <Chip tone="warn">Đã nhắc</Chip>;
  if (status === "done") return <Chip tone="up">Đã làm</Chip>;
  if (status === "skipped") return <Chip>Bỏ qua</Chip>;
  return null;
}

export function PlanEditor({
  exchange,
  firstPrice,
  quantity,
  avgCost,
  totalCost,
  initial,
}: {
  exchange: Exchange;
  /** Giá mua đầu tiên (đồng) */
  firstPrice: number | null;
  /** Khối lượng đang giữ */
  quantity: number;
  /** Giá vốn TB và tổng vốn hiện tại (đã gồm phí), null = tính từ giá mua đầu */
  avgCost: number | null;
  totalCost: number | null;
  initial: PlanInitial;
}) {
  const uid = useId();
  const [rows, setRows] = useState<Row[]>(() =>
    initial.levels.map((l, i) => ({
      // key cố định để server và client render giống nhau (tránh lỗi hydration)
      key: `l${l.id ?? i}`,
      id: l.id,
      kind: l.kind,
      pct: toInputPct(Math.abs(l.pct)),
      quantity: l.quantity ? String(l.quantity) : "",
      sellPct: l.sellPct ? toInputPct(l.sellPct) : "",
      status: l.status,
      filledPrice: l.filledPrice,
    })),
  );

  const baseQty = quantity > 0 ? quantity : 1000;

  const update = (key: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key: string) => setRows((rs) => rs.filter((r) => r.key !== key));

  const addRow = (kind: Row["kind"]) => {
    const same = rows.filter((r) => r.kind === kind);
    const lastPct = parseDecimalInput(same.at(-1)?.pct) ?? 0;
    setRows((rs) => [
      ...rs,
      kind === "dca"
        ? {
            key: newKey(),
            kind,
            pct: toInputPct(lastPct || 7),
            quantity: String(roundLot(baseQty)),
            sellPct: "",
          }
        : { key: newKey(), kind, pct: toInputPct(lastPct ? lastPct + 10 : 10), quantity: "", sellPct: "50" },
    ]);
  };

  const applyDcaPreset = (p: DcaPreset) => {
    setRows((rs) => [
      ...rs.filter((r) => r.kind !== "dca" || (r.status && r.status !== "pending")),
      ...p.pcts.map((pct, i) => ({
        key: newKey(),
        kind: "dca" as const,
        pct: String(pct),
        quantity: String(roundLot(baseQty * p.mult[i])),
        sellPct: "",
      })),
    ]);
  };

  const applyTpPreset = (p: (typeof TP_PRESETS)[number]) => {
    setRows((rs) => [
      ...rs.filter((r) => r.kind !== "tp" || (r.status && r.status !== "pending")),
      ...p.rows.map(([pct, sell]) => ({
        key: newKey(),
        kind: "tp" as const,
        pct: String(pct),
        quantity: "",
        sellPct: String(sell),
      })),
    ]);
  };

  // Chuyển về dữ liệu chuẩn: DCA lưu số âm, chốt lời lưu số dương
  const levels: LevelInput[] = rows.map((r, i) => {
    const pct = Math.abs(parseDecimalInput(r.pct) ?? 0);
    return {
      id: r.id ?? -(i + 1),
      kind: r.kind,
      pct: r.kind === "dca" ? -pct : pct,
      quantity: r.kind === "dca" ? parseIntInput(r.quantity) : null,
      sellPct: r.kind === "tp" ? parseDecimalInput(r.sellPct) : null,
      status: r.status ?? "pending",
      filledPrice: r.filledPrice,
    };
  });

  const json = JSON.stringify(
    levels
      .filter((l) => l.pct !== 0)
      .map((l) => ({ id: l.id > 0 ? l.id : undefined, kind: l.kind, pct: l.pct, quantity: l.quantity, sellPct: l.sellPct })),
  );

  const effAvg = avgCost && avgCost > 0 ? avgCost : firstPrice;

  const fees = useFeeRates();
  const simulation = useMemo(() => {
    if (!firstPrice || !quantity) return [];
    const position: PositionInput = {
      symbol: "",
      exchange,
      maxCapital: null,
      stopLossPct: null,
      trailingPct: null,
      peakPrice: null,
      stopNotifiedAt: null,
      trailNotifiedPeak: null,
    };
    const holding = {
      ...computeHolding([{ id: 1, side: "buy", tradeDate: "2000-01-01", price: firstPrice, quantity, fee: 0, tax: 0 }]),
      ...(totalCost && avgCost ? { totalCost, avgCost } : {}),
    };
    return simulateDca(position, holding, levels, fees);
  }, [firstPrice, quantity, exchange, totalCost, avgCost, levels, fees]);

  const chainByKey = new Map<string, SimulationRow>();
  rows.forEach((r, i) => {
    const sim = simulation.find((x) => x.levelId === levels[i].id);
    if (sim) chainByKey.set(r.key, sim);
  });

  // Chốt lời nối tiếp: nấc 1 tính từ giá vốn TB hiện tại, nấc sau từ nấc trước
  const tpHolding = effAvg && quantity ? { quantity, avgCost: effAvg } : null;
  const tpSteps = tpChain(exchange, tpHolding?.avgCost ?? null, levels, fees, tpHolding ?? undefined);
  const tpByKey = new Map<string, TpStep>();
  rows.forEach((r, i) => {
    const step = tpSteps.get(levels[i].id);
    if (step) tpByKey.set(r.key, step);
  });
  const lastTp = [...tpByKey.values()].at(-1);
  // Số thứ tự của nấc DCA (tính cả nấc đã làm)
  const dcaLevelNo = (levelId: number) => levels.filter((l) => l.kind === "dca").findIndex((l) => l.id === levelId) + 1;

  const last = simulation.at(-1);
  const dcaRows = rows.filter((r) => r.kind === "dca");
  const tpRows = rows.filter((r) => r.kind === "tp");

  return (
    <div className="space-y-6">
      <input type="hidden" name="levels" value={json} />

      {/* ---- DCA ---- */}
      <div>
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <span className="size-2 rounded-full bg-down" /> Nấc mua thêm (DCA) khi giá giảm
        </h3>
        <p className="mb-3 text-sm text-muted">
          Nấc đầu tiên tính % giảm từ giá vốn TB (đã khớp nấc nào thì từ giá khớp của nấc đó). Nấc sau tính từ giá mua của nấc
          trước. Mỗi nấc hiện giá vốn sau khi DCA.
        </p>

        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted">Mẫu nhanh:</span>
          {DCA_PRESETS.map((p) => (
            <button key={p.label} type="button" className="btn-secondary btn-sm" onClick={() => applyDcaPreset(p)}>
              {p.label} −{p.pcts.join("/−")}%
            </button>
          ))}
        </div>

        <DcaStepList
          rows={dcaRows}
          uid={uid}
          chainByKey={chainByKey}
          levelNo={dcaLevelNo}
          onChange={update}
          onRemove={remove}
        />
        <button type="button" className="btn-ghost btn-sm mt-2" onClick={() => addRow("dca")}>
          <PlusIcon size={16} /> Thêm nấc DCA
        </button>

        {last && (
          <div className="mt-3 rounded-xl border border-line p-3 text-sm">
            <div className="mb-2 font-medium">Nếu khớp hết {simulation.length} nấc:</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
              <Mini label="Tổng vốn" value={formatMoney(last.totalCapital)} />
              <Mini
                label={`${last.pnlAtPrice < 0 ? "Lỗ" : "Lãi"} tạm tính`}
                value={formatMoney(last.pnlAtPrice)}
                sub={formatPct(last.pnlPctAtPrice)}
                valueClass={trendClass(last.pnlAtPrice)}
              />
              <Mini label="Tổng KL" value={`${formatQty(last.totalQuantity)} cp`} />
              <Mini label="Giá vốn TB" value={formatPrice(last.avgCost)} />
            </div>
            <p className="mt-2 text-xs text-muted">
              Lãi/lỗ tính tại giá nấc cuối {formatPrice(last.price)}
              {last.dropFromFirstPct != null && ` (${formatPct(last.dropFromFirstPct)} so với giá mua đầu)`}, đã trừ phí và thuế bán.
              Giá cần hồi {formatPct(last.recoveryPct)} (lên {formatPrice(last.breakEven)}) để hòa vốn.
            </p>
          </div>
        )}
      </div>

      {/* ---- Chốt lời ---- */}
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <span className="size-2 rounded-full bg-up" /> Nấc chốt lời
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {TP_PRESETS.map((p) => (
              <button key={p.label} type="button" className="btn-secondary btn-sm" onClick={() => applyTpPreset(p)}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <p className="mb-3 text-sm text-muted">
          Nấc 1 tính % tăng từ giá vốn trung bình đang giữ: chưa DCA là giá gốc, đã DCA là giá vốn sau DCA. Nấc 2 tính từ giá nấc 1, cứ
          thế tiếp tục. % bán tính trên số cổ còn lại sau nấc trước; đặt 100% để bán hết.
        </p>

        <TpList
          rows={tpRows}
          uid={uid}
          steps={tpByKey}
          breakEven={tpHolding ? breakEvenPrice(tpHolding.avgCost, fees) : null}
          onChange={update}
          onRemove={remove}
        />
        <button type="button" className="btn-ghost btn-sm mt-2" onClick={() => addRow("tp")}>
          <PlusIcon size={16} /> Thêm nấc chốt lời
        </button>
        {lastTp && tpHolding ? (
          <div className="mt-3 rounded-xl border border-line p-3 text-sm">
            <div className="mb-2 font-medium">Nếu chạm hết {tpByKey.size} nấc chốt lời:</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
              <Mini
                label={`Tổng ${lastTp.cumulativeProfit < 0 ? "lỗ" : "lãi"}`}
                value={formatMoney(lastTp.cumulativeProfit)}
                valueClass={trendClass(lastTp.cumulativeProfit)}
              />
              <Mini label="Đã bán" value={`${formatQty((tpHolding?.quantity ?? 0) - lastTp.remainingAfter)} cp`} />
              <Mini label="Còn giữ" value={`${formatQty(lastTp.remainingAfter)} cp`} />
            </div>
            <p className="mt-2 text-xs text-muted">Tính theo khối lượng và giá vốn TB hiện tại, đã trừ phí và thuế bán.</p>
          </div>
        ) : null}
      </div>

    </div>
  );
}

function Mini({ label, value, sub, valueClass }: { label: string; value: string; sub?: string; valueClass?: string }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className={cn("num font-semibold", valueClass)}>
        {value}
        {sub && <span className="ml-1 text-xs font-medium">({sub})</span>}
      </div>
    </div>
  );
}



function DcaStepList({
  rows,
  uid,
  chainByKey,
  levelNo,
  onChange,
  onRemove,
}: {
  rows: Row[];
  uid: string;
  chainByKey: Map<string, SimulationRow>;
  /** Số thứ tự nấc DCA theo id */
  levelNo: (levelId: number) => number;
  onChange: (key: string, patch: Partial<Row>) => void;
  onRemove: (key: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-sm text-muted">
        Chưa có nấc DCA. Chọn một mẫu ở trên hoặc thêm nấc.
      </p>
    );
  }

  return (
    <ol className="space-y-2">
      {rows.map((row, i) => {
        const sim = chainByKey.get(row.key);
        const locked = row.status === "done" || row.status === "skipped";
        // Nấc đã làm là lệnh thật đã ghi: không cho sửa % / khối lượng, không cho xóa
        const done = row.status === "done";
        const qtyNum = parseIntInput(row.quantity);
        // KL được làm tròn lô khi rời ô, nên chỉ báo lỗi sau khi làm tròn
        const errs = done ? {} : dcaLevelErrors(parseDecimalInput(row.pct), qtyNum ? roundLot(qtyNum) : qtyNum);
        const baseText = !sim
          ? ""
          : sim.baseLevelId == null
            ? `so với giá vốn TB ${formatPrice(sim.basePrice)}`
            : `so với ${sim.baseSource === "filled" ? "giá khớp" : sim.baseSource === "skipped" ? "mốc bỏ qua" : "giá mua"} nấc ${levelNo(sim.baseLevelId)} ${formatPrice(sim.basePrice)}`;

        return (
          <li key={row.key} className={cn("rounded-xl border border-line p-3", locked && "opacity-60")}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <span className="chip bg-down-soft text-down">Nấc {i + 1}</span>
                {statusChip(row.status)}
              </span>
              <button
                type="button"
                className="btn-ghost size-9 min-h-9 p-0"
                onClick={() => onRemove(row.key)}
                disabled={done}
                title={done ? "Nấc đã làm, không xóa được" : undefined}
                aria-label={`Xóa nấc ${i + 1}`}
              >
                <TrashIcon size={18} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs text-muted" htmlFor={`${uid}-${row.key}-pct`}>
                  Giá giảm
                </label>
                <DecimalInput
                  id={`${uid}-${row.key}-pct`}
                  value={row.pct}
                  onValueChange={(v) => onChange(row.key, { pct: v.replace(/[-+]/g, "") })}
                  suffix="%"
                  prefix={<span className="text-down">−</span>}
                  placeholder="7"
                  disabled={done}
                  {...invalidProps(`${uid}-${row.key}-pct`, errs.pct)}
                />
                {errs.pct && <FieldError id={`${uid}-${row.key}-pct-error`}>{errs.pct}</FieldError>}
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted" htmlFor={`${uid}-${row.key}-qty`}>
                  Mua thêm
                </label>
                <IntInput
                  id={`${uid}-${row.key}-qty`}
                  value={row.quantity}
                  onValueChange={(v) => onChange(row.key, { quantity: v })}
                  onBlur={() => {
                    const q = parseIntInput(row.quantity);
                    if (q) onChange(row.key, { quantity: String(roundLot(q)) });
                  }}
                  suffix="cp"
                  placeholder="1.000"
                  disabled={done}
                  {...invalidProps(`${uid}-${row.key}-qty`, errs.amount)}
                />
                {errs.amount && <FieldError id={`${uid}-${row.key}-qty-error`}>{errs.amount}</FieldError>}
              </div>
            </div>

            <div className="mt-2.5 rounded-lg bg-surface-2 px-3 py-2 text-sm">
              {sim ? (
                <>
                  <div>
                    Mua khi giá ≤ <b className="num">{formatPrice(sim.price)}</b>{" "}
                    <span className="text-muted">
                      ({formatPct(sim.pct)} {baseText})
                    </span>
                    <span className="num text-muted"> · {formatMoney(sim.price * sim.quantity)}</span>
                  </div>
                  <div className="num mt-1 flex flex-wrap items-baseline gap-x-1.5">
                    <span className="text-muted">Giá vốn sau DCA:</span>
                    <span className="text-muted">{formatPrice(sim.avgBefore)}</span>
                    <span className="text-muted">→</span>
                    <b className="text-base text-primary">{formatPrice(sim.avgCost)}</b>
                    <span className="text-xs text-muted">
                      (tổng {formatQty(sim.totalQuantity)} cp)
                    </span>
                  </div>
                </>
              ) : locked ? (
                <span className="text-muted">
                  {row.status === "done" && row.filledPrice
                    ? `Đã khớp ở ${formatPrice(row.filledPrice)}. Các nấc sau tính tiếp từ giá này.`
                    : row.status === "skipped" && row.filledPrice
                      ? `Đã bỏ qua, giữ mốc ${formatPrice(row.filledPrice)}. Các nấc sau vẫn tính tiếp từ giá này.`
                      : "Nấc này không tính vào chuỗi DCA còn lại."}
                </span>
              ) : (
                <span className="text-muted">Nhập giá mua, khối lượng và % giảm để xem giá vốn sau DCA.</span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function TpList({
  rows,
  uid,
  steps,
  breakEven,
  onChange,
  onRemove,
}: {
  rows: Row[];
  uid: string;
  steps: Map<string, TpStep>;
  breakEven: number | null;
  onChange: (key: string, patch: Partial<Row>) => void;
  onRemove: (key: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-sm text-muted">
        Chưa có nấc chốt lời.
      </p>
    );
  }
  return (
    <ol className="space-y-2">
      {rows.map((row, i) => {
        const step = steps.get(row.key);
        const belowBreakEven = step != null && breakEven != null && step.price < breakEven;
        const locked = row.status === "done" || row.status === "skipped";
        // Nấc đã làm là lệnh thật đã ghi: không cho sửa % / khối lượng, không cho xóa
        const done = row.status === "done";
        const errs = done ? {} : tpLevelErrors(parseDecimalInput(row.pct), parseDecimalInput(row.sellPct));
        return (
          <li key={row.key} className={cn("rounded-xl border border-line p-3", locked && "opacity-60")}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <span className="chip bg-up-soft text-up">Nấc {i + 1}</span>
                {statusChip(row.status)}
              </span>
              <button
                type="button"
                className="btn-ghost size-9 min-h-9 p-0"
                onClick={() => onRemove(row.key)}
                disabled={done}
                title={done ? "Nấc đã làm, không xóa được" : undefined}
                aria-label={`Xóa nấc chốt lời ${i + 1}`}
              >
                <TrashIcon size={18} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs text-muted" htmlFor={`${uid}-${row.key}-pct`}>
                  Giá tăng
                </label>
                <DecimalInput
                  id={`${uid}-${row.key}-pct`}
                  value={row.pct}
                  onValueChange={(v) => onChange(row.key, { pct: v.replace(/[-+]/g, "") })}
                  suffix="%"
                  prefix={<span className="text-up">+</span>}
                  placeholder="10"
                  disabled={done}
                  {...invalidProps(`${uid}-${row.key}-pct`, errs.pct)}
                />
                {errs.pct && <FieldError id={`${uid}-${row.key}-pct-error`}>{errs.pct}</FieldError>}
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted" htmlFor={`${uid}-${row.key}-sell`}>
                  Bán (% số còn lại)
                </label>
                <DecimalInput
                  id={`${uid}-${row.key}-sell`}
                  value={row.sellPct}
                  onValueChange={(v) => onChange(row.key, { sellPct: v.replace(/[-+]/g, "") })}
                  suffix="%"
                  placeholder="50"
                  disabled={done}
                  {...invalidProps(`${uid}-${row.key}-sell`, errs.amount)}
                />
                {errs.amount && <FieldError id={`${uid}-${row.key}-sell-error`}>{errs.amount}</FieldError>}
              </div>
            </div>

            <div className="mt-2.5 rounded-lg bg-surface-2 px-3 py-2 text-sm">
              {step && row.status === "skipped" ? (
                <span className="text-muted">
                  Đã bỏ qua, giữ mốc <b className="num">{formatPrice(step.price)}</b>. Các nấc sau vẫn tính tiếp từ giá này.
                </span>
              ) : step ? (
                <div>
                  Bán khi giá ≥ <b className="num">{formatPrice(step.price)}</b>{" "}
                  <span className="text-muted">
                    ({formatPct(Math.abs(parseDecimalInput(row.pct) ?? 0))}{" "}
                    {step.index === 0 ? "từ giá vốn TB" : `từ chốt lời nấc ${step.index}`} {formatPrice(step.basePrice)})
                  </span>
                </div>
              ) : (
                <span className="text-muted">{locked ? "Nấc này không còn trong chuỗi." : "Nhập giá mua để xem giá kích hoạt."}</span>
              )}
              {step && step.sellQuantity > 0 && (
                <dl className="num mt-2 grid grid-cols-3 gap-2 border-t border-line pt-2">
                  <div>
                    <dt className="text-xs text-muted">Bán</dt>
                    <dd className="font-semibold">{formatQty(step.sellQuantity)} cp</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Còn lại</dt>
                    <dd className="font-semibold">{formatQty(step.remainingAfter)} cp</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">{step.profit < 0 ? "Lỗ" : "Lãi"}</dt>
                    <dd className={cn("font-semibold whitespace-nowrap", trendClass(step.profit))}>{formatMoney(step.profit)}</dd>
                    <dd className={cn("text-xs font-medium", trendClass(step.profit))}>{formatPct(step.profitPct)}</dd>
                  </div>
                </dl>
              )}
              {step && step.sellQuantity === 0 && row.status !== "done" && (
                <p className="mt-1 text-xs text-muted">Đã bán hết ở các nấc trước, nấc này không còn cổ để bán.</p>
              )}
              {belowBreakEven && (
                <WarnText className="mt-1">Thấp hơn giá hòa vốn {formatPrice(breakEven)}: bán ở đây sẽ lỗ.</WarnText>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
