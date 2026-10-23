"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPosition, lookupSymbolAction } from "@/app/actions";
import type { Exchange } from "@/db/schema";
import { formatMoney, formatPrice } from "@/lib/format";
import { EXCHANGES, buyFee } from "@/lib/market";
import { parseIntInput } from "@/lib/parse";
import { tradeErrors } from "@/lib/validate";
import { DateInput, Field, IntInput, Segmented, Spinner, SubmitButton, invalidProps, useFormAction } from "./form-controls";
import { PlanEditor } from "./plan-editor";
import { Notice } from "./ui";

const EXCHANGE_LABEL: Record<Exchange, string> = { HOSE: "HOSE", HNX: "HNX", UPCOM: "UPCoM" };

export function NewPositionForm() {
  const [state, onSubmit, pending] = useFormAction(createPosition);
  const [symbol, setSymbol] = useState("");
  const [exchange, setExchange] = useState<Exchange>("HOSE");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("");
  const [fee, setFee] = useState("");
  const [feeTouched, setFeeTouched] = useState(false);
  const [lookup, setLookup] = useState<{ symbol: string; price: number } | "notfound" | null>(null);
  const [looking, startLookup] = useTransition();
  const errorRef = useRef<HTMLDivElement>(null);

  const priceNum = parseIntInput(price) ?? 0;
  const qtyNum = parseIntInput(quantity) ?? 0;
  const autoFee = priceNum && qtyNum ? buyFee(priceNum, qtyNum) : 0;
  const feeValue = feeTouched ? fee : autoFee ? String(autoFee) : "";
  const total = priceNum * qtyNum + (parseIntInput(feeValue) ?? 0);
  const errors = tradeErrors({
    exchange,
    side: "buy",
    price: parseIntInput(price),
    quantity: parseIntInput(quantity),
    fee: parseIntInput(feeValue),
    tax: null,
  });

  // Lưu lỗi: đưa focus tới thông báo lỗi để người dùng thấy ngay, kể cả khi đang ở cuối trang
  useEffect(() => {
    if (state?.error) errorRef.current?.focus();
  }, [state]);

  const doLookup = () => {
    const sym = symbol.trim().toUpperCase();
    if (sym.length < 3) return;
    startLookup(async () => {
      const res = await lookupSymbolAction(sym);
      if (!res) {
        setLookup("notfound");
        return;
      }
      setExchange(res.exchange);
      setLookup({ symbol: sym, price: res.price });
      if (!price) setPrice(String(res.price));
    });
  };

  return (
    <form
      onSubmit={onSubmit}
      className="grid grid-cols-1 gap-4 pb-20 lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start lg:gap-6 lg:pb-0"
    >
      {/* ---- Cột trái: lệnh mua + nút lưu, dính khi cuộn trên desktop ---- */}
      <div className="space-y-4 lg:sticky lg:top-20">
        <section className="card space-y-4 p-4 md:p-5" aria-labelledby="buy-heading">
          <div>
            <h2 id="buy-heading" className="text-base font-semibold">
              1. Lệnh mua đầu tiên
            </h2>
            <p className="text-sm text-muted">Gõ mã, app sẽ tự nhận sàn và giá hiện tại.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Mã cổ phiếu" htmlFor="symbol" className="col-span-2">
              <div className="relative">
                <input
                  id="symbol"
                  name="symbol"
                  required
                  autoFocus
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={10}
                  placeholder="VD: HPG"
                  className="field text-lg font-semibold uppercase tracking-wide"
                  value={symbol}
                  onChange={(e) => {
                    setSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""));
                    setLookup(null);
                  }}
                  onBlur={doLookup}
                />
                {looking && <Spinner className="absolute top-3.5 right-3 text-muted" />}
              </div>
              {lookup === "notfound" ? (
                <p className="hint text-warn">Không tra được mã này. Bạn vẫn có thể nhập tay.</p>
              ) : lookup ? (
                <p className="hint">
                  Giá hiện tại: <b className="num text-fg">{formatPrice(lookup.price)}</b>
                  {price !== String(lookup.price) && (
                    <button
                      type="button"
                      className="ml-2 font-medium text-primary underline"
                      onClick={() => setPrice(String(lookup.price))}
                    >
                      Dùng giá này
                    </button>
                  )}
                </p>
              ) : null}
            </Field>

            <Field label="Sàn" className="col-span-2">
              <Segmented
                name="exchange"
                value={exchange}
                onChange={setExchange}
                options={EXCHANGES.map((e) => ({ value: e, label: EXCHANGE_LABEL[e] }))}
              />
            </Field>

            <Field label="Giá khớp" htmlFor="price" error={errors.price}>
              <IntInput
                id="price"
                name="price"
                required
                value={price}
                onValueChange={setPrice}
                placeholder="25.000"
                suffix="đ"
                {...invalidProps("price", errors.price)}
              />
            </Field>

            <Field label="Khối lượng" htmlFor="quantity" error={errors.quantity}>
              <IntInput
                id="quantity"
                name="quantity"
                required
                value={quantity}
                onValueChange={setQuantity}
                placeholder="1.000"
                suffix="cp"
                {...invalidProps("quantity", errors.quantity)}
              />
            </Field>

            <Field label="Ngày mua" htmlFor="tradeDate">
              <DateInput id="tradeDate" name="tradeDate" required />
            </Field>

            <Field label="Phí" htmlFor="fee" error={errors.fee}>
              <IntInput
                id="fee"
                name="fee"
                value={feeValue}
                onValueChange={(v) => {
                  setFeeTouched(true);
                  setFee(v);
                }}
                placeholder="0"
                suffix="đ"
                {...invalidProps("fee", errors.fee)}
              />
            </Field>
            <p className="hint col-span-2 -mt-1">
              Giá theo đồng (VD 25.000). Phí {feeTouched ? "đã nhập tay" : "tự tính 0,15% giá trị lệnh, có thể sửa"}.
            </p>
          </div>

          {total > 0 && (
            <div className="flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2.5 text-sm">
              <span className="text-muted">Tổng tiền mua</span>
              <span className="num font-semibold">{formatMoney(total)}</span>
            </div>
          )}

          <Field label="Lý do mua / luận điểm đầu tư" htmlFor="thesis" hint="Đọc lại khi giá biến động để giữ kỷ luật.">
            <textarea
              id="thesis"
              name="thesis"
              rows={3}
              className="field resize-y"
              placeholder="VD: Giá thép hồi phục, KQKD Q3 tăng trưởng, vùng hỗ trợ 24–25k…"
            />
          </Field>
          <input type="hidden" name="tax" value="0" />
        </section>

        {state?.error && (
          <div ref={errorRef} tabIndex={-1} className="outline-none">
            <Notice tone="error">{state.error}</Notice>
          </div>
        )}

        {/* Nút lưu: dính đáy trên điện thoại/tablet, nằm trong cột trái trên desktop */}
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur md:bottom-0 lg:static lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
          <SubmitButton className="btn-primary w-full" pending={pending} pendingText="Đang tạo…">
            Lưu vị thế
          </SubmitButton>
        </div>
      </div>

      {/* ---- Cột phải: kế hoạch ---- */}
      <section className="card p-4 md:p-5" aria-labelledby="plan-heading">
        <div className="mb-4">
          <h2 id="plan-heading" className="text-base font-semibold">
            2. Kế hoạch DCA và chốt lời
          </h2>
          <p className="text-sm text-muted">Lên kế hoạch lúc còn tỉnh táo. App sẽ nhắc bạn khi giá chạm từng nấc.</p>
        </div>
        <PlanEditor
          exchange={exchange}
          firstPrice={priceNum || null}
          quantity={qtyNum}
          avgCost={qtyNum ? total / qtyNum : null}
          totalCost={total || null}
          initial={{ levels: [] }}
        />
      </section>
    </form>
  );
}
