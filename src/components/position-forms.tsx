"use client";

import { useCallback, useEffect, useState, useTransition, type FormEvent } from "react";
import {
  addTransaction,
  markAllAlertsSeen,
  deleteTransaction,
  refreshPrices,
  savePlan,
  setAlertStatus,
  setLevelStatus,
  setManualPrice,
  updateThesis,
  type ActionState,
} from "@/app/actions";
import type { Exchange } from "@/db/schema";
import { classifyTrade, type PlanHints, type TradeFit } from "@/lib/calc";
import { priceError, tradeErrors } from "@/lib/validate";
import { formatMoney, formatPrice, formatQty, trendClass } from "@/lib/format";
import { buyFee, sellFee, sellTax } from "@/lib/market";
import { parseIntInput } from "@/lib/parse";
import {
  DateInput,
  Field,
  FieldError,
  IntInput,
  Modal,
  Segmented,
  Spinner,
  SubmitButton,
  focusFirstInvalid,
  invalidProps,
  useFormAction,
} from "./form-controls";
import { CheckIcon, RefreshIcon, TrashIcon, UndoIcon, XIcon } from "./icons";
import { PlanEditor, type PlanInitial } from "./plan-editor";
import { Notice, WarnText, cn } from "./ui";

function ResultNotice({ state }: { state: ActionState }) {
  if (!state) return null;
  if (state.error) return <Notice tone="error">{state.error}</Notice>;
  if (state.ok) return <Notice tone="ok">{state.ok}</Notice>;
  return null;
}

// ---------- Kế hoạch ----------

export function PlanForm(props: {
  positionId: number;
  exchange: Exchange;
  firstPrice: number | null;
  quantity: number;
  avgCost: number;
  totalCost: number;
  initial: PlanInitial;
}) {
  const [state, onSubmit, pending] = useFormAction(savePlan);
  const { positionId, ...editor } = props;
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <input type="hidden" name="positionId" value={positionId} />
      <PlanEditor {...editor} />
      <ResultNotice state={state} />
      <div className="sheet-footer flex justify-end border-t border-line pt-4">
        <SubmitButton pending={pending} className="btn-primary w-full sm:w-auto sm:min-w-40">
          Lưu kế hoạch
        </SubmitButton>
      </div>
    </form>
  );
}

// ---------- Ghi lệnh ----------

export type TradePrefill = {
  side?: "buy" | "sell";
  price?: number;
  quantity?: number;
  levelId?: number;
  alertId?: number;
  label?: string;
};

export type SellPlanOption = { levelNo: number; sellPct: number; quantity: number; price: number | null };

