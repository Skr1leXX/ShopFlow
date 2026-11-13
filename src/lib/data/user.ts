import "server-only";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { all, flag, placeholders, type Row } from "@/lib/core/db";
import { hydrateProducts } from "./shape";
import type { Address, CartLine, Order, OrderItem, Product } from "./types";

// Без RLS каждая выборка явно ограничена пользователем из сессии (userId): чужие данные запросом не достать.
async function me() {
  return (await getUser())?.id ?? null; // гостю принадлежит пустой набор данных, а не ошибка
}

export async function getCart(): Promise<CartLine[]> {
  const userId = await me();
  if (!userId) return [];
  const rows = await all(
    db(),
    `select ci.id, ci.quantity, pv.id vid, pv.product_id, pv.sku, pv.size, pv.color, pv.color_hex, pv.is_active v_active, i.quantity stock
     from cart_items ci join product_variants pv on pv.id = ci.variant_id left join inventory i on i.variant_id = pv.id
     where ci.user_id = ? order by ci.id`,
    [userId],
  );
  if (!rows.length) return [];
  const pids = [...new Set(rows.map((r) => r.product_id as string))];
  const products = new Map(
    (await hydrateProducts(await all(db(), `select * from products where id in (${placeholders(pids.length)})`, pids))).map((p) => [p.id, p]),
  );
  return rows
    .map((r) => ({
      id: r.id as string, quantity: r.quantity as number,
      variant: {
        id: r.vid as string, sku: r.sku as string, size: r.size as string, color: r.color as string, color_hex: r.color_hex as string,
        is_active: flag(r.v_active), inventory: r.stock === null ? null : { quantity: r.stock as number },
        products: products.get(r.product_id as string)!,
      },
    }))
    .filter((l) => l.variant.is_active && l.variant.products?.is_active);
}

export async function getCartCount() {
  const userId = await me();
  if (!userId) return 0;
  const rows = await all<{ n: number | null }>(db(), "select sum(quantity) n from cart_items where user_id = ?", [userId]);
  return rows[0]?.n ?? 0;
}

export async function getFavoriteIds(): Promise<Set<string>> {
  const userId = await me();
  if (!userId) return new Set();
  const rows = await all<{ product_id: string }>(db(), "select product_id from favorites where user_id = ?", [userId]);
  return new Set(rows.map((r) => r.product_id));
}

export async function getFavoriteProducts(): Promise<Product[]> {
  const userId = await me();
  if (!userId) return [];
  const rows = await all(
    db(), "select p.* from favorites f join products p on p.id = f.product_id where f.user_id = ? and p.is_active = 1 order by f.created_at desc", [userId],
  );
  return hydrateProducts(rows);
}

export async function getAddresses(): Promise<Address[]> {
  const userId = await me();
  if (!userId) return [];
  const rows = await all(db(), "select * from addresses where user_id = ? order by is_default desc, created_at", [userId]);
  return rows.map((r) => ({ ...(r as unknown as Address), is_default: flag(r.is_default) }));
}

/** Собирает заказы с позициями и разбирает JSON адреса. */
export async function hydrateOrders(rows: Row[]): Promise<Order[]> {
  if (!rows.length) return [];
  const items = await all<OrderItem & { order_id: string }>(
    db(), `select * from order_items where order_id in (${placeholders(rows.length)}) order by rowid`, rows.map((r) => r.id as string),
  );
  return rows.map((r) => ({
    ...(r as unknown as Order),
    shipping_address: (() => { try { return JSON.parse(String(r.shipping_address)); } catch { return {}; } })(),
    order_items: items.filter((i) => i.order_id === r.id),
  }));
}

export async function getMyOrders(): Promise<Order[]> {
  const userId = await me();
  if (!userId) return [];
  return hydrateOrders(await all(db(), "select * from orders where user_id = ? order by created_at desc", [userId]));
}

export async function getOrder(id: string): Promise<Order | null> {
  const userId = await me();
  if (!userId) return null;
  return (await hydrateOrders(await all(db(), "select * from orders where id = ? and user_id = ?", [id, userId])))[0] ?? null;
}
