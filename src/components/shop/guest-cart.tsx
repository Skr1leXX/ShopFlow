"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ShoppingBag } from "lucide-react";
import { CartView } from "@/components/shop/cart-view";
import { EmptyState, Skeleton } from "@/components/common/states";
import { getGuestLines, mergeGuestCart } from "@/lib/actions/shop";
import { parseGuest, readGuestCart, useGuestCartRaw, writeGuestCart } from "@/lib/guest-cart";
import type { CartLine } from "@/lib/data/types";

/** Корзина гостя: данные о товарах приходят с сервера, количество хранится в браузере. */
export function GuestCart() {
  const raw = useGuestCartRaw();
  const items = useMemo(() => parseGuest(raw), [raw]);
  const ids = items.map((i) => i.variantId).join(",");
  const [variants, setVariants] = useState<CartLine["variant"][] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!ids) return;
    getGuestLines(ids.split(","))
      .then((v) => { if (!cancelled) { setVariants(v); setFailed(false); } })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [ids]);

  if (failed) return <EmptyState title="Не удалось загрузить корзину" text="Проверьте подключение и обновите страницу." />;
  const loaded = ids ? variants : [];
  if (!loaded) return <Skeleton className="h-64" />;

  const lines: CartLine[] = items.flatMap((i) => {
    const variant = loaded.find((v) => v.id === i.variantId);
    return variant ? [{ id: i.variantId, quantity: i.quantity, variant }] : [];
  });
  if (!lines.length)
    return <EmptyState icon={ShoppingBag} title="Корзина пуста" text="Добавьте товары из каталога." href="/catalog" action="Перейти в каталог" />;
  return <CartView lines={lines} guest />;
}

/** После входа переносит гостевую корзину в базу. Выполняется один раз на вход. */
export function GuestCartSync() {
  const router = useRouter();
  const started = useRef(false);
  useEffect(() => {
    const items = readGuestCart();
    if (!items.length || started.current) return;
    started.current = true;
    // Очищаем до запроса: повторный запуск эффекта не добавит товары дважды.
    writeGuestCart([]);
    mergeGuestCart(items).then((r) => {
      if (!r.ok) writeGuestCart(items); // не получилось — оставляем гостевую корзину как есть
      router.refresh();
    }).catch(() => writeGuestCart(items));
  }, [router]);
  return null;
}
