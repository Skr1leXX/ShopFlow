import type { Client } from "@libsql/client";
import { BizError, one, type Q } from "./db.ts";

export type AddResult = { capped: boolean; total: number };

/** Добавляет вариант в корзину пользователя, не превышая остаток. Бросает BizError, если варианта нет в наличии. */
export async function addLine(q: Q, userId: string, variantId: string, quantity: number): Promise<AddResult> {
  const qty = Math.min(99, Math.max(1, Math.floor(quantity)));
  const v = await one<{ available: number }>(
    q,
    `select case when pv.is_active = 1 and p.is_active = 1 then coalesce(i.quantity, 0) else 0 end available
     from product_variants pv join products p on p.id = pv.product_id
     left join inventory i on i.variant_id = pv.id where pv.id = ?`,
    [variantId],
  );
  if (!v || v.available < 1) throw new BizError("Этого варианта нет в наличии");
  const existing = await one<{ id: string; quantity: number }>(q, "select id, quantity from cart_items where user_id = ? and variant_id = ?", [userId, variantId]);
  const total = Math.min(v.available, 99, (existing?.quantity ?? 0) + qty);
  if (existing) await q.execute({ sql: "update cart_items set quantity = ? where id = ?", args: [total, existing.id] });
  else await q.execute({ sql: "insert into cart_items (id, user_id, variant_id, quantity) values (?, ?, ?, ?)", args: [crypto.randomUUID(), userId, variantId, total] });
  return { capped: total < (existing?.quantity ?? 0) + qty, total };
}

/** Количество в корзине меняется только у владельца позиции и не выше остатка. */
export async function setLineQuantity(db: Client, userId: string, itemId: string, quantity: number) {
  const item = await one<{ stock: number }>(
    db,
    `select coalesce(i.quantity, 0) stock from cart_items ci left join inventory i on i.variant_id = ci.variant_id
     where ci.id = ? and ci.user_id = ?`,
    [itemId, userId],
  );
  if (!item) throw new BizError("Товар не найден в корзине");
  const qty = Math.min(item.stock, 99, Math.max(1, Math.floor(quantity)));
  if (qty < 1) throw new BizError("Товара нет в наличии");
  await db.execute({ sql: "update cart_items set quantity = ? where id = ? and user_id = ?", args: [qty, itemId, userId] });
}
