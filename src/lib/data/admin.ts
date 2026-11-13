import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Category, Order, Product, ProductFull, Profile, PromoCode } from "./types";

// Только для админ-страниц (после requireAdmin). Доступ к данным ограничивает RLS, аналитику — проверка is_admin() в RPC.

export const LOW_STOCK = 3;

const clean = (s: string) => s.replace(/[,()%*\\]/g, " ").trim();

export type DashboardData = Awaited<ReturnType<typeof getDashboard>>;

export async function getDashboard() {
  const supabase = await createClient();
  const [orders, customers, products, lowStock, recent, sales, top] = await Promise.all([
    supabase.from("orders").select("total,status"),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "customer"),
    supabase.from("products").select("id", { count: "exact", head: true }).eq("is_active", true),
    supabase
      .from("inventory")
      .select("variant_id, quantity, variant:product_variants!inner(size,color,is_active,products!inner(name,is_active))")
      .lte("quantity", LOW_STOCK)
      .order("quantity")
      .limit(8),
    supabase.from("orders").select("id,number,status,total,contact_name,created_at").order("created_at", { ascending: false }).limit(6),
    supabase.rpc("admin_sales_by_day", { p_days: 30 }),
    supabase.rpc("admin_top_products", { p_limit: 5 }),
  ]);
  const err = orders.error ?? customers.error ?? products.error ?? lowStock.error ?? recent.error ?? sales.error ?? top.error;
  if (err) throw new Error(err.message);

  const valid = (orders.data ?? []).filter((o) => o.status !== "cancelled");
  const revenue = valid.reduce((s, o) => s + Number(o.total), 0);
  return {
    orderCount: orders.data?.length ?? 0,
    revenue,
    avgCheck: valid.length ? revenue / valid.length : 0,
    newOrders: (orders.data ?? []).filter((o) => o.status === "pending").length,
    customers: customers.count ?? 0,
    products: products.count ?? 0,
    lowStock: (lowStock.data ?? []) as unknown as {
      variant_id: string; quantity: number;
      variant: { size: string; color: string; is_active: boolean; products: { name: string; is_active: boolean } };
    }[],
    recent: (recent.data ?? []) as Pick<Order, "id" | "number" | "status" | "total" | "contact_name" | "created_at">[],
    sales: ((sales.data ?? []) as { day: string; orders: number; revenue: number }[]).map((r) => ({
      day: r.day, orders: Number(r.orders), revenue: Number(r.revenue),
    })),
    top: ((top.data ?? []) as { product_id: string | null; name: string; units: number; revenue: number }[]).map((r) => ({
      ...r, units: Number(r.units), revenue: Number(r.revenue),
    })),
  };
}

// ───────── товары ─────────
export type ProductFilters = { q?: string; category?: string; status?: string; stock?: string; sort?: string };
export type AdminProduct = Product & { variant_count: number; total_stock: number };

export async function listAdminProducts(f: ProductFilters = {}): Promise<AdminProduct[]> {
  const supabase = await createClient();
  let q = supabase
    .from("products")
    .select("*, product_images(id,url,storage_path,alt,sort_order), categories(name,slug), product_variants(id,inventory(quantity))")
    .order("sort_order", { referencedTable: "product_images" })
    .limit(500);
  if (f.q && clean(f.q)) q = q.or(`name.ilike.%${clean(f.q)}%,brand.ilike.%${clean(f.q)}%,slug.ilike.%${clean(f.q)}%`);
  if (f.category) q = q.eq("category_id", f.category);
  if (f.status === "active") q = q.eq("is_active", true);
  if (f.status === "hidden") q = q.eq("is_active", false);
  const { data, error } = await q;
  if (error) throw new Error(error.message);

  let rows = (data as unknown as (Product & { product_variants: { id: string; inventory: { quantity: number } | null }[] })[]).map((p) => ({
    ...p,
    variant_count: p.product_variants.length,
    total_stock: p.product_variants.reduce((s, v) => s + (v.inventory?.quantity ?? 0), 0),
  }));
  if (f.stock === "out") rows = rows.filter((p) => p.total_stock === 0);
  if (f.stock === "in") rows = rows.filter((p) => p.total_stock > 0);
  const sorts: Record<string, (a: AdminProduct, b: AdminProduct) => number> = {
    name: (a, b) => a.name.localeCompare(b.name, "ru"),
    price_asc: (a, b) => a.price - b.price,
    price_desc: (a, b) => b.price - a.price,
    stock: (a, b) => a.total_stock - b.total_stock,
    created: (a, b) => b.created_at.localeCompare(a.created_at),
  };
  return rows.sort(sorts[f.sort ?? "created"] ?? sorts.created);
}

