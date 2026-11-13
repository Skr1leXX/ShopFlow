"use client";

import { parseGuest, useGuestCartRaw } from "@/lib/guest-cart";

/** Число товаров: для вошедшего — из базы, для гостя — из браузера. Даёт доступное имя ссылке «Корзина». */
export function CartBadge({ serverCount, loggedIn }: { serverCount: number; loggedIn: boolean }) {
  const raw = useGuestCartRaw();
  const count = loggedIn ? serverCount : parseGuest(raw).reduce((s, i) => s + i.quantity, 0);
  return (
    <>
      <span className="sr-only">{`Корзина, товаров: ${count}`}</span>
      {count > 0 && (
        <span aria-hidden className="absolute right-0.5 top-0.5 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground">{count}</span>
      )}
    </>
  );
}