export function TradeForm({
  positionId,
  exchange,
  holdingQty,
  prefill,
  hints,
  sellPlan,
}: {
  positionId: number;
  exchange: Exchange;
  holdingQty: number;
  prefill?: TradePrefill;
  /** Tóm tắt kế hoạch để phát hiện lệnh lệch kế hoạch */
  hints: PlanHints;
  /** Các nấc chốt lời đang chờ: nút điền nhanh khối lượng bán theo kế hoạch */
  sellPlan: SellPlanOption[];
}) {
  const [state, , pending, submit] = useFormAction(addTransaction);
  // Bán hết cổ phiếu = đóng mã: chờ người dùng xác nhận
  const [sellAll, setSellAll] = useState<FormData | null>(null);
  // Lệnh lệch kế hoạch đang chờ người dùng chọn: thêm thành nấc mới hay hủy
  const [deviation, setDeviation] = useState<{ formData: FormData; fit: Extract<TradeFit, { kind: "insert" }> } | null>(null);
  const [side, setSide] = useState<"buy" | "sell">(prefill?.side ?? "buy");
  const [price, setPrice] = useState(prefill?.price ? String(prefill.price) : "");
  const [quantity, setQuantity] = useState(prefill?.quantity ? String(prefill.quantity) : "");
  const [note, setNote] = useState("");
  const [fee, setFee] = useState<string | null>(null);
  const [tax, setTax] = useState<string | null>(null);
  const [linked, setLinked] = useState(Boolean(prefill?.levelId || prefill?.alertId));

  // Lưu thành công thì xóa trắng form để nhập lệnh tiếp
  const [lastState, setLastState] = useState(state);
  if (state !== lastState) {
    setLastState(state);
    if (state?.ok) {
      setPrice("");
      setQuantity("");
      setNote("");
      setFee(null);
      setTax(null);
      setLinked(false);
    }
  }

  const p = parseIntInput(price) ?? 0;
  const q = parseIntInput(quantity) ?? 0;
  const autoFee = p && q ? (side === "buy" ? buyFee(p, q) : sellFee(p, q)) : 0;
  const autoTax = p && q && side === "sell" ? sellTax(p, q) : 0;
  const feeValue = fee ?? (autoFee ? String(autoFee) : "");
  const taxValue = tax ?? (autoTax ? String(autoTax) : "");
  const errors = tradeErrors({
    exchange,
    side,
    price: parseIntInput(price),
    quantity: parseIntInput(quantity),
    fee: parseIntInput(feeValue),
    tax: side === "sell" ? parseIntInput(taxValue) : null,
    holdingQty,
  });

  const onTradeSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (focusFirstInvalid(e.currentTarget)) return;
    const formData = new FormData(e.currentTarget);
    if (side === "sell" && q === holdingQty) {
      setSellAll(formData);
      return;
    }
    const hasLink = formData.get("levelId") || formData.get("alertId");
    const fit = !hasLink && p > 0 ? classifyTrade(hints, side, p) : null;
    if (fit?.kind === "insert") {
      setDeviation({ formData, fit });
      return;
    }
    submit(formData);
  };
  const confirmInsert = () => {
    if (!deviation) return;
    deviation.formData.set("insertLevel", "1");
    submit(deviation.formData);
    setDeviation(null);
  };
  const isBuy = side === "buy";
  const label = isBuy ? "DCA" : "chốt lời";

  return (
    <>
      <Modal open={sellAll != null} onClose={() => setSellAll(null)} title={`Bán hết ${hints.symbol}?`}>
        <div className="space-y-3 text-sm">
          <p>
            Bạn đang bán toàn bộ <b className="num">{formatQty(holdingQty)} cp</b> ở giá <b className="num">{formatPrice(p)}</b>.
          </p>
          <WarnText>
            Bán hết đồng nghĩa với đóng mã {hints.symbol}: mã rời khỏi danh mục đang nắm giữ, các nấc còn chờ không được nhắc nữa.
            Lịch sử vẫn xem lại được ở mục &quot;Đã đóng&quot;.
          </WarnText>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className="btn-secondary" onClick={() => setSellAll(null)}>
              Hủy
            </button>
            <button
              type="button"
              className="btn bg-down text-bg"
              onClick={() => {
                if (sellAll) submit(sellAll);
                setSellAll(null);
              }}
            >
              Bán hết và đóng mã
            </button>
          </div>
        </div>
      </Modal>
      <Modal open={deviation != null} onClose={() => setDeviation(null)} title={`Giá ${isBuy ? "mua" : "bán"} lệch kế hoạch ${label}`}>
        {deviation && (
          <div className="space-y-3 text-sm">
            <p>
              Giá <b className="num">{formatPrice(p)}</b> {isBuy ? "thấp" : "cao"} hơn giá vốn TB{" "}
              <b className="num">{formatPrice(hints.avgCost)}</b>
              {deviation.fit.before ? (
                <>
                  {" "}nhưng chưa tới nấc {label} {deviation.fit.before.levelNo} ({isBuy ? "≤" : "≥"}{" "}
                  <b className="num">{formatPrice(deviation.fit.before.price)}</b>).
                </>
              ) : (
                <> và không còn nấc {label} nào đang chờ.</>
              )}
            </p>
            <div className="rounded-xl bg-surface-2 p-3">
              <div className="font-medium">Thêm lệnh này thành nấc {label} mới (đã làm):</div>
              <ul className="num mt-1 list-disc space-y-0.5 pl-5 text-muted">
                <li>
                  {deviation.fit.pct > 0 ? "+" : ""}
                  {String(deviation.fit.pct).replace(".", ",")}% so với {formatPrice(isBuy ? hints.dca.base : hints.tp.base)},{" "}
                  {isBuy ? "mua" : "bán"} {formatQty(q)} cp
                </li>
                <li>
                  {deviation.fit.before
                    ? `Đặt vào vị trí nấc ${deviation.fit.before.levelNo}; nấc ${deviation.fit.before.levelNo} trở đi lùi xuống 1 bậc và tính lại từ giá ${formatPrice(p)}.`
                    : "Đặt ở cuối chuỗi."}
                </li>
              </ul>
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" className="btn-ghost" onClick={() => setDeviation(null)}>
                Hủy
              </button>
              <button type="button" className="btn-primary" onClick={confirmInsert}>
                Thêm nấc mới và ghi lệnh
              </button>
            </div>
          </div>
        )}
      </Modal>
      <form onSubmit={onTradeSubmit} className="space-y-3">
        <input type="hidden" name="positionId" value={positionId} />
        {linked && prefill?.levelId && <input type="hidden" name="levelId" value={prefill.levelId} />}
        {linked && prefill?.alertId && <input type="hidden" name="alertId" value={prefill.alertId} />}

        {linked && prefill?.label && (
          <div className="flex items-center justify-between gap-2 rounded-xl bg-primary-soft px-3 py-2 text-sm text-primary">
            <span>{prefill.label}</span>
            <button type="button" className="text-xs underline" onClick={() => setLinked(false)}>
              Bỏ liên kết
            </button>
          </div>
        )}

        <Segmented
          name="side"
          value={side}
          onChange={(v) => {
            setSide(v);
            setFee(null);
            setTax(null);
          }}
          options={[
            { value: "buy", label: "Mua", activeClass: "bg-up text-bg shadow-sm" },
            { value: "sell", label: "Bán", activeClass: "bg-down text-bg shadow-sm" },
          ]}
        />

        <div className="grid grid-cols-2 gap-3">
          <Field label="Giá khớp" htmlFor="tx-price" error={errors.price}>
            <IntInput
              id="tx-price"
              name="price"
              required
              value={price}
              onValueChange={setPrice}
              placeholder="25.000"
              suffix="đ"
              {...invalidProps("tx-price", errors.price)}
            />
          </Field>
          <Field
            label="Khối lượng"
            htmlFor="tx-qty"
            error={errors.quantity}
            hint={side === "sell" ? `Đang giữ ${holdingQty.toLocaleString("vi-VN")} cp` : undefined}
          >
            <IntInput
              id="tx-qty"
              name="quantity"
              required
              value={quantity}
              onValueChange={setQuantity}
              placeholder="1.000"
              suffix="cp"
              {...invalidProps("tx-qty", errors.quantity)}
            />
          </Field>
          <Field label="Ngày" htmlFor="tx-date">
            <DateInput id="tx-date" name="tradeDate" required />
          </Field>
          <Field label="Phí" htmlFor="tx-fee" error={errors.fee}>
            <IntInput
              id="tx-fee"
              name="fee"
              value={feeValue}
              onValueChange={setFee}
              placeholder="0"
              suffix="đ"
              {...invalidProps("tx-fee", errors.fee)}
            />
          </Field>
          {side === "sell" && (
            <Field label="Thuế bán (0,1%)" htmlFor="tx-tax" className="col-span-2 sm:col-span-1" error={errors.tax}>
              <IntInput
                id="tx-tax"
                name="tax"
                value={taxValue}
                onValueChange={setTax}
                placeholder="0"
                suffix="đ"
                {...invalidProps("tx-tax", errors.tax)}
              />
            </Field>
          )}
        </div>
        {side === "sell" && holdingQty > 0 && (
          <div>
            <div className="mb-1.5 text-xs text-muted">Bán theo kế hoạch chốt lời:</div>
            <div className="flex flex-wrap gap-1.5">
              {sellPlan.map((opt) => (
                <button
                  key={opt.levelNo}
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => {
                    setQuantity(String(opt.quantity));
                    if (!price && opt.price) setPrice(String(opt.price));
                  }}
                >
                  Nấc {opt.levelNo} · {String(opt.sellPct).replace(".", ",")}% · {formatQty(opt.quantity)} cp
                </button>
              ))}
              <button type="button" className="btn-secondary btn-sm" onClick={() => setQuantity(String(holdingQty))}>
                Bán hết · {formatQty(holdingQty)} cp
              </button>
            </div>
          </div>
        )}

        <Field label="Ghi chú" htmlFor="tx-note">
          <input id="tx-note" name="note" className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Lý do mua/bán (không bắt buộc)" />
        </Field>

        {p > 0 && q > 0 && (
          <div className="flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2 text-sm">
            <span className="text-muted">{side === "buy" ? "Tổng tiền mua" : "Tiền về sau phí, thuế"}</span>
            <span className="num font-semibold">
              {formatMoney(
                side === "buy"
                  ? p * q + (parseIntInput(feeValue) ?? 0)
                  : p * q - (parseIntInput(feeValue) ?? 0) - (parseIntInput(taxValue) ?? 0),
              )}
            </span>
          </div>
        )}

        <ResultNotice state={state} />
        <SubmitButton pending={pending} className={cn("btn w-full text-bg", side === "buy" ? "bg-up" : "bg-down")}>
          {side === "buy" ? "Ghi lệnh mua" : "Ghi lệnh bán"}
        </SubmitButton>
      </form>
    </>
  );
}

