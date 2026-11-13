import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Category, Product, ProductFull } from "./types";

export const PAGE_SIZE = 12;
export const SORTS = {
  popular: "Сначала популярные",
  new: "Сначала новинки",
  price_asc: "Цена: по возрастанию",
  price_desc: "Цена: по убыванию",
} as const;
export type SortKey = keyof typeof SORTS;

export type CatalogParams = {
  q?: string; category?: string; brands?: string[]; sizes?: string[]; colors?: string[];
  min?: number; max?: number; sort?: SortKey; page?: number;
};

export const CARD = "*, product_images(id,url,storage_path,alt,sort_order), categories(name,slug), stock:product_variants(is_active,inventory(quantity))";

/** Убираем символы, ломающие синтаксис фильтра PostgREST. */
const clean = (s: string) => s.replace(/[,()%*\\]/g, " ").trim();

export const getCategories = cache(async (): Promise<Category[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.from("categories").select("*").eq("is_active", true).order("sort_order");
  if (error) throw new Error(error.message);
  return data as Category[];
});

export async function getProducts(p: CatalogParams = {}) {
  const supabase = await createClient();
  const page = Math.max(1, p.page ?? 1);
  const needVariants = Boolean(p.sizes?.length || p.colors?.length);
  let query = supabase
    .from("products")
    .select(needVariants ? `${CARD}, product_variants!inner(size,color)` : CARD, { count: "exact" })
    .eq("is_active", true);

  if (p.category) {
    const { data: cat } = await supabase.from("categories").select("id").eq("slug", p.category).maybeSingle();
    if (!cat) return { items: [] as Product[], total: 0, page };
    query = query.eq("category_id", cat.id);
  }
  if (p.q && clean(p.q)) query = query.or(`name.ilike.%${clean(p.q)}%,description.ilike.%${clean(p.q)}%,brand.ilike.%${clean(p.q)}%`);
  if (p.brands?.length) query = query.in("brand", p.brands);
  if (p.sizes?.length) query = query.in("product_variants.size", p.sizes);
  if (p.colors?.length) query = query.in("product_variants.color", p.colors);
  if (p.min !== undefined) query = query.gte("price", p.min);
  if (p.max !== undefined) query = query.lte("price", p.max);

  const sort = p.sort ?? "popular";
  if (sort === "price_asc") query = query.order("price");
  else if (sort === "price_desc") query = query.order("price", { ascending: false });
  else if (sort === "new") query = query.order("created_at", { ascending: false });
  else query = query.order("is_featured", { ascending: false }).order("created_at", { ascending: false });

  const from = (page - 1) * PAGE_SIZE;
  const { data, count, error } = await query
    .order("sort_order", { referencedTable: "product_images" })
    .range(from, from + PAGE_SIZE - 1);
  if (error) throw new Error(error.message);
  return { items: (data ?? []) as unknown as Product[], total: count ?? 0, page };
}

/** Секции главной: рекомендуемые, новинки, скидки. */
export async function getHomeProducts() {
  const supabase = await createClient();
  const base = () =>
    supabase.from("products").select(CARD).eq("is_active", true).order("sort_order", { referencedTable: "product_images" });
  const [featured, fresh, sale] = await Promise.all([
    base().eq("is_featured", true).order("created_at", { ascending: false }).limit(8),
    base().eq("is_new", true).order("created_at", { ascending: false }).limit(4),
    base().not("old_price", "is", null).order("created_at", { ascending: false }).limit(4),
  ]);
  const err = featured.error ?? fresh.error ?? sale.error;
  if (err) throw new Error(err.message);
  return {
    featured: featured.data as unknown as Product[],
    fresh: fresh.data as unknown as Product[],
    sale: sale.data as unknown as Product[],
  };
}

export const getFacets = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("catalog_facets");
  if (error) throw new Error(error.message);
  const f = data as { brands: string[]; sizes: string[]; colors: { name: string; hex: string }[]; min: number; max: number };
  const order = ["XS", "S", "M", "L", "XL"];
  const rank = (x: string) => order.indexOf(x);
  const sizes = [...f.sizes].sort((a, b) =>
    rank(a) >= 0 && rank(b) >= 0 ? rank(a) - rank(b) : rank(a) >= 0 ? -1 : rank(b) >= 0 ? 1 : a.localeCompare(b, "ru", { numeric: true }));
  return { ...f, sizes };
});

export const getProduct = cache(async (slug: string): Promise<ProductFull | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select(`${CARD}, product_variants(id,sku,size,color,color_hex,is_active,inventory(quantity))`)
    .eq("slug", slug)
    .eq("is_active", true)
    .order("sort_order", { referencedTable: "product_images" })
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as unknown as ProductFull | null;
});

export async function getRelated(product: Product) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select(CARD)
    .eq("is_active", true)
    .eq("category_id", product.category_id)
    .neq("id", product.id)
    .order("is_featured", { ascending: false })
    .order("sort_order", { referencedTable: "product_images" })
    .limit(4);
  if (error) throw new Error(error.message);
  return data as unknown as Product[];
}
