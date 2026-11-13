import "server-only";
import { db } from "@/lib/db";
import { all, flag, placeholders, type Row } from "@/lib/core/db";
import type { Category, Product, ProductFull, ProductImage, Variant } from "./types";

// SQLite отдаёт плоские строки: 0/1 вместо boolean, JSON строкой. Здесь они собираются в те же вложенные объекты,
// с которыми работает интерфейс (товар → фото, категория, варианты с остатками).

export const toCategory = (r: Row): Category => ({ ...(r as unknown as Category), is_active: flag(r.is_active) });

type VariantRow = Row & { product_id: string; quantity: number | null };
const toVariant = (r: VariantRow): Variant => ({
  id: r.id as string, sku: r.sku as string, size: r.size as string, color: r.color as string, color_hex: r.color_hex as string,
  is_active: flag(r.is_active), inventory: r.quantity === null ? null : { quantity: r.quantity },
});

const parseJson = (s: unknown): Record<string, string> => {
  try { return JSON.parse(String(s)) as Record<string, string>; } catch { return {}; }
};

/** Дополняет строки products фото, категорией и вариантами одним запросом на каждую связь (без запроса на каждый товар). */
export async function hydrateProducts(rows: Row[], full: true): Promise<ProductFull[]>;
export async function hydrateProducts(rows: Row[], full?: false): Promise<Product[]>;
export async function hydrateProducts(rows: Row[], full = false): Promise<Product[] | ProductFull[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id as string);
  const inIds = placeholders(ids.length);
  const [images, variants, cats] = await Promise.all([
    all<ProductImage & { product_id: string }>(db(), `select id, product_id, url, storage_path, alt, sort_order from product_images where product_id in (${inIds}) order by sort_order, created_at`, ids),
    all<VariantRow>(db(), `select pv.id, pv.product_id, pv.sku, pv.size, pv.color, pv.color_hex, pv.is_active, i.quantity from product_variants pv left join inventory i on i.variant_id = pv.id where pv.product_id in (${inIds}) order by pv.rowid`, ids),
    all<{ id: string; name: string; slug: string }>(db(), "select id, name, slug from categories"),
  ]);
  const catById = new Map(cats.map((c) => [c.id, { name: c.name, slug: c.slug }]));
  return rows.map((r) => {
    const mine = variants.filter((v) => v.product_id === r.id).map(toVariant);
    const base = {
      id: r.id, slug: r.slug, name: r.name, brand: r.brand, description: r.description, details: parseJson(r.details),
      category_id: r.category_id, price: r.price, old_price: r.old_price ?? null,
      is_featured: flag(r.is_featured), is_new: flag(r.is_new), is_active: flag(r.is_active), created_at: r.created_at,
      product_images: images.filter((i) => i.product_id === r.id).map((i) => ({ id: i.id, url: i.url, storage_path: i.storage_path, alt: i.alt, sort_order: i.sort_order })),
      categories: catById.get(r.category_id as string) ?? null,
      stock: mine.map((v) => ({ is_active: v.is_active, inventory: v.inventory })),
    } as unknown as Product;
    return full ? ({ ...base, product_variants: mine } as ProductFull) : base;
  }) as Product[] | ProductFull[];
}

/** Escape для LIKE: поиск идёт по подстроке, а не по шаблону пользователя. */
export const likeTerm = (s: string) => `%${s.toLowerCase().replace(/[\\%_]/g, "\\$&")}%`;
