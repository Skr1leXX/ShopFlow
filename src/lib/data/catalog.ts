import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";
import { all, one, placeholders } from "@/lib/core/db";
import { hydrateProducts, likeTerm, toCategory } from "./shape";
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

export const getCategories = cache(async (): Promise<Category[]> => {
  return (await all(db(), "select * from categories where is_active = 1 order by sort_order, name")).map(toCategory);
});

const ORDER: Record<SortKey, string> = {
  popular: "p.is_featured desc, p.created_at desc, p.id",
  new: "p.created_at desc, p.id",
  price_asc: "p.price, p.id",
  price_desc: "p.price desc, p.id",
};

export async function getProducts(p: CatalogParams = {}) {
  const page = Math.max(1, p.page ?? 1);
  const where = ["p.is_active = 1"];
  const args: (string | number)[] = [];
  if (p.category) {
    const cat = await one<{ id: string }>(db(), "select id from categories where slug = ?", [p.category]);
    if (!cat) return { items: [] as Product[], total: 0, page };
    where.push("p.category_id = ?"); args.push(cat.id);
  }
  if (p.q?.trim()) { where.push("p.search like ? escape '\\'"); args.push(likeTerm(p.q.trim())); }
  if (p.brands?.length) { where.push(`p.brand in (${placeholders(p.brands.length)})`); args.push(...p.brands); }
  if (p.min !== undefined) { where.push("p.price >= ?"); args.push(p.min); }
  if (p.max !== undefined) { where.push("p.price <= ?"); args.push(p.max); }
  if (p.sizes?.length || p.colors?.length) {
    const v = ["v.product_id = p.id"];
    if (p.sizes?.length) { v.push(`v.size in (${placeholders(p.sizes.length)})`); args.push(...p.sizes); }
    if (p.colors?.length) { v.push(`v.color in (${placeholders(p.colors.length)})`); args.push(...p.colors); }
    where.push(`exists (select 1 from product_variants v where ${v.join(" and ")})`);
  }
  const clause = where.join(" and ");
  const total = (await one<{ n: number }>(db(), `select count(*) n from products p where ${clause}`, args))!.n;
  const rows = await all(
    db(),
    `select p.* from products p where ${clause} order by ${ORDER[p.sort ?? "popular"] ?? ORDER.popular} limit ? offset ?`,
    [...args, PAGE_SIZE, (page - 1) * PAGE_SIZE],
  );
  return { items: await hydrateProducts(rows), total, page };
}

/** Секции главной: рекомендуемые, новинки, скидки. */
export async function getHomeProducts() {
  const pick = async (cond: string, limit: number) =>
    hydrateProducts(await all(db(), `select * from products where is_active = 1 and ${cond} order by created_at desc, id limit ?`, [limit]));
  const [featured, fresh, sale] = await Promise.all([pick("is_featured = 1", 8), pick("is_new = 1", 4), pick("old_price is not null", 4)]);
  return { featured, fresh, sale };
}

export const getFacets = cache(async () => {
  const [brands, sizes, colors, price] = await Promise.all([
    all<{ brand: string }>(db(), "select distinct brand from products where is_active = 1 order by brand"),
    all<{ size: string }>(db(), "select distinct v.size from product_variants v join products p on p.id = v.product_id where v.is_active = 1 and p.is_active = 1"),
    all<{ name: string; hex: string }>(db(), "select v.color name, v.color_hex hex from product_variants v join products p on p.id = v.product_id where v.is_active = 1 and p.is_active = 1 group by v.color order by v.color"),
    one<{ lo: number | null; hi: number | null }>(db(), "select min(price) lo, max(price) hi from products where is_active = 1"),
  ]);
  const order = ["XS", "S", "M", "L", "XL"];
  const rank = (x: string) => order.indexOf(x);
  const names = sizes.map((s) => s.size).sort((a, b) =>
    rank(a) >= 0 && rank(b) >= 0 ? rank(a) - rank(b) : rank(a) >= 0 ? -1 : rank(b) >= 0 ? 1 : a.localeCompare(b, "ru", { numeric: true }));
  return { brands: brands.map((b) => b.brand), sizes: names, colors, min: Math.floor(price?.lo ?? 0), max: Math.ceil(price?.hi ?? 0) };
});

export const getProduct = cache(async (slug: string): Promise<ProductFull | null> => {
  const row = await one(db(), "select * from products where slug = ? and is_active = 1", [slug]);
  return row ? (await hydrateProducts([row], true))[0] : null;
});

export async function getRelated(product: Product) {
  return hydrateProducts(
    await all(db(), "select * from products where is_active = 1 and category_id = ? and id <> ? order by is_featured desc, created_at desc limit 4", [product.category_id, product.id]),
  );
}
