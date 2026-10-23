"use client";

import { use } from "react";
import { login } from "@/app/actions";
import { SubmitButton, useFormAction } from "@/components/form-controls";
import { Notice } from "@/components/ui";

export function LoginForm({ nextPromise }: { nextPromise: Promise<string> }) {
  const next = use(nextPromise);
  const [state, onSubmit, pending] = useFormAction(login);
  return (
    <form onSubmit={onSubmit} className="card space-y-4 p-5">
      <input type="hidden" name="next" value={next} />
      <div>
        <label htmlFor="password" className="label">
          Mật khẩu
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoFocus
          autoComplete="current-password"
          className="field"
        />
      </div>
      {state?.error && <Notice tone="error">{state.error}</Notice>}
      <SubmitButton pending={pending} className="btn-primary w-full" pendingText="Đang đăng nhập…">
        Đăng nhập
      </SubmitButton>
    </form>
  );
}