// ---------- Giá tay ----------

export function ManualPriceForm({ positionId, exchange }: { positionId: number; exchange: Exchange }) {
  const [state, onSubmit, pending] = useFormAction(setManualPrice);
  const [price, setPrice] = useState("");
  const error = priceError(exchange, parseIntInput(price));
  const inputId = `manual-price-${positionId}`;
  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <input type="hidden" name="positionId" value={positionId} />
      <label className="label" htmlFor={`manual-price-${positionId}`}>
        Giá hiện tại
      </label>
      <div className="flex gap-2">
        <div className="flex-1">
          <IntInput
            id={inputId}
            name="price"
            required
            value={price}
            onValueChange={setPrice}
            placeholder="VD 23.250"
            suffix="đ"
            {...invalidProps(inputId, error)}
          />
        </div>
        <SubmitButton pending={pending} className="btn-secondary" pendingText="…">
          Cập nhật
        </SubmitButton>
      </div>
      {error && <FieldError id={`${inputId}-error`}>{error}</FieldError>}
      <ResultNotice state={state} />
    </form>
  );
}

// ---------- Ghi chú luận điểm ----------

export function ThesisForm({ positionId, thesis }: { positionId: number; thesis: string | null }) {
  const [state, onSubmit, pending] = useFormAction(updateThesis);
  const [value, setValue] = useState(thesis ?? "");
  const dirty = value !== (thesis ?? "");
  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <input type="hidden" name="positionId" value={positionId} />
      <textarea
        name="thesis"
        rows={4}
        className="field resize-y text-sm"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Vì sao bạn mua mã này? Điều gì xảy ra thì luận điểm sai?"
      />
      {(dirty || state) && (
        <div className="flex items-center gap-2">
          {dirty && (
            <SubmitButton pending={pending} className="btn-secondary btn-sm">
              Lưu ghi chú
            </SubmitButton>
          )}
          {!dirty && <ResultNotice state={state} />}
        </div>
      )}
    </form>
  );
}

