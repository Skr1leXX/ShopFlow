"use client";

import { useActionState, useTransition, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { FormState } from "@/lib/actions/auth";
import type { ActionResult } from "@/lib/actions/shop";

export function FormNotice({ state }: { state: FormState }) {
  if (!state?.error && !state?.message) return null;
  return (
    <p
      role={state.error ? "alert" : "status"}
      className={cn("rounded-lg px-3 py-2 text-sm", state.error ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success")}
    >
      {state.error ?? state.message}
    </p>
  );
}

/** Форма с серверным действием: ошибка/успех показываются под полями, кнопка блокируется на время отправки. */
export function ActionForm({
  action, submit, children, className, resetOnSuccess,
}: {
  action: (s: FormState, f: FormData) => Promise<FormState>;
  submit: string;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState(async (s: FormState, f: FormData) => {
    try {
      const res = await action(s, f);
      return res ? { ...res } : res;
    } catch {
      return { error: "Нет соединения с сервером. Проверьте интернет и повторите." };
    }
  }, undefined);
  return (
    <form
      action={formAction}
      className={cn("space-y-4", className)}
      ref={(el) => { if (el && resetOnSuccess && state?.message) el.reset(); }}
    >
      {children}
      <FormNotice state={state} />
      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending && <Loader2 className="size-4 animate-spin" />} {submit}
      </Button>
    </form>
  );
}

/** Кнопка, вызывающая серверное действие вне формы. onDone получает результат (для сообщений). */
export function useServerAction() {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult>, onDone?: (r: ActionResult) => void) =>
    start(async () => {
      try {
        onDone?.(await fn());
      } catch {
        onDone?.({ ok: false, error: "Нет соединения с сервером. Проверьте интернет и повторите." });
      }
    });
  return { pending, run };
}
