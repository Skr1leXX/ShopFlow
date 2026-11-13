"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/** Модальное подтверждение на нативном <dialog>: фокус удерживается внутри, Esc отменяет, есть роли для скринридеров. */
export function useConfirm() {
  const ref = useRef<HTMLDialogElement>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);
  const [text, setText] = useState("");

  const confirm = (message: string) =>
    new Promise<boolean>((resolve) => {
      setText(message);
      resolver.current = resolve;
      ref.current?.showModal();
    });
  const close = (value: boolean) => {
    ref.current?.close();
    resolver.current?.(value);
    resolver.current = null;
  };

  const dialog = (
    <dialog
      ref={ref}
      aria-labelledby="confirm-title"
      onCancel={(e) => { e.preventDefault(); close(false); }}
      onClick={(e) => { if (e.target === ref.current) close(false); }}
      className="m-auto w-[min(92vw,26rem)] rounded-3xl border bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/50"
    >
      <div className="p-6">
        <h2 id="confirm-title" className="text-2xl font-semibold">Подтвердите действие</h2>
        <p className="mt-2 text-sm text-muted-foreground">{text}</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => close(false)}>Отмена</Button>
          <Button type="button" autoFocus onClick={() => close(true)}>Подтвердить</Button>
        </div>
      </div>
    </dialog>
  );
  return { confirm, dialog };
}