// ---------- Nút hành động nhỏ ----------

function useRun() {
  const [pending, start] = useTransition();
  return [pending, (fn: () => Promise<unknown>) => start(async () => void (await fn()))] as const;
}

export type QuickTrade = {
  positionId: number;
  side: "buy" | "sell";
  price: number | null;
  quantity: number | null;
  levelId?: number;
  alertId?: number;
  /** Tiêu đề popup, VD "Nấc DCA 1" */
  label: string;
  /** Đang giữ và giá vốn TB hiện tại, để hiện giá vốn sau lệnh / tiền lãi */
  holdingQty: number;
  avgCost: number;
  exchange: Exchange;
};

/** Nội dung popup xác nhận: giá và KL điền sẵn theo nấc (sửa được), bấm xác nhận là ghi lệnh. */
function QuickTradeForm({
  trade,
  onDone,
  onCancel,
}: {
  trade: QuickTrade;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const [state, onSubmit, pending] = useFormAction(addTransaction);
  const [price, setPrice] = useState(trade.price ? String(trade.price) : "");
  const [quantity, setQuantity] = useState(trade.quantity ? String(trade.quantity) : "");
  const isBuy = trade.side === "buy";
  const p = parseIntInput(price) ?? 0;
  const q = parseIntInput(quantity) ?? 0;
  const fee = p && q ? (isBuy ? buyFee(p, q) : sellFee(p, q)) : 0;
  const tax = p && q && !isBuy ? sellTax(p, q) : 0;
  const errors = tradeErrors({
    exchange: trade.exchange,
    side: trade.side,
    price: parseIntInput(price),
    quantity: parseIntInput(quantity),
    fee,
    tax,
    holdingQty: trade.holdingQty,
  });

  useEffect(() => {
    if (state?.ok) onDone(state.ok);
  }, [state, onDone]);

  const newAvg = isBuy && q ? (trade.avgCost * trade.holdingQty + p * q + fee) / (trade.holdingQty + q) : null;
  const profit = !isBuy && q ? p * q - fee - tax - trade.avgCost * q : null;

  return (
    <form onSubmit={onSubmit} className="space-y-3 text-left">
      <input type="hidden" name="positionId" value={trade.positionId} />
      <input type="hidden" name="side" value={trade.side} />
      {trade.levelId && <input type="hidden" name="levelId" value={trade.levelId} />}
      {trade.alertId && <input type="hidden" name="alertId" value={trade.alertId} />}
      <input type="hidden" name="fee" value={fee} />
      <input type="hidden" name="tax" value={tax} />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-xs text-muted" htmlFor={`qt-price-${trade.levelId ?? trade.alertId}`}>
            Giá khớp
          </label>
          <IntInput
            id={`qt-price-${trade.levelId ?? trade.alertId}`}
            name="price"
            required
            value={price}
            onValueChange={setPrice}
            suffix="đ"
            {...invalidProps(`qt-price-${trade.levelId ?? trade.alertId}`, errors.price)}
          />
          {errors.price && <FieldError id={`qt-price-${trade.levelId ?? trade.alertId}-error`}>{errors.price}</FieldError>}
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted" htmlFor={`qt-qty-${trade.levelId ?? trade.alertId}`}>
            Khối lượng
          </label>
          <IntInput
            id={`qt-qty-${trade.levelId ?? trade.alertId}`}
            name="quantity"
            required
            value={quantity}
            onValueChange={setQuantity}
            suffix="cp"
            {...invalidProps(`qt-qty-${trade.levelId ?? trade.alertId}`, errors.quantity)}
          />
          {errors.quantity && <FieldError id={`qt-qty-${trade.levelId ?? trade.alertId}-error`}>{errors.quantity}</FieldError>}
        </div>
      </div>
      {p > 0 && q > 0 && (
        <dl className="num grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-xl bg-surface-2 p-3 text-sm">
          <dt className="text-muted">{isBuy ? "Tổng tiền mua" : "Tiền về"}</dt>
          <dd className="text-right font-medium">{formatMoney(isBuy ? p * q + fee : p * q - fee - tax)}</dd>
          <dt className="text-muted">Phí{isBuy ? "" : ", thuế"}</dt>
          <dd className="text-right">{formatMoney(fee + tax)}</dd>
          {newAvg != null && (
            <>
              <dt className="text-muted">Giá vốn TB</dt>
              <dd className="text-right">
                {formatPrice(trade.avgCost)} → <b className="text-primary">{formatPrice(newAvg)}</b>
              </dd>
              <dt className="text-muted">Đang giữ sau lệnh</dt>
              <dd className="text-right">{formatQty(trade.holdingQty + q)} cp</dd>
            </>
          )}
          {profit != null && (
            <>
              <dt className="text-muted">{profit < 0 ? "Lỗ" : "Lãi"} so với giá vốn</dt>
              <dd className={cn("text-right font-semibold", trendClass(profit))}>{formatMoney(profit)}</dd>
              <dt className="text-muted">Còn giữ sau lệnh</dt>
              <dd className="text-right">{formatQty(Math.max(0, trade.holdingQty - q))} cp</dd>
            </>
          )}
        </dl>
      )}
      {!isBuy && q > 0 && q === trade.holdingQty && (
        <WarnText>Lệnh này bán hết cổ phiếu: mã sẽ được đóng và rời khỏi danh mục đang nắm giữ.</WarnText>
      )}
      <p className="text-xs text-muted">Ngày giao dịch: hôm nay.</p>
      {state?.error && <Notice tone="error">{state.error}</Notice>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Hủy
        </button>
        <SubmitButton pending={pending} className={cn("btn text-bg", isBuy ? "bg-up" : "bg-down")} pendingText="Đang ghi…">
          <CheckIcon size={16} /> Xác nhận {isBuy ? "mua" : "bán"}
        </SubmitButton>
      </div>
    </form>
  );
}

/** Nút "Đã làm": mở popup xác nhận, bấm xác nhận là ghi lệnh luôn. */
function DoneButton({ trade, label, className }: { trade: QuickTrade; label: string; className: string }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} aria-haspopup="dialog">
        <CheckIcon size={14} /> {label}
      </button>
      <Modal open={open} onClose={close} title={`${trade.side === "buy" ? "Xác nhận đã mua" : "Xác nhận đã bán"} · ${trade.label}`}>
        <QuickTradeForm trade={trade} onDone={close} onCancel={close} />
      </Modal>
    </>
  );
}

