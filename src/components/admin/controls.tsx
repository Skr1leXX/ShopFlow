"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, RefreshCw, Trash2 } from "lucide-react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { useServerAction } from "@/components/common/form";
import { useConfirm } from "@/components/common/confirm";
import {
  deleteCategory, deleteProduct, deleteProductImage, deletePromo, deleteVariant, replaceProductImage,
  setOrderStatus, setPromoActive, setStock, setUserRole, uploadProductImage,
} from "@/lib/actions/admin";
import { ORDER_STATUS } from "@/lib/format";
import type { ActionResult } from "@/lib/actions/shop";
import type { ProductImage } from "@/lib/data/types";

/** Запускает действие, обновляет страницу и показывает ошибку рядом с кнопкой. */
function useRun() {
  const router = useRouter();
  const { pending, run } = useServerAction();
  const [error, setError] = useState<string | null>(null);
  const exec = (fn: () => Promise<ActionResult>, after?: () => void) =>
    run(fn, (r) => {
      setError(r.ok ? null : r.error);
      if (r.ok) { router.refresh(); after?.(); }
    });
  return { pending, error, exec };
}

const Err = ({ text }: { text: string | null }) => (text ? <p role="alert" className="mt-1 text-xs text-destructive">{text}</p> : null);

export function ConfirmButton({
  action, label, confirmText, redirectTo, icon = true, ariaLabel,
}: { action: () => Promise<ActionResult>; label: string; confirmText: string; redirectTo?: string; icon?: boolean; ariaLabel?: string }) {
  const router = useRouter();
  const { pending, error, exec } = useRun();
  const { confirm, dialog } = useConfirm();
  return (
    <div>
      <Button type="button" variant="destructive" size="sm" disabled={pending} aria-label={ariaLabel ?? (label || "Удалить")}
        onClick={async () => { if (await confirm(confirmText)) exec(action, () => redirectTo && router.push(redirectTo)); }}>
        {icon && <Trash2 />} {label}
      </Button>
      {dialog}
      <Err text={error} />
    </div>
  );
}

export const DeleteProductButton = ({ id }: { id: string }) => (
  <ConfirmButton action={() => deleteProduct(id)} label="Удалить" confirmText="Удалить товар вместе с фото и вариантами? Действие необратимо." redirectTo="/admin/products" />
);
export const DeleteCategoryButton = ({ id }: { id: string }) => (
  <ConfirmButton action={() => deleteCategory(id)} label="Удалить" confirmText="Удалить категорию?" />
);
export const DeletePromoButton = ({ id }: { id: string }) => (
  <ConfirmButton action={() => deletePromo(id)} label="Удалить" confirmText="Удалить промокод?" />
);
export const DeleteVariantButton = ({ id }: { id: string }) => (
  <ConfirmButton action={() => deleteVariant(id)} label="" ariaLabel="Удалить вариант" icon confirmText="Удалить вариант и его остаток?" />
);

export function OrderStatusSelect({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const { pending, run } = useServerAction();
  const [error, setErr] = useState<string | null>(null);
  return (
    <div>
      <select aria-label="Статус заказа" defaultValue={status} disabled={pending}
        onChange={(e) => {
          const el = e.currentTarget;
          const next = el.value;
          run(() => setOrderStatus(id, next), (r) => {
            setErr(r.ok ? null : r.error);
            if (!r.ok) el.value = status; // откат выбора, если сервер отказал
            router.refresh();
          });
        }} className="h-9 rounded-full border bg-background px-3 text-sm">
        {Object.entries(ORDER_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <Err text={error} />
    </div>
  );
}

export function StockInput({ variantId, quantity }: { variantId: string; quantity: number }) {
  const [value, setValue] = useState(String(quantity));
  const { pending, error, exec } = useRun();
  const dirty = value !== String(quantity);
  return (
    <form onSubmit={(e) => { e.preventDefault(); exec(() => setStock(variantId, Number(value))); }} className="flex items-center gap-2">
      <input type="number" min={0} max={100000} value={value} onChange={(e) => setValue(e.target.value)} aria-label="Остаток"
        className="h-9 w-24 rounded-lg border px-3 text-sm" />
      <Button type="submit" size="sm" variant={dirty ? "default" : "outline"} disabled={pending || !dirty}>Сохранить</Button>
      <Err text={error} />
    </form>
  );
}

export function PromoToggle({ id, active }: { id: string; active: boolean }) {
  const { pending, error, exec } = useRun();
  return (
    <div>
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => exec(() => setPromoActive(id, !active))}>
        {active ? "Отключить" : "Включить"}
      </Button>
      <Err text={error} />
    </div>
  );
}

export function RoleSelect({ id, role, self }: { id: string; role: "customer" | "admin"; self: boolean }) {
  const { pending, error, exec } = useRun();
  const { confirm, dialog } = useConfirm();
  return (
    <div>
      {dialog}
      <select aria-label="Роль" defaultValue={role} disabled={pending || self} title={self ? "Свою роль менять нельзя" : undefined}
        onChange={async (e) => {
          const el = e.currentTarget;
          const next = el.value as "customer" | "admin";
          if (await confirm("Изменить роль пользователя?")) exec(() => setUserRole(id, next));
          else el.value = role;
        }}
        className="h-9 rounded-full border bg-background px-3 text-sm disabled:opacity-60">
        <option value="customer">Покупатель</option>
        <option value="admin">Администратор</option>
      </select>
      <Err text={error} />
    </div>
  );
}

/** Загрузка, замена и удаление фото товара (Vercel Blob). */
export function ProductImages({ productId, images }: { productId: string; images: ProductImage[] }) {
  const { pending, error, exec } = useRun();
  const { confirm, dialog } = useConfirm();
  const send = (fn: (f: FormData) => Promise<ActionResult>, input: HTMLInputElement) => {
    const file = input.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.set("file", file);
    exec(() => fn(form), () => { input.value = ""; });
  };
  return (
    <div>
      {dialog}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {images.map((img) => (
          <div key={img.id} className="space-y-2">
            <div className="relative aspect-[4/5] overflow-hidden rounded-xl bg-muted">
              <Image src={img.url} alt={img.alt} fill sizes="200px" className="object-cover" />
              {!img.storage_path && <span className="absolute left-2 top-2 rounded bg-background/90 px-1.5 py-0.5 text-[10px]">внешний URL</span>}
            </div>
            <div className="flex gap-2">
              <label className="inline-flex h-8 flex-1 cursor-pointer items-center justify-center gap-1 rounded-full border text-xs hover:bg-muted">
                <RefreshCw className="size-3" /> Заменить
                <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="sr-only" disabled={pending}
                  onChange={(e) => send((f) => replaceProductImage(img.id, f), e.currentTarget)} />
              </label>
              <button type="button" aria-label="Удалить фото" disabled={pending}
                onClick={async () => { if (await confirm("Удалить фото?")) exec(() => deleteProductImage(img.id)); }}
                className="grid size-8 place-items-center rounded-full border text-destructive hover:bg-destructive/10"><Trash2 className="size-3.5" /></button>
            </div>
          </div>
        ))}
        <label className="flex aspect-[4/5] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed text-sm text-muted-foreground transition-colors hover:bg-muted">
          <ImagePlus className="size-6" /> {pending ? "Загрузка…" : "Добавить фото"}
          <span className="text-xs">JPG, PNG, WebP, до 5 МБ</span>
          <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="sr-only" disabled={pending}
            onChange={(e) => send((f) => uploadProductImage(productId, f), e.currentTarget)} />
        </label>
      </div>
      <Err text={error} />
    </div>
  );
}
