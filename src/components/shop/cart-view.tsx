"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Minus, Plus, Tag, Trash2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { quoteOrder, removeCartItem, setCartQuantity, type Quote } from "@/lib/actions/shop";
import { removeGuestItem, setGuestQuantity } from "@/lib/guest-cart";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CartLine } from "@/lib/data/types";

export function CartView({ lines, guest = false }: { lines: CartLine[]; guest?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [promo, setPromo] = useState("");
  const [applied, setApplied] = useState<{ code: string; quote: Quote } | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);

  const subtotal = lines.reduce((s, l) => s + l.variant.products.price * l.quantity, 0);
  const stockOf = (l: CartLine) => l.variant.inventory?.quantity ?? 0;
  const blocked = lines.some((l) => stockOf(l) < l.quantity);

  const setQty = (l: CartLine, qty: number) => {
    if (guest) return setGuestQuantity(l.id, qty);
    act(() => setCartQuantity(l.id, qty));
  };
  const remove = (l: CartLine) => {
    if (guest) return removeGuestItem(l.id);
    act(() => removeCartItem(l.id));
  };

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn().catch(() => ({ ok: false, error: "Нет соединения с сервером. Проверьте интернет и повторите." }));
      setError(r.ok ? null : r.error ?? "Ошибка");
      setApplied(null); // сумма изменилась — промокод нужно проверить заново
      router.refresh();
    });

  const applyPromo = () =>
    start(async () => {
      setPromoError(null);
      const r = await quoteOrder(promo, "pickup").catch(() => null);
      if (!r) return setPromoError("Нет соединения с сервером. Проверьте интернет и повторите.");
      if (!r.ok) return setPromoError(r.error);
      if (r.quote.discount === 0) return setPromoError("Введите промокод");
      setApplied({ code: promo.trim().toUpperCase(), quote: r.quote });
    });

  const discount = applied?.quote.discount ?? 0;

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_380px]">
      <ul className={cn("divide-y border-y transition-opacity", pending && "opacity-60")}>
        {lines.map((l) => {
          const p = l.variant.products;
          const stock = stockOf(l);
          return (
            <li key={l.id} className="flex gap-4 py-6">
              <Link href={`/product/${p.slug}`} tabIndex={-1} aria-hidden className="relative aspect-[4/5] w-24 shrink-0 overflow-hidden rounded-xl bg-muted sm:w-28">
                {p.product_images[0] && <Image src={p.product_images[0].url} alt="" fill sizes="112px" className="object-cover" />}
              </Link>
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/product/${p.slug}`} className="font-medium hover:underline">{p.name}</Link>
                    <p className="mt-1 text-sm text-muted-foreground">{l.variant.color} · {l.variant.size}</p>
                  </div>
                  <p className="shrink-0 font-semibold">{formatPrice(p.price * l.quantity)}</p>
                </div>
                {stock < l.quantity && (
                  <p className="mt-1 text-sm text-destructive">{stock === 0 ? "Нет в наличии" : `Доступно только ${stock} шт.`}</p>
                )}
                <div className="mt-auto flex items-center justify-between pt-4">
                  <div className="flex h-10 items-center rounded-full border">
                    <button type="button" aria-label="Меньше" disabled={pending || l.quantity <= 1} onClick={() => setQty(l, l.quantity - 1)} className="grid size-10 place-items-center disabled:opacity-30"><Minus className="size-4" /></button>
                    <span className="w-8 text-center text-sm">{l.quantity}</span>
                    <button type="button" aria-label="Больше" disabled={pending || l.quantity >= Math.min(stock, 99)} onClick={() => setQty(l, l.quantity + 1)} className="grid size-10 place-items-center disabled:opacity-30"><Plus className="size-4" /></button>
                  </div>
                  <button type="button" disabled={pending} onClick={() => remove(l)} className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-destructive">
                    <Trash2 className="size-4" /> Удалить
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <aside className="h-fit rounded-3xl bg-muted/60 p-6 lg:sticky lg:top-24">
        <h2 className="text-3xl font-semibold">Ваш заказ</h2>

        {guest ? (
          <p className="mt-5 rounded-xl bg-background px-4 py-3 text-sm text-muted-foreground">Войдите, чтобы применить промокод и оформить заказ. Корзина сохранится.</p>
        ) : (
        <form onSubmit={(e) => { e.preventDefault(); applyPromo(); }} className="mt-5">
          <label htmlFor="promo" className="mb-2 flex items-center gap-1.5 text-sm font-medium"><Tag className="size-4" /> Промокод</label>
          <div className="flex gap-2">
            <input id="promo" value={promo} onChange={(e) => setPromo(e.target.value)} placeholder="Введите код" maxLength={32}
              className="h-10 min-w-0 flex-1 rounded-full border bg-background px-4 text-sm uppercase" />
            <Button type="submit" variant="outline" disabled={pending || !promo.trim()}>Применить</Button>
          </div>
          {promoError && <p role="alert" className="mt-2 text-sm text-destructive">{promoError}</p>}
          {applied && <p role="status" className="mt-2 text-sm text-success">Промокод {applied.code} применён</p>}
        </form>
        )}

        <dl className="mt-6 space-y-3 border-t pt-6 text-sm">
          <div className="flex justify-between"><dt className="text-muted-foreground">Товары</dt><dd>{formatPrice(subtotal)}</dd></div>
          {discount > 0 && <div className="flex justify-between text-success"><dt>Скидка</dt><dd>−{formatPrice(discount)}</dd></div>}
          <div className="flex justify-between"><dt className="text-muted-foreground">Доставка</dt><dd className="text-muted-foreground">на следующем шаге</dd></div>
          <div className="flex justify-between border-t pt-4 text-base font-semibold"><dt>Итого</dt><dd>{formatPrice(subtotal - discount)}</dd></div>
        </dl>

        {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
        {blocked ? (
          <p className="mt-6 text-sm text-destructive">Уменьшите количество или удалите недоступные товары, чтобы оформить заказ.</p>
        ) : (
          <Link
            href={guest ? "/login?next=/checkout" : applied ? `/checkout?promo=${encodeURIComponent(applied.code)}` : "/checkout"}
            className={cn(buttonVariants({ size: "lg" }), "mt-6 w-full")}
          >
            {guest ? "Войти и оформить заказ" : "Оформить заказ"}
          </Link>
        )}
      </aside>
    </div>
  );
}
