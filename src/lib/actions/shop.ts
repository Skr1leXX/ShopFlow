"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth";
import { CARD } from "@/lib/data/catalog";
import type { CartLine } from "@/lib/data/types";
import type { FormState } from "./auth";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

async function needUser(next: string) {
  const user = await getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  return user;
}

const uuid = z.string().uuid();

/** Сообщения бизнес-правил (raise exception, P0001) безопасны для показа; остальные ошибки БД скрываем. */
const dbMessage = (e: { code?: string; message: string }) =>
  e.code === "P0001" ? e.message : "Не удалось выполнить операцию. Попробуйте ещё раз.";

// ───────── корзина ─────────
type Db = Awaited<ReturnType<typeof createClient>>;

/** Добавляет вариант в корзину пользователя, не превышая остаток. Возвращает фактическое количество добавленного. */
type AddResult = { error: string } | { error?: undefined; capped: boolean; total: number };
async function addLine(supabase: Db, userId: string, variantId: string, quantity: number): Promise<AddResult> {
  const qty = Math.min(99, Math.max(1, Math.floor(quantity)));
  const { data: variant } = await supabase
    .from("product_variants").select("is_active, products(is_active), inventory(quantity)").eq("id", variantId).maybeSingle();
  const v = variant as unknown as { is_active: boolean; products: { is_active: boolean } | null; inventory: { quantity: number } | null } | null;
  const available = v?.is_active && v.products?.is_active ? v.inventory?.quantity ?? 0 : 0;
  if (available < 1) return { error: "Этого варианта нет в наличии" };

  let { data: cart } = await supabase.from("carts").select("id").eq("user_id", userId).maybeSingle();
  if (!cart) {
    const created = await supabase.from("carts").insert({ user_id: userId }).select("id").single();
    if (created.error) return { error: "Не удалось создать корзину" };
    cart = created.data;
  }
  const { data: existing } = await supabase
    .from("cart_items").select("id,quantity").eq("cart_id", cart.id).eq("variant_id", variantId).maybeSingle();
  const total = Math.min(available, 99, (existing?.quantity ?? 0) + qty);
  const { error } = existing
    ? await supabase.from("cart_items").update({ quantity: total }).eq("id", existing.id)
    : await supabase.from("cart_items").insert({ cart_id: cart.id, variant_id: variantId, quantity: total });
  if (error) return { error: "Не удалось добавить товар" };
  return { capped: total < (existing?.quantity ?? 0) + qty, total };
}

export async function addToCart(variantId: string, quantity: number, returnTo: string): Promise<ActionResult> {
  const user = await needUser(returnTo);
  if (!uuid.safeParse(variantId).success) return { ok: false, error: "Выберите размер и цвет" };
  const res = await addLine(await createClient(), user.id, variantId, quantity);
  if (res.error !== undefined) return { ok: false, error: res.error };
  revalidatePath("/", "layout");
  return { ok: true, message: res.capped ? `В корзину добавлено максимум: ${res.total} шт.` : "Товар добавлен в корзину" };
}

/** Объединяет гостевую корзину (из браузера) с корзиной пользователя. Данным из браузера не доверяем: остатки проверяются заново. */
export async function mergeGuestCart(items: { variantId: string; quantity: number }[]): Promise<ActionResult & { skipped?: number }> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Требуется вход" };
  const parsed = z.array(z.object({ variantId: uuid, quantity: z.number().int().min(1).max(99) })).max(50).safeParse(items);
  if (!parsed.success) return { ok: false, error: "Некорректная гостевая корзина" };
  const supabase = await createClient();
  let skipped = 0;
  for (const it of parsed.data) {
    const res = await addLine(supabase, user.id, it.variantId, it.quantity);
    if (res.error !== undefined) skipped++;
  }
  revalidatePath("/", "layout");
  return { ok: true, skipped };
}

/** Данные для гостевой корзины: публичный каталог, доступный и без входа. */
export async function getGuestLines(variantIds: string[]) {
  const ids = z.array(uuid).max(50).safeParse(variantIds);
  if (!ids.success || !ids.data.length) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("product_variants")
    .select(`id,sku,size,color,color_hex,is_active,inventory(quantity), products(${CARD})`)
    .in("id", ids.data);
  return (data ?? []).filter((v) => v.is_active) as unknown as CartLine["variant"][];
}

