import type { Client } from "@libsql/client";
import { all, BizError, nowIso, one, round2, write, type Q } from "./db.ts";
import { changeStock } from "./stock.ts";

export type Delivery = "courier" | "pickup" | "post";
export type Payment = "card" | "cash" | "invoice";
export type Quote = { subtotal: number; discount: number; shipping: number; total: number };

/** Единственное место, где считается доставка. Витрина показывает то, что вернул этот расчёт. */
export function shippingCost(method: Delivery, subtotal: number) {
  if (method === "pickup" || subtotal >= 15000) return 0;
  return method === "courier" ? 490 : 290;
}

type CartLine = {
  id: string; variant_id: string; quantity: number; size: string; color: string; v_active: number;
  product_id: string; name: string; price: number; p_active: number; stock: number;
};

const cartLines = (q: Q, userId: string) =>
  all<CartLine>(
    q,
    `select ci.id, ci.variant_id, ci.quantity, pv.size, pv.color, pv.is_active v_active,
            p.id product_id, p.name, p.price, p.is_active p_active, coalesce(i.quantity, 0) stock
     from cart_items ci
     join product_variants pv on pv.id = ci.variant_id
     join products p on p.id = pv.product_id
     left join inventory i on i.variant_id = pv.id
     where ci.user_id = ? order by ci.id`,
    [userId],
  );

type Promo = {
  id: string; is_active: number; expires_at: string | null; max_uses: number | null; used_count: number;
  min_order_total: number; discount_percent: number | null; discount_amount: number | null;
};

/** Скидка по промокоду; бросает BizError с понятным текстом, если код не подходит. */
export async function applyPromo(q: Q, code: string | null | undefined, subtotal: number): Promise<{ promoId: string | null; discount: number }> {
  if (!code || !code.trim()) return { promoId: null, discount: 0 };
  const v = await one<Promo>(q, "select * from promo_codes where code = ?", [code.trim().toUpperCase()]);
  if (!v || !v.is_active) throw new BizError("Промокод не найден");
  if (v.expires_at && v.expires_at < nowIso()) throw new BizError("Срок действия промокода истёк");
  if (v.max_uses !== null && v.used_count >= v.max_uses) throw new BizError("Промокод уже исчерпан");
  if (subtotal < v.min_order_total) throw new BizError(`Минимальная сумма заказа для промокода — ${v.min_order_total} ₽`);
  const raw = v.discount_percent !== null ? round2((subtotal * v.discount_percent) / 100) : (v.discount_amount ?? 0);
  return { promoId: v.id, discount: Math.min(subtotal, raw) };
}

const activeSubtotal = (lines: CartLine[]) =>
  round2(lines.filter((l) => l.v_active && l.p_active).reduce((s, l) => s + l.price * l.quantity, 0));

/** Предварительный расчёт корзины пользователя: тот же код, что и при оформлении. */
export async function quoteOrder(q: Q, userId: string, promo: string | null, delivery: Delivery): Promise<Quote> {
  const subtotal = activeSubtotal(await cartLines(q, userId));
  const { discount } = await applyPromo(q, promo, subtotal);
  const shipping = subtotal === 0 ? 0 : shippingCost(delivery, subtotal - discount);
  return { subtotal, discount, shipping, total: round2(subtotal - discount + shipping) };
}

export type OrderInput = {
  name: string; email: string; phone: string; delivery: Delivery; payment: Payment;
  address: { city?: string; street?: string; postal_code?: string } | null;
  comment?: string; promo?: string | null; key?: string | null;
};

/**
 * Оформление заказа одной транзакцией. Цены, скидка, доставка и остатки берутся из БД, а не от клиента.
 * Транзакция записи в SQLite эксклюзивна: параллельные заказы идут по очереди и не продадут один товар дважды.
 */
