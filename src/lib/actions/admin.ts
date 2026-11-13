"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import type { FormState } from "./auth";
import type { ActionResult } from "./shop";

// Каждое действие повторно проверяет роль на сервере. Даже если проверку обойти, запись заблокирует RLS.

const BUCKET = "product-images";
const MAX_BYTES = 5 * 1024 * 1024;
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif" };
const uuid = z.string().uuid();

const TR: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};
const slugify = (s: string) =>
  [...s.toLowerCase()].map((c) => TR[c] ?? c).join("").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const fail = (error: string): ActionResult => ({ ok: false, error });
/** Тексты бизнес-правил из БД (raise exception) показываем как есть, остальное скрываем. */
const dbMsg = (e: { code?: string; message: string }, fallback: string) => (e.code === "P0001" ? e.message : fallback);

// ───────── товары ─────────
const productSchema = z.object({
  name: z.string().trim().min(1, "Укажите название").max(160),
  slug: z.string().trim().max(80).optional(),
  brand: z.string().trim().min(1, "Укажите бренд").max(80),
  category_id: z.string().uuid("Выберите категорию"),
  price: z.coerce.number().min(0, "Цена не может быть отрицательной"),
  old_price: z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.number().nullable()),
  description: z.string().trim().max(4000).optional(),
  details: z.string().trim().max(2000).optional(),
});

export async function saveProduct(_: FormState, form: FormData): Promise<FormState> {
  await requireAdmin();
  const id = String(form.get("id") ?? "");
  const parsed = productSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;
  if (v.old_price !== null && v.old_price <= v.price) return { error: "Старая цена должна быть выше текущей" };
  const slug = slugify(v.slug || v.name);
  if (!slug) return { error: "Не удалось сформировать адрес страницы (slug)" };

  // Характеристики: строки вида «Ключ: значение».
  const details = Object.fromEntries(
    (v.details ?? "")
      .split(/\r?\n/)
      .map((l) => [l.slice(0, l.indexOf(":")).trim(), l.slice(l.indexOf(":") + 1).trim()])
      .filter(([k, val]) => k && val),
  );
  const row = {
    name: v.name, slug, brand: v.brand, category_id: v.category_id, price: v.price, old_price: v.old_price,
    description: v.description ?? "", details,
    is_featured: form.get("is_featured") === "on", is_new: form.get("is_new") === "on", is_active: form.get("is_active") === "on",
  };
  const supabase = await createClient();
  const res = id
    ? await supabase.from("products").update(row).eq("id", id).select("id").single()
    : await supabase.from("products").insert(row).select("id").single();
  if (res.error) return { error: res.error.code === "23505" ? "Товар с таким slug уже есть" : "Не удалось сохранить товар" };
  revalidatePath("/", "layout");
  if (!id) redirect(`/admin/products/${res.data.id}`);
  return { message: "Товар сохранён" };
}

export async function deleteProduct(id: string): Promise<ActionResult> {
  await requireAdmin();
  if (!uuid.safeParse(id).success) return fail("Некорректный товар");
  const supabase = await createClient();
  const { data: imgs } = await supabase.from("product_images").select("storage_path").eq("product_id", id);
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) return fail("Не удалось удалить товар");
  const paths = (imgs ?? []).map((i) => i.storage_path).filter((p): p is string => !!p);
  if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
  revalidatePath("/", "layout");
  return { ok: true };
}

// ───────── изображения (Storage) ─────────
function checkFile(file: FormDataEntryValue | null): File | string {
  if (!(file instanceof File) || file.size === 0) return "Выберите файл";
  if (!EXT[file.type]) return "Допустимы JPG, PNG, WebP и AVIF";
  if (file.size > MAX_BYTES) return "Файл больше 5 МБ";
  return file;
}