export async function setCartQuantity(itemId: string, quantity: number): Promise<ActionResult> {
  await needUser("/cart");
  if (!uuid.safeParse(itemId).success) return { ok: false, error: "Некорректный товар" };
  const supabase = await createClient();
  const { data: item } = await supabase.from("cart_items").select("variant_id").eq("id", itemId).maybeSingle();
  if (!item) return { ok: false, error: "Товар не найден в корзине" };
  const { data: stock } = await supabase.from("inventory").select("quantity").eq("variant_id", item.variant_id).maybeSingle();
  const qty = Math.min(stock?.quantity ?? 0, 99, Math.max(1, Math.floor(quantity)));
  if (qty < 1) return { ok: false, error: "Товара нет в наличии" };
  const { error } = await supabase.from("cart_items").update({ quantity: qty }).eq("id", itemId);
  if (error) return { ok: false, error: "Не удалось изменить количество" };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeCartItem(itemId: string): Promise<ActionResult> {
  await needUser("/cart");
  if (!uuid.safeParse(itemId).success) return { ok: false, error: "Некорректный товар" };
  const supabase = await createClient();
  const { error } = await supabase.from("cart_items").delete().eq("id", itemId);
  if (error) return { ok: false, error: "Не удалось удалить товар" };
  revalidatePath("/", "layout");
  return { ok: true };
}

// ───────── избранное ─────────
export async function toggleFavorite(productId: string, returnTo: string): Promise<ActionResult & { active?: boolean }> {
  const user = await needUser(returnTo);
  if (!uuid.safeParse(productId).success) return { ok: false, error: "Некорректный товар" };
  const supabase = await createClient();
  const { data: existing } = await supabase.from("favorites").select("product_id").eq("product_id", productId).maybeSingle();
  const { error } = existing
    ? await supabase.from("favorites").delete().eq("product_id", productId)
    : await supabase.from("favorites").insert({ user_id: user.id, product_id: productId });
  if (error) return { ok: false, error: "Не удалось обновить избранное" };
  revalidatePath("/", "layout");
  return { ok: true, active: !existing };
}

// ───────── расчёт и оформление заказа ─────────
export type Quote = { subtotal: number; discount: number; shipping: number; total: number };

export async function quoteOrder(promo: string, delivery: string): Promise<{ ok: true; quote: Quote } | { ok: false; error: string }> {
  await needUser("/cart");
  const method = z.enum(["courier", "pickup", "post"]).safeParse(delivery);
  if (!method.success) return { ok: false, error: "Выберите способ доставки" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("quote_order", { p_promo: promo.trim() || null, p_delivery: method.data });
  if (error) return { ok: false, error: dbMessage(error) };
  return { ok: true, quote: data as Quote };
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
  await needUser("/checkout");
  const parsed = orderSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;
  if (v.delivery !== "pickup" && (!v.city || !v.street || !v.postal_code))
    return { error: "Укажите город, улицу и индекс для доставки" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("place_order", {
    p_name: v.name, p_email: v.email, p_phone: v.phone, p_delivery: v.delivery, p_payment: v.payment,
    p_address: v.delivery === "pickup" ? {} : { city: v.city, street: v.street, postal_code: v.postal_code },
    p_comment: v.comment ?? "", p_promo: v.promo || null, p_key: v.key,
  });
  if (error) return { error: dbMessage(error) };
  revalidatePath("/", "layout");
  redirect(`/account/orders/${data}?placed=1`);
}

// ───────── профиль и адреса ─────────
export async function updateProfile(_: FormState, form: FormData): Promise<FormState> {
  const user = await needUser("/account");
  const parsed = z
    .object({ full_name: z.string().trim().min(2, "Укажите имя").max(120), phone: z.string().trim().max(24).optional() })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (parsed.data.phone && parsed.data.phone.length < 5) return { error: "Телефон слишком короткий" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles").update({ full_name: parsed.data.full_name, phone: parsed.data.phone || null }).eq("id", user.id);
  if (error) return { error: "Не удалось сохранить профиль" };
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
  const supabase = await createClient();
  const { count } = await supabase.from("addresses").select("id", { count: "exact", head: true });
  const { error } = await supabase.from("addresses").insert({ ...parsed.data, user_id: user.id, is_default: !count });
  if (error) return { error: "Не удалось сохранить адрес" };
  revalidatePath("/account/addresses");
  return { message: "Адрес добавлен" };
}

export async function deleteAddress(id: string): Promise<ActionResult> {
  await needUser("/account/addresses");
  if (!uuid.safeParse(id).success) return { ok: false, error: "Некорректный адрес" };
  const supabase = await createClient();
  const { error } = await supabase.from("addresses").delete().eq("id", id);
  if (error) return { ok: false, error: "Не удалось удалить адрес" };
  revalidatePath("/account/addresses");
  return { ok: true };
}