export function LevelActions({
  levelId,
  status,
  trade,
}: {
  levelId: number;
  status: "pending" | "notified" | "done" | "skipped";
  trade: QuickTrade;
}) {
  const [pending, run] = useRun();
  if (status === "done" || status === "skipped") {
    return (
      <button
        type="button"
        className="btn-ghost btn-sm"
        disabled={pending}
        onClick={() => run(() => setLevelStatus(levelId, "pending"))}
      >
        {pending ? <Spinner /> : <UndoIcon size={14} />} Khôi phục
      </button>
    );
  }
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      <DoneButton trade={trade} label="Đã làm" className="btn-secondary btn-sm" />
      <button
        type="button"
        className="btn-ghost btn-sm"
        disabled={pending}
        onClick={() => run(() => setLevelStatus(levelId, "skipped"))}
        aria-label="Bỏ qua nấc này"
      >
        {pending ? <Spinner /> : <XIcon size={14} />}
        <span className="hidden sm:inline">Bỏ qua</span>
      </button>
    </div>
  );
}

export function AlertActions({
  alertId,
  symbol,
  trade,
}: {
  alertId: number;
  symbol: string;
  trade: QuickTrade | null;
}) {
  const [pending, run] = useRun();
  return (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <ConfirmButton
        className="btn-secondary"
        title={`Bỏ qua cảnh báo ${symbol}?`}
        confirmLabel="Bỏ qua cảnh báo"
        pending={pending}
        onConfirm={() => run(() => setAlertStatus(alertId, "skipped"))}
        body="Cảnh báo chuyển sang Đã xử lý và nấc tương ứng chuyển sang Bỏ qua. Thao tác này không hoàn tác được."
      >
        <XIcon size={16} /> Bỏ qua
      </ConfirmButton>
      {trade ? (
        <DoneButton trade={trade} label="Đã làm, ghi lệnh" className="btn-primary" />
      ) : (
        <button type="button" className="btn-primary" disabled={pending} onClick={() => run(() => setAlertStatus(alertId, "done"))}>
          <CheckIcon size={16} /> Đã xem
        </button>
      )}
    </div>
  );
}

