"use client";

import { useActionState, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { FormNotice } from "@/components/common/form";
import { placeOrder, quoteOrder, type Quote } from "@/lib/actions/shop";
import { DELIVERY, PAYMENT, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Address, CartLine } from "@/lib/data/types";

const DELIVERY_HINT: Record<string, string> = {
  courier: "490 ₽, бесплатно от 15 000 ₽",
  post: "290 ₽, бесплатно от 15 000 ₽",
  pickup: "Бесплатно",
};
const field = "h-11 w-full rounded-xl border bg-background px-4 text-sm outline-none transition focus:border-foreground/40";

function Choice({ name, value, checked, onChange, title, hint }: {
  name: string; value: string; checked: boolean; onChange: () => void; title: string; hint?: string;
}) {
  return (
    <label className={cn("flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm transition-colors", checked && "border-foreground bg-accent/50")}>
      <span className="flex items-center gap-3">
        <input type="radio" name={name} value={value} checked={checked} onChange={onChange} className="accent-black" />
        <span className="font-medium">{title}</span>
      </span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function CheckoutForm({
  lines, addresses, defaults, promo,
}: { lines: CartLine[]; addresses: Address[]; defaults: { name: string; email: string; phone: string }; promo: string }) {
  const [state, action, pending] = useActionState(async (s: Parameters<typeof placeOrder>[0], f: FormData) => {
    try {
      const r = await placeOrder(s, f);
      return r ? { ...r } : r;
    } catch {
      // Заказ мог создаться до обрыва: повтор с тем же ключом вернёт его, а не создаст второй.
      return { error: "Нет соединения с сервером. Проверьте интернет и повторите." };
    }
  }, undefined);
  // Один ключ на форму: повторная отправка (двойной клик, повтор после обрыва) не создаст второй заказ.
  const [key] = useState(() => crypto.randomUUID());
  const [delivery, setDelivery] = useState("courier");
  const [payment, setPayment] = useState("card");
  const [addr, setAddr] = useState<Address | undefined>(addresses.find((a) => a.is_default) ?? addresses[0]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  // Итог всегда считает сервер: тот же расчёт использует place_order.
  useEffect(() => {
    let cancelled = false;
    quoteOrder(promo, delivery)
      .then((r) => {
        if (cancelled) return;
        setQuote(r.ok ? r.quote : null);
        setQuoteError(r.ok ? null : r.error);
      })
      .catch(() => {
        if (cancelled) return;
        setQuote(null);
        setQuoteError("Нет соединения с сервером. Проверьте интернет и повторите.");
      });
    return () => { cancelled = true; };
  }, [delivery, promo]);

  return (
    <form action={action} className="grid gap-10 lg:grid-cols-[1fr_400px]">
      <input type="hidden" name="promo" value={promo} />
      <input type="hidden" name="key" value={key} />
      <div className="space-y-10">
        <fieldset className="space-y-4">
          <legend className="mb-4 text-3xl font-semibold">Контактные данные</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <input name="name" required defaultValue={defaults.name} placeholder="Имя и фамилия" aria-label="Имя и фамилия" autoComplete="name" className={cn(field, "sm:col-span-2")} />
            <input name="email" type="email" required defaultValue={defaults.email} placeholder="Email" aria-label="Email" autoComplete="email" className={field} />
            <input name="phone" type="tel" required defaultValue={defaults.phone} placeholder="Телефон" aria-label="Телефон" autoComplete="tel" className={field} />
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="mb-4 text-3xl font-semibold">Способ доставки</legend>
          {Object.entries(DELIVERY).map(([v, t]) => (
            <Choice key={v} name="delivery" value={v} checked={delivery === v} onChange={() => setDelivery(v)} title={t} hint={DELIVERY_HINT[v]} />
          ))}
        </fieldset>

        {delivery !== "pickup" && (
          <fieldset className="space-y-4">
            <legend className="mb-4 text-3xl font-semibold">Адрес доставки</legend>
            {addresses.length > 0 && (
              <select aria-label="Сохранённые адреса" className={field} value={addr?.id ?? ""} onChange={(e) => setAddr(addresses.find((a) => a.id === e.target.value))}>
                {addresses.map((a) => <option key={a.id} value={a.id}>{a.label}: {a.city}, {a.street}</option>)}
                <option value="">Другой адрес</option>
              </select>
            )}
            <div key={addr?.id ?? "new"} className="grid gap-4 sm:grid-cols-2">
              <input name="city" required defaultValue={addr?.city} placeholder="Город" aria-label="Город" autoComplete="address-level2" className={field} />
              <input name="postal_code" required defaultValue={addr?.postal_code} placeholder="Индекс" aria-label="Индекс" autoComplete="postal-code" className={field} />
              <input name="street" required defaultValue={addr?.street} placeholder="Улица, дом, квартира" aria-label="Улица, дом, квартира" autoComplete="street-address" className={cn(field, "sm:col-span-2")} />
            </div>
          </fieldset>
        )}

        <fieldset className="space-y-3">
          <legend className="mb-4 text-3xl font-semibold">Способ оплаты</legend>
          {Object.entries(PAYMENT).map(([v, t]) => (
            <Choice key={v} name="payment" value={v} checked={payment === v} onChange={() => setPayment(v)} title={t} />
          ))}
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-xs text-amber-900">Демонстрационный режим оплаты: платёжный провайдер не подключён, деньги не списываются. Заказ создаётся со статусом «Новый».</p>
        </fieldset>

        <textarea name="comment" maxLength={500} rows={3} placeholder="Комментарий к заказу (необязательно)" aria-label="Комментарий к заказу" className="w-full rounded-xl border bg-background px-4 py-3 text-sm" />
      </div>

      <aside className="h-fit rounded-3xl bg-muted/60 p-6 lg:sticky lg:top-24">
        <h2 className="text-3xl font-semibold">Итог заказа</h2>
        <ul className="mt-5 space-y-4">
          {lines.map((l) => (
            <li key={l.id} className="flex gap-3 text-sm">
              <div className="relative aspect-[4/5] w-14 shrink-0 overflow-hidden rounded-lg bg-muted">
                {l.variant.products.product_images[0] && <Image src={l.variant.products.product_images[0].url} alt="" fill sizes="56px" className="object-cover" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{l.variant.products.name}</p>
                <p className="text-muted-foreground">{l.variant.color} · {l.variant.size} · {l.quantity} шт.</p>
              </div>
              <p className="font-medium">{formatPrice(l.variant.products.price * l.quantity)}</p>
            </li>
          ))}
        </ul>
        <dl className="mt-6 space-y-3 border-t pt-6 text-sm">
          {quote ? (
            <>
              <div className="flex justify-between"><dt className="text-muted-foreground">Товары</dt><dd>{formatPrice(quote.subtotal)}</dd></div>
              {quote.discount > 0 && <div className="flex justify-between text-success"><dt>Скидка{promo && ` (${promo})`}</dt><dd>−{formatPrice(quote.discount)}</dd></div>}
              <div className="flex justify-between"><dt className="text-muted-foreground">Доставка</dt><dd>{quote.shipping ? formatPrice(quote.shipping) : "Бесплатно"}</dd></div>
              <div className="flex justify-between border-t pt-4 text-base font-semibold"><dt>К оплате</dt><dd>{formatPrice(quote.total)}</dd></div>
            </>
          ) : (
            <p className={quoteError ? "text-destructive" : "text-muted-foreground"}>{quoteError ?? "Считаем сумму…"}</p>
          )}
        </dl>
        <div className="mt-4"><FormNotice state={state} /></div>
        <Button type="submit" size="lg" disabled={pending || !quote} className="mt-6 w-full">
          {pending && <Loader2 className="size-4 animate-spin" />} Подтвердить заказ
        </Button>
      </aside>
    </form>
  );
}
