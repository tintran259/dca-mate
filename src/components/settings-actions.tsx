"use client";

import { useState, useTransition } from "react";
import { logout, saveFeeSettings, sendTestTelegram, type ActionState } from "@/app/actions";
import { feePctError, type FeeRates } from "@/lib/market";
import { parseDecimalInput, parseIntInput } from "@/lib/parse";
import { DecimalInput, Field, IntInput, Spinner, SubmitButton, useFormAction } from "./form-controls";
import { LogoutIcon, SendIcon } from "./icons";
import { Notice } from "./ui";

export function TestTelegramButton({ disabled }: { disabled?: boolean }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionState>(null);
  return (
    <div className="space-y-2">
      <button
        type="button"
        className="btn-secondary"
        disabled={disabled || pending}
        onClick={() => start(async () => setResult(await sendTestTelegram()))}
      >
        {pending ? <Spinner /> : <SendIcon size={16} />} Gửi tin nhắn thử
      </button>
      {result && <Notice tone={result.error ? "error" : "ok"}>{result.error ?? result.ok}</Notice>}
    </div>
  );
}

export function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <input readOnly value={value} className="field num min-w-0 flex-1 text-sm" onFocus={(e) => e.currentTarget.select()} />
      <button
        type="button"
        className="btn-secondary shrink-0"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "Đã chép" : "Chép"}
      </button>
    </div>
  );
}

export function LogoutButton() {
  return (
    <form action={logout}>
      <button type="submit" className="btn-secondary">
        <LogoutIcon size={16} /> Đăng xuất
      </button>
    </form>
  );
}

const pctFormat = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 3 });
/** 0.0015 → "0,15" (giá trị cho ô nhập %) */
const toPctInput = (rate: number) => pctFormat.format(rate * 100);

/** % phí mua/bán của công ty chứng khoán, kèm ô tính % từ một lệnh đã khớp trên sao kê */
export function FeeSettingsForm({ fees }: { fees: FeeRates }) {
  const [state, onSubmit, pending] = useFormAction(saveFeeSettings);
  const [buy, setBuy] = useState(toPctInput(fees.buy));
  const [sell, setSell] = useState(toPctInput(fees.sell));
  const buyError = feePctError(parseDecimalInput(buy));
  const sellError = feePctError(parseDecimalInput(sell));

  // Tính % từ lệnh đã khớp: phí ÷ giá trị lệnh
  const [orderValue, setOrderValue] = useState("");
  const [orderFee, setOrderFee] = useState("");
  const value = parseIntInput(orderValue) ?? 0;
  const fee = parseIntInput(orderFee) ?? 0;
  const derived = value > 0 && fee >= 0 && orderFee !== "" ? (fee / value) * 100 : null;
  const derivedText = derived != null ? pctFormat.format(derived) : null;

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phí mua" htmlFor="buyFee" error={buy ? buyError : null}>
            <DecimalInput
              id="buyFee"
              name="buyFee"
              value={buy}
              onValueChange={setBuy}
              suffix="%"
              aria-invalid={Boolean(buy && buyError) || undefined}
            />
          </Field>
          <Field label="Phí bán" htmlFor="sellFee" error={sell ? sellError : null}>
            <DecimalInput
              id="sellFee"
              name="sellFee"
              value={sell}
              onValueChange={setSell}
              suffix="%"
              aria-invalid={Boolean(sell && sellError) || undefined}
            />
          </Field>
        </div>
        <p className="hint">Thuế bán {pctFormat.format(fees.tax * 100)}% theo luật, app tự tính.</p>
        {state && <Notice tone={state.error ? "error" : "ok"}>{state.error ?? state.ok}</Notice>}
        <SubmitButton pending={pending} className="btn-primary">
          Lưu phí
        </SubmitButton>
      </form>

      <details className="rounded-xl bg-surface-2 p-3">
        <summary className="cursor-pointer text-sm font-medium">Không biết % phí? Tính từ một lệnh đã khớp</summary>
        <p className="hint mb-3">Mở sổ lệnh trên app VPS, chọn một lệnh đã khớp, nhập giá trị khớp và số phí của lệnh đó.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Giá trị khớp" htmlFor="orderValue">
            <IntInput id="orderValue" value={orderValue} onValueChange={setOrderValue} placeholder="30.950.000" suffix="đ" />
          </Field>
          <Field label="Phí của lệnh" htmlFor="orderFee">
            <IntInput id="orderFee" value={orderFee} onValueChange={setOrderFee} placeholder="46.425" suffix="đ" />
          </Field>
        </div>
        {derivedText && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span>
              Tỷ lệ phí: <b className="num">{derivedText}%</b>
            </span>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setBuy(derivedText)}>
              Dùng cho phí mua
            </button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setSell(derivedText)}>
              Dùng cho phí bán
            </button>
          </div>
        )}
      </details>
    </div>
  );
}