/** Nút có popup xác nhận cho thao tác không hoàn tác được */
export function ConfirmButton({
  className,
  title,
  body,
  confirmLabel,
  pending,
  onConfirm,
  children,
}: {
  className: string;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  pending?: boolean;
  onConfirm: () => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button type="button" className={className} disabled={pending} onClick={() => setOpen(true)} aria-haspopup="dialog">
        {pending ? <Spinner /> : null}
        {children}
      </button>
      <Modal open={open} onClose={close} title={title}>
        <p className="text-sm">{body}</p>
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-secondary" onClick={close}>
            Hủy
          </button>
          <button
            type="button"
            className="btn bg-down text-bg"
            onClick={() => {
              close();
              onConfirm();
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </Modal>
    </>
  );
}

export function SkipAllAlertsButton({ count }: { count: number }) {
  const [pending, run] = useRun();
  return (
    <ConfirmButton
      className="btn-ghost btn-sm"
      title={`Bỏ qua ${count} cảnh báo?`}
      confirmLabel="Bỏ qua tất cả"
      pending={pending}
      onConfirm={() => run(() => markAllAlertsSeen())}
      body="Tất cả cảnh báo đang chờ chuyển sang Đã xử lý, các nấc tương ứng chuyển sang Bỏ qua. Thao tác này không hoàn tác được."
    >
      Bỏ qua tất cả
    </ConfirmButton>
  );
}

export function DeleteTransactionButton({ id }: { id: number }) {
  const [pending, run] = useRun();
  return (
    <button
      type="button"
      className="btn-ghost size-9 min-h-9 p-0"
      disabled={pending}
      aria-label="Xóa lệnh"
      onClick={() => {
        if (confirm("Xóa lệnh này? Giá vốn sẽ được tính lại.")) run(() => deleteTransaction(id));
      }}
    >
      {pending ? <Spinner /> : <TrashIcon size={16} />}
    </button>
  );
}

export function RefreshPricesButton({ compact = false }: { compact?: boolean }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionState>(null);
  return (
    <div className="relative">
      <button
        type="button"
        className={compact ? "btn-ghost size-10 min-h-10 p-0" : "btn-secondary"}
        disabled={pending}
        aria-label="Cập nhật giá"
        onClick={() =>
          start(async () => {
            setResult(await refreshPrices());
          })
        }
      >
        <RefreshIcon size={18} className={pending ? "animate-spin" : undefined} />
        {!compact && (pending ? "Đang lấy giá…" : "Cập nhật giá")}
      </button>
      {result && (
        <div
          role="status"
          className={cn(
            "absolute right-0 z-40 mt-2 w-72 rounded-xl border border-line p-3 text-sm shadow-lg",
            result.error ? "bg-down-soft text-down" : "bg-surface text-fg",
          )}
        >
          <div className="flex items-start gap-2">
            <span className="flex-1">{result.error ?? result.ok}</span>
            <button type="button" className="text-muted" onClick={() => setResult(null)} aria-label="Đóng">
              <XIcon size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
