"use client";

import { useMemo, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Check, Minus, Plus, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addToCart } from "@/lib/actions/shop";
import { addGuestItem } from "@/lib/guest-cart";
import { cn } from "@/lib/utils";
import type { Variant } from "@/lib/data/types";

const stockOf = (v: Variant) => (v.is_active ? v.inventory?.quantity ?? 0 : 0);

export function ProductPurchase({ variants, loggedIn }: { variants: Variant[]; loggedIn: boolean }) {
  const path = usePathname();
  const colors = useMemo(() => [...new Map(variants.map((v) => [v.color, v.color_hex]))].map(([name, hex]) => ({ name, hex })), [variants]);
  const sizes = useMemo(() => [...new Set(variants.map((v) => v.size))], [variants]);
  const [color, setColor] = useState(colors[0]?.name ?? "");
  const [size, setSize] = useState(sizes.length === 1 ? sizes[0] : "");
  const [qty, setQty] = useState(1);
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const variant = variants.find((v) => v.color === color && v.size === size);
  const stock = variant ? stockOf(variant) : 0;
  const inStock = (s: string) => variants.some((v) => v.size === s && v.color === color && stockOf(v) > 0);

  const submit = () => {
    if (!variant) return setNote({ ok: false, text: "Выберите размер" });
    setNote(null);
    if (!loggedIn) {
      // Гость: корзина хранится в браузере и объединится с серверной при входе. Остаток проверится на сервере.
      const total = addGuestItem(variant.id, qty, stock);
      return setNote({ ok: true, text: total < qty ? `Добавлено максимум: ${total} шт.` : "Товар добавлен в корзину" });
    }
    start(async () => {
      const res = await addToCart(variant.id, qty, path).catch(() => ({ ok: false as const, error: "Нет соединения с сервером. Проверьте интернет и повторите." }));
      setNote(res.ok ? { ok: true, text: res.message ?? "Добавлено" } : { ok: false, text: res.error });
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-3 text-sm"><span className="text-muted-foreground">Цвет:</span> <span className="font-medium">{color}</span></p>
        <div className="flex flex-wrap gap-3">
          {colors.map((c) => (
            <button key={c.name} type="button" title={c.name} aria-label={c.name} aria-pressed={c.name === color}
              onClick={() => { setColor(c.name); setQty(1); setNote(null); }}
              className={cn("size-9 rounded-full border-2 border-border ring-offset-2 transition", c.name === color && "ring-2 ring-foreground")}
              style={{ backgroundColor: c.hex }} />
          ))}
        </div>
      </div>

      {!(sizes.length === 1 && sizes[0] === "Один размер") && (
        <div>
          <p className="mb-3 text-sm"><span className="text-muted-foreground">Размер:</span> <span className="font-medium">{size || "не выбран"}</span></p>
          <div className="flex flex-wrap gap-2">
            {sizes.map((s) => (
              <button key={s} type="button" disabled={!inStock(s)} aria-pressed={s === size}
                onClick={() => { setSize(s); setQty(1); setNote(null); }}
                className={cn("h-11 min-w-12 rounded-xl border px-3 text-sm transition-colors enabled:hover:border-foreground disabled:text-muted-foreground/50 disabled:line-through",
                  s === size && "border-primary bg-primary text-primary-foreground enabled:hover:border-primary")}>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <p className={cn("text-sm", !variant ? "text-muted-foreground" : stock > 0 ? "text-success" : "text-destructive")}>
        {!variant ? "Выберите размер, чтобы увидеть наличие" : stock === 0 ? "Нет в наличии" : stock <= 3 ? `Осталось ${stock} шт.` : "В наличии"}
      </p>

      <div className="flex gap-3">
        <div className="flex h-12 items-center rounded-full border">
          <button type="button" aria-label="Меньше" disabled={qty <= 1} onClick={() => setQty(qty - 1)} className="grid size-12 place-items-center disabled:opacity-30"><Minus className="size-4" /></button>
          <span className="w-8 text-center text-sm font-medium" aria-live="polite">{qty}</span>
          <button type="button" aria-label="Больше" disabled={!variant || qty >= Math.min(stock, 99)} onClick={() => setQty(qty + 1)} className="grid size-12 place-items-center disabled:opacity-30"><Plus className="size-4" /></button>
        </div>
        <Button size="lg" className="h-12 flex-1" disabled={pending || (!!variant && stock === 0)} onClick={submit}>
          <ShoppingBag className="size-4" /> {pending ? "Добавляем…" : "В корзину"}
        </Button>
      </div>

      {note && (
        <p role="status" className={cn("flex items-center gap-2 text-sm", note.ok ? "text-success" : "text-destructive")}>
          {note.ok && <Check className="size-4" />} {note.text}
          {note.ok && <Link href="/cart" className="ml-1 font-medium underline">Открыть корзину</Link>}
        </p>
      )}
    </div>
  );
}
