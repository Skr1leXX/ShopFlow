"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { addLine, setLineQuantity } from "@/lib/core/cart";
import { all, BizError, flag, one, placeholders } from "@/lib/core/db";
import { placeOrder as createOrder, quoteOrder as quote, type Quote } from "@/lib/core/orders";
import { hydrateProducts } from "@/lib/data/shape";
import type { CartLine } from "@/lib/data/types";
import type { FormState } from "./auth";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };
export type { Quote };

async function needUser(next: string) {
  const user = await getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  return user;
}

const uuid = z.string().uuid();

/** Тексты бизнес-правил (BizError) безопасны для показа; остальные ошибки скрываем. */
const errText = (e: unknown, fallback = "Не удалось выполнить операцию. Попробуйте ещё раз.") => (e instanceof BizError ? e.message : fallback);

// ───────── корзина ─────────
export async function addToCart(variantId: string, quantity: number, returnTo: string): Promise<ActionResult> {
  const user = await needUser(returnTo);
  if (!uuid.safeParse(variantId).success) return { ok: false, error: "Выберите размер и цвет" };
  try {
    const res = await addLine(db(), user.id, variantId, quantity);
    revalidatePath("/", "layout");
    return { ok: true, message: res.capped ? `В корзину добавлено максимум: ${res.total} шт.` : "Товар добавлен в корзину" };
  } catch (e) {
    return { ok: false, error: errText(e, "Не удалось добавить товар") };
  }
}

/** Объединяет гостевую корзину (из браузера) с корзиной пользователя. Данным из браузера не доверяем: остатки проверяются заново. */
export async function mergeGuestCart(items: { variantId: string; quantity: number }[]): Promise<ActionResult & { skipped?: number }> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Требуется вход" };
  const parsed = z.array(z.object({ variantId: uuid, quantity: z.number().int().min(1).max(99) })).max(50).safeParse(items);
  if (!parsed.success) return { ok: false, error: "Некорректная гостевая корзина" };
  let skipped = 0;
  for (const it of parsed.data) {
    try { await addLine(db(), user.id, it.variantId, it.quantity); } catch { skipped++; }
  }
  revalidatePath("/", "layout");
  return { ok: true, skipped };
}

/** Данные для гостевой корзины: публичный каталог, доступный и без входа. */
export async function getGuestLines(variantIds: string[]) {
  const ids = z.array(uuid).max(50).safeParse(variantIds);
  if (!ids.success || !ids.data.length) return [];
  const rows = await all(
    db(),
    `select pv.id, pv.product_id, pv.sku, pv.size, pv.color, pv.color_hex, pv.is_active, i.quantity
     from product_variants pv left join inventory i on i.variant_id = pv.id where pv.is_active = 1 and pv.id in (${placeholders(ids.data.length)})`,
    ids.data,
  );
  const pids = [...new Set(rows.map((r) => r.product_id as string))];
  const products = new Map(
    (pids.length ? await hydrateProducts(await all(db(), `select * from products where id in (${placeholders(pids.length)})`, pids)) : []).map((p) => [p.id, p]),
  );
  return rows.map((r) => ({
    id: r.id, sku: r.sku, size: r.size, color: r.color, color_hex: r.color_hex, is_active: flag(r.is_active),
    inventory: r.quantity === null ? null : { quantity: r.quantity }, products: products.get(r.product_id as string),
  })) as unknown as CartLine["variant"][];
}

