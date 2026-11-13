"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ArrowDown, ArrowUp, ImagePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useServerAction } from "@/components/common/form";
import { useConfirm } from "@/components/common/confirm";
import { moveCategory, removeCategoryImage, setProductActive, setVariantActive, uploadCategoryImage } from "@/lib/actions/admin";
import type { ActionResult } from "@/lib/actions/shop";

function useRun() {
  const router = useRouter();
  const { pending, run } = useServerAction();
  const [error, setError] = useState<string | null>(null);
  const exec = (fn: () => Promise<ActionResult>) =>
    run(fn, (r) => {
      setError(r.ok ? null : r.error);
      if (r.ok) router.refresh();
    });
  return { pending, error, exec };
}
const Err = ({ text }: { text: string | null }) => (text ? <p role="alert" className="mt-1 text-xs text-destructive">{text}</p> : null);

export function ProductActiveToggle({ id, active }: { id: string; active: boolean }) {
  const { pending, error, exec } = useRun();
  return (
    <div>
      <button type="button" role="switch" aria-checked={active} aria-label={active ? "Скрыть товар" : "Показать товар"} disabled={pending}
        onClick={() => exec(() => setProductActive(id, !active))}
        className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-50 ${active ? "bg-success" : "bg-input"}`}>
        <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${active ? "left-[22px]" : "left-0.5"}`} />
      </button>
      <Err text={error} />
    </div>
  );
}

export function VariantActiveToggle({ id, active }: { id: string; active: boolean }) {
  const { pending, error, exec } = useRun();
  return (
    <div>
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => exec(() => setVariantActive(id, !active))}>
        {active ? "Скрыть" : "Показать"}
      </Button>
      <Err text={error} />
    </div>
  );
}

export function CategoryOrder({ id, first, last }: { id: string; first: boolean; last: boolean }) {
  const { pending, error, exec } = useRun();
  return (
    <div className="flex flex-col items-center">
      <div className="flex">
        <button type="button" aria-label="Выше" disabled={pending || first} onClick={() => exec(() => moveCategory(id, "up"))} className="grid size-8 place-items-center rounded-full hover:bg-accent disabled:opacity-30"><ArrowUp className="size-4" /></button>
        <button type="button" aria-label="Ниже" disabled={pending || last} onClick={() => exec(() => moveCategory(id, "down"))} className="grid size-8 place-items-center rounded-full hover:bg-accent disabled:opacity-30"><ArrowDown className="size-4" /></button>
      </div>
      <Err text={error} />
    </div>
  );
}

export function CategoryImage({ id, url, name }: { id: string; url: string | null; name: string }) {
  const { pending, error, exec } = useRun();
  const { confirm, dialog } = useConfirm();
  return (
    <div>
      {dialog}
      <div className="flex items-center gap-3">
        <div className="relative size-20 shrink-0 overflow-hidden rounded-xl bg-muted">
          {url && <Image src={url} alt={name} fill sizes="80px" className="object-cover" />}
        </div>
        <div className="flex flex-col gap-2">
          <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-xs hover:bg-muted">
            <ImagePlus className="size-3.5" /> {pending ? "Загрузка…" : url ? "Заменить" : "Загрузить"}
            <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="sr-only" disabled={pending}
              onChange={(e) => {
                const input = e.currentTarget;
                const file = input.files?.[0];
                if (!file) return;
                const form = new FormData();
                form.set("file", file);
                exec(async () => { const r = await uploadCategoryImage(id, form); input.value = ""; return r; });
              }} />
          </label>
          {url && (
            <button type="button" disabled={pending} onClick={async () => { if (await confirm("Убрать изображение категории?")) exec(() => removeCategoryImage(id)); }}
              className="flex items-center gap-1 text-xs text-destructive"><X className="size-3" /> Убрать</button>
          )}
        </div>
      </div>
      <Err text={error} />
    </div>
  );
}