export async function placeOrder(db: Client, userId: string, input: OrderInput): Promise<string> {
  return write(db, async (tx) => {
    if (input.key) {
      const dup = await one<{ id: string }>(tx, "select id from orders where user_id = ? and idempotency_key = ?", [userId, input.key]);
      if (dup) return dup.id; // повторная отправка формы: возвращаем уже созданный заказ
    }
    if (!input.name.trim() || !input.phone.trim() || !input.email.trim()) throw new BizError("Заполните контактные данные");
    if (input.delivery !== "pickup" && (!input.address?.city?.trim() || !input.address?.street?.trim()))
      throw new BizError("Укажите адрес доставки");

    const lines = await cartLines(tx, userId);
    if (!lines.length || activeSubtotal(lines) === 0) throw new BizError("Корзина пуста");
    if (lines.some((l) => !l.v_active || !l.p_active))
      throw new BizError("В корзине есть товары, недоступные для заказа. Удалите их и повторите.");
    for (const l of lines)
      if (l.stock < l.quantity)
        throw new BizError(`Недостаточно товара на складе: ${l.name} (${l.size}, ${l.color}), доступно ${l.stock}`);

    const subtotal = activeSubtotal(lines);
    const { promoId, discount } = await applyPromo(tx, input.promo, subtotal);
    const shipping = shippingCost(input.delivery, subtotal - discount);
    const number = ((await one<{ n: number | null }>(tx, "select max(number) n from orders"))?.n ?? 10000) + 1;
    const orderId = crypto.randomUUID();
    const now = nowIso();

    await tx.execute({
      sql: `insert into orders (id, number, user_id, subtotal, discount, shipping, total, promo_code_id, contact_name, contact_email,
              contact_phone, delivery_method, payment_method, shipping_address, comment, idempotency_key, created_at, updated_at)
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        orderId, number, userId, subtotal, discount, shipping, round2(subtotal - discount + shipping), promoId,
        input.name.trim().slice(0, 120), input.email.trim().slice(0, 160), input.phone.trim().slice(0, 24), input.delivery, input.payment,
        JSON.stringify(input.delivery === "pickup" ? {} : input.address ?? {}), (input.comment ?? "").slice(0, 500), input.key ?? null, now, now,
      ],
    });

    for (const l of lines) {
      const image = await one<{ url: string }>(tx, "select url from product_images where product_id = ? order by sort_order limit 1", [l.product_id]);
      await tx.execute({
        sql: `insert into order_items (id, order_id, variant_id, product_id, product_name, size, color, image_url, unit_price, quantity)
              values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [crypto.randomUUID(), orderId, l.variant_id, l.product_id, l.name, l.size, l.color, image?.url ?? null, l.price, l.quantity],
      });
      await changeStock(tx, l.variant_id, -l.quantity, "sale", { orderId, userId });
    }
    if (promoId) await tx.execute({ sql: "update promo_codes set used_count = used_count + 1 where id = ?", args: [promoId] });
    // Корзина очищается в той же транзакции: при любой ошибке выше она остаётся нетронутой.
    await tx.execute({ sql: "delete from cart_items where user_id = ?", args: [userId] });
    return orderId;
  });
}

/**
 * Смена статуса. «Отменён» и «доставлен» — конечные: это защищает склад от двойного возврата.
 * Отмена возвращает товар на склад (с записью в журнал) и уменьшает использование промокода — в той же транзакции.
 */
export async function setOrderStatus(db: Client, orderId: string, status: string, actorId?: string | null) {
  return write(db, async (tx) => {
    const o = await one<{ status: string; promo_code_id: string | null }>(tx, "select status, promo_code_id from orders where id = ?", [orderId]);
    if (!o) throw new BizError("Заказ не найден");
    if (o.status === status) return;
    if (o.status === "cancelled" || o.status === "delivered") throw new BizError("Заказ в этом статусе изменить нельзя");
    if (status === "cancelled" && o.status === "shipped") throw new BizError("Отправленный заказ нельзя отменить");
    await tx.execute({ sql: "update orders set status = ?, updated_at = ? where id = ?", args: [status, nowIso(), orderId] });
    if (status !== "cancelled") return;
    const items = await all<{ variant_id: string; quantity: number }>(
      tx, "select variant_id, quantity from order_items where order_id = ? and variant_id is not null", [orderId],
    );
    for (const it of items) await changeStock(tx, it.variant_id, it.quantity, "return", { orderId, userId: actorId });
    if (o.promo_code_id)
      await tx.execute({ sql: "update promo_codes set used_count = max(used_count - 1, 0) where id = ?", args: [o.promo_code_id] });
  });
}

/** Приход / списание / корректировка одной атомарной операцией. Возвращает новый остаток. */
export async function adjustStock(db: Client, p: { variantId: string; delta: number; reason: string; note?: string; userId?: string | null }) {
  if (!["receipt", "writeoff", "adjustment"].includes(p.reason)) throw new BizError("Неверная причина операции");
  if (!Number.isInteger(p.delta) || p.delta === 0 || Math.abs(p.delta) > 100000) throw new BizError("Количество должно быть ненулевым, до 100000");
  if (p.reason === "receipt" && p.delta < 0) throw new BizError("Приход должен быть положительным");
  if (p.reason === "writeoff" && p.delta > 0) throw new BizError("Списание должно быть отрицательным");
  return write(db, async (tx) => {
    if (!(await one(tx, "select 1 from product_variants where id = ?", [p.variantId]))) throw new BizError("Вариант не найден");
    try {
      return await changeStock(tx, p.variantId, p.delta, p.reason as "receipt", { note: (p.note ?? "").slice(0, 200), userId: p.userId });
    } catch (e) {
      if (e instanceof BizError) throw new BizError("Недостаточно товара на складе для списания");
      throw e;
    }
  });
}