export async function setCartQuantity(itemId: string, quantity: number): Promise<ActionResult> {
  const user = await needUser("/cart");
  if (!uuid.safeParse(itemId).success) return { ok: false, error: "Некорректный товар" };
  try {
    await setLineQuantity(db(), user.id, itemId, quantity);
  } catch (e) {
    return { ok: false, error: errText(e, "Не удалось изменить количество") };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeCartItem(itemId: string): Promise<ActionResult> {
  const user = await needUser("/cart");
  if (!uuid.safeParse(itemId).success) return { ok: false, error: "Некорректный товар" };
  try {
    await db().execute({ sql: "delete from cart_items where id = ? and user_id = ?", args: [itemId, user.id] });
  } catch {
    return { ok: false, error: "Не удалось удалить товар" };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

// ───────── избранное ─────────
export async function toggleFavorite(productId: string, returnTo: string): Promise<ActionResult & { active?: boolean }> {
  const user = await needUser(returnTo);
  if (!uuid.safeParse(productId).success) return { ok: false, error: "Некорректный товар" };
  try {
    const existing = await one(db(), "select 1 from favorites where user_id = ? and product_id = ?", [user.id, productId]);
    if (existing) await db().execute({ sql: "delete from favorites where user_id = ? and product_id = ?", args: [user.id, productId] });
    else await db().execute({ sql: "insert or ignore into favorites (user_id, product_id) select ?, id from products where id = ?", args: [user.id, productId] });
    revalidatePath("/", "layout");
    return { ok: true, active: !existing };
  } catch {
    return { ok: false, error: "Не удалось обновить избранное" };
  }
}

// ───────── расчёт и оформление заказа ─────────
export async function quoteOrder(promo: string, delivery: string): Promise<{ ok: true; quote: Quote } | { ok: false; error: string }> {
  const user = await needUser("/cart");
  const method = z.enum(["courier", "pickup", "post"]).safeParse(delivery);
  if (!method.success) return { ok: false, error: "Выберите способ доставки" };
  try {
    return { ok: true, quote: await quote(db(), user.id, promo.trim() || null, method.data) };
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
}

const orderSchema = z.object({
  name: z.string().trim().min(2, "Укажите имя получателя").max(120),
  email: z.string().trim().email("Введите корректный email"),
  phone: z.string().trim().min(5, "Укажите телефон").max(24),
  delivery: z.enum(["courier", "pickup", "post"], { message: "Выберите способ доставки" }),
  payment: z.enum(["card", "cash", "invoice"], { message: "Выберите способ оплаты" }),
  city: z.string().trim().max(80).optional(),
  street: z.string().trim().max(160).optional(),
  postal_code: z.string().trim().max(12).optional(),
  comment: z.string().trim().max(500).optional(),
  promo: z.string().trim().max(32).optional(),
  key: z.string().uuid("Обновите страницу и повторите попытку"),
});

export async function placeOrder(_: FormState, form: FormData): Promise<FormState> {
  const user = await needUser("/checkout");
  const parsed = orderSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;
  if (v.delivery !== "pickup" && (!v.city || !v.street || !v.postal_code))
    return { error: "Укажите город, улицу и индекс для доставки" };

  let id: string;
  try {
    id = await createOrder(db(), user.id, {
      name: v.name, email: v.email, phone: v.phone, delivery: v.delivery, payment: v.payment,
      address: { city: v.city, street: v.street, postal_code: v.postal_code },
      comment: v.comment, promo: v.promo || null, key: v.key,
    });
  } catch (e) {
    return { error: errText(e) };
  }
  revalidatePath("/", "layout");
  redirect(`/account/orders/${id}?placed=1`);
}

// ───────── профиль и адреса ─────────
export async function updateProfile(_: FormState, form: FormData): Promise<FormState> {
  const user = await needUser("/account");
  const parsed = z
    .object({ full_name: z.string().trim().min(2, "Укажите имя").max(120), phone: z.string().trim().max(24).optional() })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (parsed.data.phone && parsed.data.phone.length < 5) return { error: "Телефон слишком короткий" };
  try {
    await db().execute({
      sql: "update profiles set full_name = ?, phone = ?, updated_at = ? where id = ?",
      args: [parsed.data.full_name, parsed.data.phone || null, new Date().toISOString(), user.id],
    });
  } catch {
    return { error: "Не удалось сохранить профиль" };
  }
  revalidatePath("/account");
  return { message: "Профиль сохранён" };
}

export async function addAddress(_: FormState, form: FormData): Promise<FormState> {
  const user = await needUser("/account/addresses");
  const parsed = z
    .object({
      label: z.string().trim().min(1, "Укажите название").max(40),
      recipient: z.string().trim().min(2, "Укажите получателя").max(120),
      phone: z.string().trim().min(5, "Укажите телефон").max(24),
      city: z.string().trim().min(2, "Укажите город").max(80),
      street: z.string().trim().min(2, "Укажите улицу").max(160),
      postal_code: z.string().trim().min(4, "Укажите индекс").max(12),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const a = parsed.data;
  try {
    await db().execute({
      sql: `insert into addresses (id, user_id, label, recipient, phone, city, street, postal_code, is_default)
            values (?, ?, ?, ?, ?, ?, ?, ?, not exists (select 1 from addresses where user_id = ?))`,
      args: [crypto.randomUUID(), user.id, a.label, a.recipient, a.phone, a.city, a.street, a.postal_code, user.id],
    });
  } catch {
    return { error: "Не удалось сохранить адрес" };
  }
  revalidatePath("/account/addresses");
  return { message: "Адрес добавлен" };
}

export async function deleteAddress(id: string): Promise<ActionResult> {
  const user = await needUser("/account/addresses");
  if (!uuid.safeParse(id).success) return { ok: false, error: "Некорректный адрес" };
  try {
    await db().execute({ sql: "delete from addresses where id = ? and user_id = ?", args: [id, user.id] });
  } catch {
    return { ok: false, error: "Не удалось удалить адрес" };
  }
  revalidatePath("/account/addresses");
  return { ok: true };
}
