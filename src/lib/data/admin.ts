import "server-only";
import { db } from "@/lib/db";
import { all, flag, one } from "@/lib/core/db";
import { hydrateProducts, toCategory } from "./shape";
import { hydrateOrders } from "./user";
import type { Category, Order, Product, ProductFull, Profile, PromoCode } from "./types";

// Только для админ-страниц: каждая страница сначала вызывает requireAdmin(). Данные читаются из базы напрямую,
// поэтому проверка роли на сервере здесь единственный барьер, и она выполняется до любого запроса.

export const LOW_STOCK = 3;

const includes = (hay: (string | null | undefined)[], needle: string) => {
  const n = needle.trim().toLowerCase();
  return !n || hay.some((h) => (h ?? "").toLowerCase().includes(n)); // регистр кириллицы SQLite не понижает, поэтому поиск в JS
};

export type DashboardData = Awaited<ReturnType<typeof getDashboard>>;

export async function getDashboard() {
  const since = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
  const [orders, customers, products, lowStock, recent, sales, top] = await Promise.all([
    all<{ total: number; status: string }>(db(), "select total, status from orders"),
    one<{ n: number }>(db(), "select count(*) n from profiles where role = 'customer'"),
    one<{ n: number }>(db(), "select count(*) n from products where is_active = 1"),
    all(
      db(),
      `select i.variant_id, i.quantity, pv.size, pv.color, pv.is_active v_active, p.name, p.is_active p_active
       from inventory i join product_variants pv on pv.id = i.variant_id join products p on p.id = pv.product_id
       where i.quantity <= ? order by i.quantity, p.name limit 8`,
      [LOW_STOCK],
    ),
    all(db(), "select id, number, status, total, contact_name, created_at from orders order by created_at desc limit 6"),
    all<{ day: string; orders: number; revenue: number }>(
      db(),
      "select substr(created_at, 1, 10) day, count(*) orders, sum(total) revenue from orders where status <> 'cancelled' and substr(created_at, 1, 10) >= ? group by day",
      [since],
    ),
    all<{ product_id: string | null; name: string; units: number; revenue: number }>(
      db(),
      `select oi.product_id, max(oi.product_name) name, sum(oi.quantity) units, sum(oi.unit_price * oi.quantity) revenue
       from order_items oi join orders o on o.id = oi.order_id and o.status <> 'cancelled'
       group by oi.product_id order by units desc, revenue desc limit 5`,
    ),
  ]);

  const valid = orders.filter((o) => o.status !== "cancelled");
  const revenue = valid.reduce((s, o) => s + Number(o.total), 0);
  const byDay = new Map(sales.map((r) => [r.day, r]));
  const days = Array.from({ length: 30 }, (_, i) => new Date(Date.now() - (29 - i) * 86_400_000).toISOString().slice(0, 10));
  return {
    orderCount: orders.length,
    revenue,
    avgCheck: valid.length ? revenue / valid.length : 0,
    newOrders: orders.filter((o) => o.status === "pending").length,
    customers: customers?.n ?? 0,
    products: products?.n ?? 0,
    lowStock: lowStock.map((r) => ({
      variant_id: r.variant_id as string, quantity: r.quantity as number,
      variant: { size: r.size as string, color: r.color as string, is_active: flag(r.v_active), products: { name: r.name as string, is_active: flag(r.p_active) } },
    })),
    recent: recent as unknown as Pick<Order, "id" | "number" | "status" | "total" | "contact_name" | "created_at">[],
    sales: days.map((day) => ({ day, orders: Number(byDay.get(day)?.orders ?? 0), revenue: Number(byDay.get(day)?.revenue ?? 0) })),
    top: top.map((r) => ({ ...r, units: Number(r.units), revenue: Number(r.revenue) })),
  };
}

// ───────── товары ─────────
export type ProductFilters = { q?: string; category?: string; status?: string; stock?: string; sort?: string };
export type AdminProduct = Product & { variant_count: number; total_stock: number };

export async function listAdminProducts(f: ProductFilters = {}): Promise<AdminProduct[]> {
  const where = ["1 = 1"];
  const args: string[] = [];
  if (f.category) { where.push("category_id = ?"); args.push(f.category); }
  if (f.status === "active") where.push("is_active = 1");
  if (f.status === "hidden") where.push("is_active = 0");
  const rows = (await all(db(), `select * from products where ${where.join(" and ")} order by created_at desc limit 500`, args))
    .filter((r) => includes([r.name as string, r.brand as string, r.slug as string], f.q ?? ""));

  let list = (await hydrateProducts(rows, true)).map((p) => ({
    ...p,
    variant_count: p.product_variants.length,
    total_stock: p.product_variants.reduce((s, v) => s + (v.inventory?.quantity ?? 0), 0),
  }));
  if (f.stock === "out") list = list.filter((p) => p.total_stock === 0);
  if (f.stock === "in") list = list.filter((p) => p.total_stock > 0);
  const sorts: Record<string, (a: AdminProduct, b: AdminProduct) => number> = {
    name: (a, b) => a.name.localeCompare(b.name, "ru"),
    price_asc: (a, b) => a.price - b.price,
    price_desc: (a, b) => b.price - a.price,
    stock: (a, b) => a.total_stock - b.total_stock,
    created: (a, b) => b.created_at.localeCompare(a.created_at),
  };
  return list.sort(sorts[f.sort ?? "created"] ?? sorts.created);
}

