"use client";

import {
  startTransition,
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type InputHTMLAttributes,
  type RefObject,
  type ReactNode,
} from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/app/actions";
import { todayVN } from "@/lib/format";
import { formatIntInput } from "@/lib/parse";
import { cn } from "./ui";

/**
 * Gọi server action từ onSubmit thay vì `action={}` để React không tự reset form,
 * nhờ vậy khi có lỗi người dùng không mất dữ liệu đã nhập.
 */
export function useFormAction(fn: (state: ActionState, formData: FormData) => Promise<ActionState>) {
  const [state, dispatch, pending] = useActionState(fn, null);
  const submit = (formData: FormData) => startTransition(() => dispatch(formData));
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (focusFirstInvalid(e.currentTarget)) return;
    submit(new FormData(e.currentTarget));
  };
  return [state, onSubmit, pending, submit] as const;
}

/** Theo dõi form chứa nút: còn ô nào aria-invalid="true" thì trả về true (để khóa nút gửi) */
function useFormHasInvalid(ref: RefObject<HTMLButtonElement | null>): boolean {
  const subscribe = useCallback(
    (notify: () => void) => {
      const form = ref.current?.form;
      if (!form) return () => {};
      const observer = new MutationObserver(notify);
      observer.observe(form, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-invalid"] });
      return () => observer.disconnect();
    },
    [ref],
  );
  return useSyncExternalStore(
    subscribe,
    () => Boolean(ref.current?.form?.querySelector('[aria-invalid="true"]')),
    () => false,
  );
}

export function SubmitButton({
  children,
  pendingText,
  className = "btn-primary",
  pending: pendingProp,
}: {
  children: ReactNode;
  pendingText?: string;
  className?: string;
  pending?: boolean;
}) {
  const status = useFormStatus();
  const pending = pendingProp ?? status.pending;
  const ref = useRef<HTMLButtonElement>(null);
  const invalid = useFormHasInvalid(ref);
  return (
    <button ref={ref} type="submit" className={className} disabled={pending || invalid} aria-busy={pending}>
      {pending && <Spinner />}
      {pending ? (pendingText ?? "Đang lưu…") : children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent", className)}
      aria-hidden="true"
    />
  );
}

type NumberFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "defaultValue"> & {
  value?: string;
  defaultValue?: string | number | null;
  onValueChange?: (raw: string) => void;
  suffix?: ReactNode;
};

/** Ô nhập số nguyên tự thêm dấu chấm phân cách hàng nghìn khi gõ. */
export function IntInput({ value, defaultValue, onValueChange, suffix, className, ...props }: NumberFieldProps) {
  const [inner, setInner] = useState(() =>
    defaultValue == null || defaultValue === "" ? "" : formatIntInput(String(defaultValue)),
  );
  const shown = value !== undefined ? formatIntInput(value) : inner;
  return (
    <div className="relative">
      <input
        {...props}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        className={cn("field num", suffix ? "pr-9" : undefined, className)}
        value={shown}
        onChange={(e) => {
          const formatted = formatIntInput(e.target.value);
          setInner(formatted);
          onValueChange?.(formatted.replace(/\./g, ""));
        }}
      />
      {suffix && (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted">
          {suffix}
        </span>
      )}
    </div>
  );
}

/** Ô nhập số thập phân (%), cho phép dấu phẩy. */
export function DecimalInput({
  value,
  onValueChange,
  suffix,
  prefix,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "prefix"> & {
  value?: string;
  onValueChange?: (raw: string) => void;
  suffix?: ReactNode;
  prefix?: ReactNode;
}) {
  return (
    <div className="relative">
      {prefix && (
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-base font-semibold">
          {prefix}
        </span>
      )}
      <input
        {...props}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        className={cn("field num", suffix ? "pr-9" : undefined, prefix ? "pl-7" : undefined, className)}
        value={value}
        onChange={(e) => onValueChange?.(e.target.value.replace(/[^\d,.\-+]/g, ""))}
      />
      {suffix && (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted">
          {suffix}
        </span>
      )}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  /** Lỗi của ô; ô nhập bên trong cần aria-invalid và aria-describedby={errorId(htmlFor)} */
  error?: string | null;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? <FieldError id={errorId(htmlFor)}>{error}</FieldError> : hint && <p className="hint">{hint}</p>}
    </div>
  );
}

export const errorId = (inputId?: string) => (inputId ? `${inputId}-error` : undefined);

/** Dòng lỗi ngay dưới ô nhập */
export function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="mt-1 text-xs text-down">
      {children}
    </p>
  );
}

/** Thuộc tính cho ô nhập có thể lỗi */
export const invalidProps = (inputId: string, error?: string | null) =>
  error ? { "aria-invalid": true as const, "aria-describedby": errorId(inputId) } : {};

/** Form còn ô lỗi thì không gửi, đưa focus tới ô lỗi đầu tiên */
export function focusFirstInvalid(form: HTMLFormElement): boolean {
  const invalid = form.querySelector<HTMLElement>('[aria-invalid="true"]');
  invalid?.focus();
  return invalid != null;
}

export function Segmented<T extends string>({
  name,
  value,
  onChange,
  options,
}: {
  name: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; activeClass?: string }[];
}) {
  return (
    <div role="radiogroup" className="grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-surface-2 p-1">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <label
            key={o.value}
            className={cn(
              "flex min-h-10 cursor-pointer items-center justify-center rounded-lg px-3 text-sm font-medium transition",
              active ? (o.activeClass ?? "bg-surface text-fg shadow-sm") : "text-muted hover:text-fg",
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={active}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            {o.label}
          </label>
        );
      })}
    </div>
  );
}

const noopSubscribe = () => () => {};

/** Ô chọn ngày, mặc định là hôm nay (giờ VN). Ngày được lấy ở client để trang vẫn prerender được. */
export function DateInput({ className, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "defaultValue">) {
  const today = useSyncExternalStore(noopSubscribe, todayVN, () => "");
  const [value, setValue] = useState<string | null>(null);
  return (
    <input
      {...props}
      type="date"
      className={cn("field", className)}
      value={value ?? today}
      max={today || undefined}
      onChange={(e) => setValue(e.target.value)}
    />
  );
}

/** Popup dùng thẻ <dialog> gốc: có sẵn khóa focus bên trong, đóng bằng Esc. */
export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby={open ? "modal-title" : undefined}
      className="m-auto w-[min(92vw,28rem)] rounded-2xl border border-line bg-surface p-0 text-fg shadow-2xl backdrop:bg-black/50"
    >
      {open && (
        <div className="p-5">
          <h2 id="modal-title" className="mb-3 text-lg font-semibold">
            {title}
          </h2>
          {children}
        </div>
      )}
    </dialog>
  );
}