async function upload(productId: string, file: File) {
  const supabase = await createClient();
  const path = `${productId}/${randomUUID()}.${EXT[file.type]}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, cacheControl: "31536000" });
  if (error) return null;
  return { path, url: supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl };
}

export async function uploadProductImage(productId: string, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  if (!uuid.safeParse(productId).success) return fail("Некорректный товар");
  const file = checkFile(form.get("file"));
  if (typeof file === "string") return fail(file);
  const up = await upload(productId, file);
  if (!up) return fail("Не удалось загрузить файл");
  const supabase = await createClient();
  const { data: last } = await supabase
    .from("product_images").select("sort_order").eq("product_id", productId).order("sort_order", { ascending: false }).limit(1);
  const { error } = await supabase.from("product_images").insert({
    product_id: productId, url: up.url, storage_path: up.path, alt: String(form.get("alt") ?? ""),
    sort_order: (last?.[0]?.sort_order ?? -1) + 1,
  });
  if (error) {
    await supabase.storage.from(BUCKET).remove([up.path]);
    return fail("Не удалось сохранить фото");
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function replaceProductImage(imageId: string, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  if (!uuid.safeParse(imageId).success) return fail("Некорректное фото");
  const file = checkFile(form.get("file"));
  if (typeof file === "string") return fail(file);
  const supabase = await createClient();
  const { data: img } = await supabase.from("product_images").select("product_id,storage_path").eq("id", imageId).maybeSingle();
  if (!img) return fail("Фото не найдено");
  const up = await upload(img.product_id, file);
  if (!up) return fail("Не удалось загрузить файл");
  const { error } = await supabase.from("product_images").update({ url: up.url, storage_path: up.path }).eq("id", imageId);
  if (error) {
    await supabase.storage.from(BUCKET).remove([up.path]);
    return fail("Не удалось заменить фото");
  }
  if (img.storage_path) await supabase.storage.from(BUCKET).remove([img.storage_path]); // старый файл больше не нужен
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteProductImage(imageId: string): Promise<ActionResult> {
  await requireAdmin();
  if (!uuid.safeParse(imageId).success) return fail("Некорректное фото");
  const supabase = await createClient();
  const { data: img } = await supabase.from("product_images").select("storage_path").eq("id", imageId).maybeSingle();
  const { error } = await supabase.from("product_images").delete().eq("id", imageId);
  if (error) return fail("Не удалось удалить фото");
  if (img?.storage_path) await supabase.storage.from(BUCKET).remove([img.storage_path]);
  revalidatePath("/", "layout");
  return { ok: true };
}

// ───────── варианты и склад ─────────
export async function addVariant(_: FormState, form: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = z
    .object({
      product_id: z.string().uuid(),
      size: z.string().trim().min(1, "Укажите размер").max(20),
      color: z.string().trim().min(1, "Укажите цвет").max(40),
      color_hex: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Неверный цвет"),
      quantity: z.coerce.number().int().min(0, "Остаток не может быть отрицательным").max(100000),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;
  const supabase = await createClient();
  const { data: product } = await supabase.from("products").select("slug").eq("id", v.product_id).single();
  if (!product) return { error: "Товар не найден" };
  const sku = slugify(`${product.slug}-${v.size}-${v.color}`).toUpperCase();
  const { data, error } = await supabase
    .from("product_variants")
    .insert({ product_id: v.product_id, sku, size: v.size, color: v.color, color_hex: v.color_hex })
    .select("id").single();
  if (error) return { error: error.code === "23505" ? "Такой вариант уже есть" : "Не удалось добавить вариант" };
  await supabase.from("inventory").insert({ variant_id: data.id, quantity: v.quantity });
  revalidatePath("/", "layout");
  return { message: "Вариант добавлен" };
}

export async function deleteVariant(id: string): Promise<ActionResult> {
  await requireAdmin();
  if (!uuid.safeParse(id).success) return fail("Некорректный вариант");
  const supabase = await createClient();
  const { error } = await supabase.from("product_variants").delete().eq("id", id);
  if (error) return fail("Не удалось удалить вариант");
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Задать остаток числом: разница записывается в журнал как корректировка. */
export async function setStock(variantId: string, quantity: number): Promise<ActionResult> {
  await requireAdmin();
  if (!uuid.safeParse(variantId).success) return fail("Некорректный вариант");
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 100000) return fail("Остаток — целое число от 0 до 100000");
  const supabase = await createClient();
  const { data: cur } = await supabase.from("inventory").select("quantity").eq("variant_id", variantId).maybeSingle();
  const delta = quantity - (cur?.quantity ?? 0);
  if (delta === 0) return { ok: true };
  const { error } = await supabase.rpc("adjust_stock", { p_variant: variantId, p_delta: delta, p_reason: "adjustment", p_note: "Ручная корректировка" });
  if (error) return fail(dbMsg(error, "Не удалось обновить остаток"));
  revalidatePath("/admin", "layout");
  return { ok: true };
}

/** Приход (receipt) или списание (writeoff) с комментарием; операция атомарна и пишется в журнал. */
export async function moveStock(_: FormState, form: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = z
    .object({
      variant_id: z.string().uuid("Выберите вариант товара"),
      reason: z.enum(["receipt", "writeoff"], { message: "Выберите тип операции" }),
      quantity: z.coerce.number().int("Количество — целое число").min(1, "Количество должно быть больше нуля").max(100000),
      note: z.string().trim().max(200).optional(),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("adjust_stock", {
    p_variant: v.variant_id, p_delta: v.reason === "receipt" ? v.quantity : -v.quantity, p_reason: v.reason, p_note: v.note ?? "",
  });
  if (error) return { error: dbMsg(error, "Не удалось выполнить операцию") };
  revalidatePath("/admin", "layout");
  return { message: `Готово. Остаток теперь ${data} шт.` };
}

export async function setVariantActive(id: string, active: boolean): Promise<ActionResult> {
  await requireAdmin();
  if (!uuid.safeParse(id).success) return fail("Некорректный вариант");
  const supabase = await createClient();
  const { error } = await supabase.from("product_variants").update({ is_active: active }).eq("id", id);
  if (error) return fail("Не удалось изменить вариант");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function setProductActive(id: string, active: boolean): Promise<ActionResult> {
  await requireAdmin();
  if (!uuid.safeParse(id).success) return fail("Некорректный товар");
  const supabase = await createClient();
  const { error } = await supabase.from("products").update({ is_active: active }).eq("id", id);
  if (error) return fail("Не удалось изменить товар");
  revalidatePath("/", "layout");
  return { ok: true };
}

// ───────── категории ─────────
export async function saveCategory(_: FormState, form: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = z
    .object({
      id: z.string().optional(),
      name: z.string().trim().min(1, "Укажите название").max(80),
      slug: z.string().trim().max(60).optional(),
      description: z.string().trim().max(300).optional(),
      sort_order: z.coerce.number().int().min(0).max(1000).default(0),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;
  const slug = slugify(v.slug || v.name);
  if (!slug) return { error: "Не удалось сформировать slug" };
  const row = { name: v.name, slug, description: v.description ?? "", sort_order: v.sort_order, is_active: form.get("is_active") === "on" };
  const supabase = await createClient();
  const { error } = v.id
    ? await supabase.from("categories").update(row).eq("id", v.id)
    : await supabase.from("categories").insert(row);
  if (error) return { error: error.code === "23505" ? "Категория с таким slug уже есть" : "Не удалось сохранить категорию" };
  revalidatePath("/", "layout");
  return { message: "Категория сохранена" };
}

export async function deleteCategory(id: string): Promise<ActionResult> {
  await requireAdmin();
  if (!uuid.safeParse(id).success) return fail("Некорректная категория");
  const supabase = await createClient();
  const { error } = await supabase.from("categories").delete().eq("id", id);
  if (error) return fail(error.code === "23503" ? "В категории есть товары. Сначала перенесите или удалите их." : "Не удалось удалить категорию");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function uploadCategoryImage(id: string, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  if (!uuid.safeParse(id).success) return fail("Некорректная категория");
  const file = checkFile(form.get("file"));
  if (typeof file === "string") return fail(file);
  const supabase = await createClient();
  const { data: cat } = await supabase.from("categories").select("image_url").eq("id", id).maybeSingle();
  if (!cat) return fail("Категория не найдена");
  const path = `categories/${id}/${randomUUID()}.${EXT[file.type]}`;
  const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, cacheControl: "31536000" });
  if (up.error) return fail("Не удалось загрузить файл");
  const url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  const { error } = await supabase.from("categories").update({ image_url: url }).eq("id", id);
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]);
    return fail("Не удалось сохранить изображение");
  }
  const old = cat.image_url?.split(`/${BUCKET}/`)[1]; // внешние URL (Unsplash) в Storage не удаляем
  if (old?.startsWith("categories/")) await supabase.storage.from(BUCKET).remove([old]);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeCategoryImage(id: string): Promise<ActionResult> {
  await requireAdmin();
  if (!uuid.safeParse(id).success) return fail("Некорректная категория");
  const supabase = await createClient();
  const { data: cat } = await supabase.from("categories").select("image_url").eq("id", id).maybeSingle();
  const { error } = await supabase.from("categories").update({ image_url: null }).eq("id", id);
  if (error) return fail("Не удалось убрать изображение");
  const old = cat?.image_url?.split(`/${BUCKET}/`)[1];
  if (old?.startsWith("categories/")) await supabase.storage.from(BUCKET).remove([old]);
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Сдвигает категорию вверх/вниз и перенумеровывает порядок целиком, чтобы одинаковых значений не оставалось. */
export async function moveCategory(id: string, direction: "up" | "down"): Promise<ActionResult> {
  await requireAdmin();
  if (!uuid.safeParse(id).success || !["up", "down"].includes(direction)) return fail("Некорректные данные");
  const supabase = await createClient();
  const { data, error } = await supabase.from("categories").select("id").order("sort_order").order("name");
  if (error || !data) return fail("Не удалось получить категории");
  const ids = data.map((c) => c.id);
  const i = ids.indexOf(id);
  const j = direction === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= ids.length) return { ok: true };
  [ids[i], ids[j]] = [ids[j], ids[i]];
  const results = await Promise.all(ids.map((cid, k) => supabase.from("categories").update({ sort_order: k }).eq("id", cid)));
  if (results.some((r) => r.error)) return fail("Не удалось изменить порядок");
  revalidatePath("/", "layout");
  return { ok: true };
}

// ───────── заказы ─────────
export async function setOrderStatus(id: string, status: string): Promise<ActionResult> {
  await requireAdmin();
  const s = z.enum(["pending", "paid", "processing", "shipped", "delivered", "cancelled"]).safeParse(status);
  if (!uuid.safeParse(id).success || !s.success) return fail("Некорректные данные");
  const supabase = await createClient();
  const { error } = await supabase.from("orders").update({ status: s.data }).eq("id", id);
  if (error) return fail(dbMsg(error, "Не удалось обновить статус"));
  revalidatePath("/admin", "layout");
  revalidatePath("/account", "layout");
  return { ok: true };
}

// ───────── промокоды ─────────
export async function savePromo(_: FormState, form: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = z
    .object({
      id: z.string().optional(),
      expires_at: z.string().optional(),
      code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,32}$/, "Код: 3–32 символа, латиница и цифры"),
      description: z.string().trim().max(200).optional(),
      kind: z.enum(["percent", "amount"]),
      value: z.coerce.number().positive("Укажите размер скидки"),
      min_order_total: z.coerce.number().min(0).default(0),
      max_uses: z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.number().int().positive().nullable()),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;
  if (v.kind === "percent" && (v.value > 90 || !Number.isInteger(v.value))) return { error: "Процент — целое число от 1 до 90" };
  const expires = v.expires_at ? new Date(`${v.expires_at}T23:59:59`) : null;
  if (expires && Number.isNaN(expires.getTime())) return { error: "Неверная дата окончания" };
  const row = {
    code: v.code, description: v.description ?? "", min_order_total: v.min_order_total, max_uses: v.max_uses,
    discount_percent: v.kind === "percent" ? v.value : null,
    discount_amount: v.kind === "amount" ? v.value : null,
    expires_at: expires ? expires.toISOString() : null,
  };
  const supabase = await createClient();
  const { error } = v.id
    ? await supabase.from("promo_codes").update(row).eq("id", v.id)
    : await supabase.from("promo_codes").insert(row);
  if (error) return { error: error.code === "23505" ? "Такой промокод уже есть" : "Не удалось сохранить промокод" };
  revalidatePath("/admin/promos");
  return { message: v.id ? "Промокод сохранён" : "Промокод создан" };
}

export async function setPromoActive(id: string, active: boolean): Promise<ActionResult> {
  await requireAdmin();
  if (!uuid.safeParse(id).success) return fail("Некорректный промокод");
  const supabase = await createClient();
  const { error } = await supabase.from("promo_codes").update({ is_active: active }).eq("id", id);
  if (error) return fail("Не удалось обновить промокод");
  revalidatePath("/admin/promos");
  return { ok: true };
}

export async function deletePromo(id: string): Promise<ActionResult> {
  await requireAdmin();
  if (!uuid.safeParse(id).success) return fail("Некорректный промокод");
  const supabase = await createClient();
  const { error } = await supabase.from("promo_codes").delete().eq("id", id);
  if (error) return fail("Не удалось удалить промокод");
  revalidatePath("/admin/promos");
  return { ok: true };
}

// ───────── клиенты ─────────
export async function setUserRole(id: string, role: "customer" | "admin"): Promise<ActionResult> {
  const me = await requireAdmin();
  if (!uuid.safeParse(id).success || !["customer", "admin"].includes(role)) return fail("Некорректные данные");
  if (id === me.id) return fail("Нельзя менять собственную роль");
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ role }).eq("id", id);
  if (error) return fail("Не удалось изменить роль");
  revalidatePath("/admin/customers");
  return { ok: true };
}