export async function getAdminProduct(id: string): Promise<ProductFull | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("*, product_images(id,url,storage_path,alt,sort_order), categories(name,slug), product_variants(id,sku,size,color,color_hex,is_active,inventory(quantity))")
    .eq("id", id)
    .order("sort_order", { referencedTable: "product_images" })
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as unknown as ProductFull | null;
}

export async function listAdminCategories(): Promise<(Category & { product_count: number })[]> {
  const supabase = await createClient();
  const [cats, prods] = await Promise.all([
    supabase.from("categories").select("*").order("sort_order").order("name"),
    supabase.from("products").select("category_id"),
  ]);
  const err = cats.error ?? prods.error;
  if (err) throw new Error(err.message);
  return (cats.data as Category[]).map((c) => ({
    ...c,
    product_count: (prods.data ?? []).filter((p) => p.category_id === c.id).length,
  }));
}

// ───────── заказы ─────────
export async function listAdminOrders(f: { q?: string; status?: string } = {}): Promise<Order[]> {
  const supabase = await createClient();
  let q = supabase.from("orders").select("*, order_items(*)").order("created_at", { ascending: false }).limit(500);
  if (f.status && f.status !== "all") q = q.eq("status", f.status);
  const term = f.q ? clean(f.q) : "";
  if (term) {
    const like = `contact_name.ilike.%${term}%,contact_email.ilike.%${term}%,contact_phone.ilike.%${term}%`;
    q = /^\d{1,12}$/.test(term) ? q.or(`number.eq.${term},${like}`) : q.or(like);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data as unknown as Order[];
}

// ───────── клиенты ─────────
export type CustomerRow = Profile & {
  orders: number; spent: number;
  history: Pick<Order, "id" | "number" | "status" | "total" | "created_at">[];
};

export async function listCustomers(search?: string): Promise<CustomerRow[]> {
  const supabase = await createClient();
  let pq = supabase.from("profiles").select("*").order("created_at", { ascending: false }).limit(500);
  const term = search ? clean(search) : "";
  if (term) pq = pq.or(`full_name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`);
  const [profiles, orders] = await Promise.all([pq, supabase.from("orders").select("id,number,status,total,created_at,user_id").order("created_at", { ascending: false })]);
  const err = profiles.error ?? orders.error;
  if (err) throw new Error(err.message);
  return (profiles.data as Profile[]).map((p) => {
    const mine = (orders.data ?? []).filter((o) => o.user_id === p.id);
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
  const supabase = await createClient();
  let q = supabase
    .from("inventory")
    .select("variant_id, quantity, variant:product_variants!inner(sku,size,color,products!inner(name,slug))")
    .order("quantity")
    .limit(1000);
  if (f.filter === "out") q = q.eq("quantity", 0);
  if (f.filter === "low") q = q.gt("quantity", 0).lte("quantity", LOW_STOCK);
  if (f.filter === "in") q = q.gt("quantity", 0);
  const term = f.q ? clean(f.q) : "";
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = data as unknown as StockRow[];
  // Поиск по названию товара — после выборки: PostgREST не умеет OR по двум уровням вложенности.
  return term ? rows.filter((r) => r.variant.products.name.toLowerCase().includes(term.toLowerCase()) || r.variant.sku.toLowerCase().includes(term.toLowerCase()) || r.variant.size.toLowerCase() === term.toLowerCase()) : rows;
}

export type MovementRow = {
  id: string; delta: number; balance: number; reason: string; note: string; created_at: string; order_id: string | null;
  variant: { size: string; color: string; products: { name: string } };
};

export async function listMovements(limit = 60): Promise<MovementRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inventory_movements")
    .select("id,delta,balance,reason,note,created_at,order_id, variant:product_variants(size,color,products(name))")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data as unknown as MovementRow[];
}

export async function listPromos(): Promise<PromoCode[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("promo_codes").select("*").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data as PromoCode[];
}