export async function getAdminProduct(id: string): Promise<ProductFull | null> {
  const row = await one(db(), "select * from products where id = ?", [id]);
  return row ? (await hydrateProducts([row], true))[0] : null;
}

export async function listAdminCategories(): Promise<(Category & { product_count: number })[]> {
  const [cats, counts] = await Promise.all([
    all(db(), "select * from categories order by sort_order, name"),
    all<{ category_id: string; n: number }>(db(), "select category_id, count(*) n from products group by category_id"),
  ]);
  const byId = new Map(counts.map((c) => [c.category_id, c.n]));
  return cats.map((c) => ({ ...toCategory(c), product_count: byId.get(c.id as string) ?? 0 }));
}

// ───────── заказы ─────────
export async function listAdminOrders(f: { q?: string; status?: string } = {}): Promise<Order[]> {
  const status = f.status && f.status !== "all" ? f.status : null;
  const rows = (await all(db(), `select * from orders ${status ? "where status = ?" : ""} order by created_at desc limit 500`, status ? [status] : []))
    .filter((o) => includes([String(o.number), o.contact_name as string, o.contact_email as string, o.contact_phone as string], f.q ?? ""));
  return hydrateOrders(rows);
}

// ───────── клиенты ─────────
export type CustomerRow = Profile & {
  orders: number; spent: number;
  history: Pick<Order, "id" | "number" | "status" | "total" | "created_at">[];
};

export async function listCustomers(search?: string): Promise<CustomerRow[]> {
  const [profiles, orders] = await Promise.all([
    all<Profile>(db(), "select id, email, full_name, phone, role, created_at from profiles order by created_at desc limit 500"),
    all<Pick<Order, "id" | "number" | "status" | "total" | "created_at"> & { user_id: string }>(
      db(), "select id, number, status, total, created_at, user_id from orders order by created_at desc",
    ),
  ]);
  return profiles
    .filter((p) => includes([p.full_name, p.email, p.phone], search ?? ""))
    .map((p) => {
      const mine = orders.filter((o) => o.user_id === p.id);
      return {
        ...p,
        orders: mine.length,
        spent: mine.filter((o) => o.status !== "cancelled").reduce((s, o) => s + Number(o.total), 0),
        history: mine,
      };
    });
}

// ───────── склад ─────────
export type StockRow = { variant_id: string; quantity: number; variant: { sku: string; size: string; color: string; products: { name: string; slug: string } } };

export async function listStock(f: { q?: string; filter?: string } = {}): Promise<StockRow[]> {
  const cond = f.filter === "out" ? "where i.quantity = 0" : f.filter === "low" ? `where i.quantity > 0 and i.quantity <= ${LOW_STOCK}` : f.filter === "in" ? "where i.quantity > 0" : "";
  const rows = await all(
    db(),
    `select i.variant_id, i.quantity, pv.sku, pv.size, pv.color, p.name, p.slug
     from inventory i join product_variants pv on pv.id = i.variant_id join products p on p.id = pv.product_id
     ${cond} order by i.quantity, p.name limit 1000`,
  );
  const term = (f.q ?? "").trim().toLowerCase();
  return rows
    .map((r) => ({
      variant_id: r.variant_id as string, quantity: r.quantity as number,
      variant: { sku: r.sku as string, size: r.size as string, color: r.color as string, products: { name: r.name as string, slug: r.slug as string } },
    }))
    .filter((r) => !term || r.variant.products.name.toLowerCase().includes(term) || r.variant.sku.toLowerCase().includes(term) || r.variant.size.toLowerCase() === term);
}

export type MovementRow = {
  id: string; delta: number; balance: number; reason: string; note: string; created_at: string; order_id: string | null;
  variant: { size: string; color: string; products: { name: string } };
};

export async function listMovements(limit = 60): Promise<MovementRow[]> {
  const rows = await all(
    db(),
    `select m.id, m.delta, m.balance, m.reason, m.note, m.created_at, m.order_id, pv.size, pv.color, p.name
     from inventory_movements m join product_variants pv on pv.id = m.variant_id join products p on p.id = pv.product_id
     order by m.created_at desc, m.rowid desc limit ?`,
    [limit],
  );
  return rows.map((r) => ({
    id: r.id as string, delta: r.delta as number, balance: r.balance as number, reason: r.reason as string, note: r.note as string,
    created_at: r.created_at as string, order_id: (r.order_id as string | null) ?? null,
    variant: { size: r.size as string, color: r.color as string, products: { name: r.name as string } },
  }));
}

export async function listPromos(): Promise<PromoCode[]> {
  return (await all(db(), "select * from promo_codes order by created_at desc, code")).map((r) => ({ ...(r as unknown as PromoCode), is_active: flag(r.is_active) }));
}
