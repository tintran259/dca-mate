"use client";

import { useState, useTransition } from "react";
import { logout, sendTestTelegram, type ActionState } from "@/app/actions";
import { Spinner } from "./form-controls";
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
