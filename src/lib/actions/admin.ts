"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { del, put } from "@vercel/blob";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { all, BizError, isUnique, nowIso, one, write } from "@/lib/core/db";
import { adjustStock, setOrderStatus as changeOrderStatus } from "@/lib/core/orders";
import { changeStock } from "@/lib/core/stock";
import type { FormState } from "./auth";
import type { ActionResult } from "./shop";

// Каждое действие первым делом проверяет роль в базе на сервере (requireAdmin). Роль из браузера не принимается никогда.

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
/** Тексты бизнес-правил (BizError) показываем как есть, остальное скрываем. */
const msg = (e: unknown, fallback: string) => (e instanceof BizError ? e.message : fallback);
const searchText = (name: string, brand: string, description: string) => `${name} ${brand} ${description}`.toLowerCase();

// ───────── файлы (Vercel Blob) ─────────
const isBlobUrl = (u: string | null | undefined): u is string => !!u && /\.blob\.vercel-storage\.com\//.test(u);

/** Удаляет загруженные файлы; внешние ссылки (Unsplash) не трогаем. Ошибка удаления не должна ломать действие. */
async function removeBlobs(urls: (string | null | undefined)[]) {
  const mine = urls.filter(isBlobUrl);
  if (mine.length) await del(mine).catch(() => undefined);
}

function checkFile(file: FormDataEntryValue | null): File | string {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return "Загрузка фото не настроена: задайте BLOB_READ_WRITE_TOKEN (Vercel Blob) или укажите ссылку на фото.";
  if (!(file instanceof File) || file.size === 0) return "Выберите файл";
  if (!EXT[file.type]) return "Допустимы JPG, PNG, WebP и AVIF";
  if (file.size > MAX_BYTES) return "Файл больше 5 МБ";
  return file;
}

async function upload(folder: string, file: File): Promise<string | null> {
  try {
    const blob = await put(`${folder}/${randomUUID()}.${EXT[file.type]}`, file, { access: "public", contentType: file.type });
    return blob.url;
  } catch {
    return null;
  }
}

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
  const flags = [form.get("is_featured") === "on" ? 1 : 0, form.get("is_new") === "on" ? 1 : 0, form.get("is_active") === "on" ? 1 : 0];
  const common = [v.name, slug, v.brand, v.category_id, v.price, v.old_price, v.description ?? "", JSON.stringify(details), searchText(v.name, v.brand, v.description ?? ""), ...flags];
  const newId = id || randomUUID();
  try {
    if (id) {
      const res = await db().execute({
        sql: `update products set name = ?, slug = ?, brand = ?, category_id = ?, price = ?, old_price = ?, description = ?, details = ?, search = ?,
              is_featured = ?, is_new = ?, is_active = ?, updated_at = ? where id = ?`,
        args: [...common, nowIso(), id],
      });
      if (!res.rowsAffected) return { error: "Товар не найден" };
    } else {
      await db().execute({
        sql: `insert into products (id, name, slug, brand, category_id, price, old_price, description, details, search, is_featured, is_new, is_active)
              values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [newId, ...common],
      });
    }
  } catch (e) {
    return { error: isUnique(e) ? "Товар с таким slug уже есть" : "Не удалось сохранить товар" };
  }
  revalidatePath("/", "layout");
  if (!id) redirect(`/admin/products/${newId}`);
  return { message: "Товар сохранён" };
}

/** Удаляет варианты вместе с остатками, журналом и позициями корзин. В истории заказов остаются снимки названий и цен. */
const DROP_VARIANTS_OF = "(select id from product_variants where product_id = ?)";

export async function deleteProduct(id: string): Promise<ActionResult> {
  await requireAdmin();
  if (!uuid.safeParse(id).success) return fail("Некорректный товар");
  let files: string[] = [];
  try {
    await write(db(), async (tx) => {
      files = (await all<{ storage_path: string | null }>(tx, "select storage_path from product_images where product_id = ?", [id])).flatMap((i) => (i.storage_path ? [i.storage_path] : []));
      for (const sql of [
        `delete from cart_items where variant_id in ${DROP_VARIANTS_OF}`,
        `update order_items set variant_id = null where variant_id in ${DROP_VARIANTS_OF}`,
        `delete from inventory_movements where variant_id in ${DROP_VARIANTS_OF}`,
        `delete from inventory where variant_id in ${DROP_VARIANTS_OF}`,
        "delete from product_variants where product_id = ?",
        "update order_items set product_id = null where product_id = ?",
        "delete from product_images where product_id = ?",
        "delete from favorites where product_id = ?",
        "delete from products where id = ?",
      ]) await tx.execute({ sql, args: [id] });
    });
  } catch {
    return fail("Не удалось удалить товар");
  }
  await removeBlobs(files);
  revalidatePath("/", "layout");
  return { ok: true };
}

// ───────── изображения ─────────
export async function uploadProductImage(productId: string, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  if (!uuid.safeParse(productId).success) return fail("Некорректный товар");
  const file = checkFile(form.get("file"));
  if (typeof file === "string") return fail(file);
  const url = await upload(`products/${productId}`, file);
  if (!url) return fail("Не удалось загрузить файл");
  try {
    await db().execute({
      sql: `insert into product_images (id, product_id, url, storage_path, alt, sort_order)
            values (?, ?, ?, ?, ?, (select coalesce(max(sort_order), -1) + 1 from product_images where product_id = ?))`,
      args: [randomUUID(), productId, url, url, String(form.get("alt") ?? ""), productId],
    });
  } catch {
    await removeBlobs([url]);
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
  const img = await one<{ product_id: string; storage_path: string | null }>(db(), "select product_id, storage_path from product_images where id = ?", [imageId]);
  if (!img) return fail("Фото не найдено");
  const url = await upload(`products/${img.product_id}`, file);
  if (!url) return fail("Не удалось загрузить файл");
  try {
    await db().execute({ sql: "update product_images set url = ?, storage_path = ? where id = ?", args: [url, url, imageId] });
  } catch {
    await removeBlobs([url]);
    return fail("Не удалось заменить фото");
  }
  await removeBlobs([img.storage_path]); // старый файл больше не нужен
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteProductImage(imageId: string): Promise<ActionResult> {
  await requireAdmin();
  if (!uuid.safeParse(imageId).success) return fail("Некорректное фото");
  const img = await one<{ storage_path: string | null }>(db(), "select storage_path from product_images where id = ?", [imageId]);
  try {
    await db().execute({ sql: "delete from product_images where id = ?", args: [imageId] });
  } catch {
    return fail("Не удалось удалить фото");
  }
  await removeBlobs([img?.storage_path]);
  revalidatePath("/", "layout");
  return { ok: true };
}

// ───────── варианты и склад ─────────
export async function addVariant(_: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin();
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
  const product = await one<{ slug: string }>(db(), "select slug from products where id = ?", [v.product_id]);
  if (!product) return { error: "Товар не найден" };
  const sku = slugify(`${product.slug}-${v.size}-${v.color}`).toUpperCase();
  try {
    await write(db(), async (tx) => {
      const variantId = randomUUID();
      await tx.execute({
        sql: "insert into product_variants (id, product_id, sku, size, color, color_hex) values (?, ?, ?, ?, ?, ?)",
        args: [variantId, v.product_id, sku, v.size, v.color, v.color_hex],
      });
      await tx.execute({ sql: "insert into inventory (variant_id, quantity) values (?, 0)", args: [variantId] });
      if (v.quantity > 0) await changeStock(tx, variantId, v.quantity, "adjustment", { note: "Начальный остаток", userId: admin.id });
    });
  } catch (e) {
    return { error: isUnique(e) ? "Такой вариант уже есть" : "Не удалось добавить вариант" };
  }
  revalidatePath("/", "layout");
  return { message: "Вариант добавлен" };
}

export async function deleteVariant(id: string): Promise<ActionResult> {
  await requireAdmin();
  if (!uuid.safeParse(id).success) return fail("Некорректный вариант");
  try {
    await write(db(), async (tx) => {
      for (const sql of [
        "delete from cart_items where variant_id = ?",
        "update order_items set variant_id = null where variant_id = ?",
        "delete from inventory_movements where variant_id = ?",
        "delete from inventory where variant_id = ?",
        "delete from product_variants where id = ?",
      ]) await tx.execute({ sql, args: [id] });
    });
  } catch {
    return fail("Не удалось удалить вариант");
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Задать остаток числом: разница записывается в журнал как корректировка. */
export async function setStock(variantId: string, quantity: number): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!uuid.safeParse(variantId).success) return fail("Некорректный вариант");
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 100000) return fail("Остаток — целое число от 0 до 100000");
  const cur = await one<{ quantity: number }>(db(), "select quantity from inventory where variant_id = ?", [variantId]);
  const delta = quantity - (cur?.quantity ?? 0);
  if (delta === 0) return { ok: true };
  try {
    await adjustStock(db(), { variantId, delta, reason: "adjustment", note: "Ручная корректировка", userId: admin.id });
  } catch (e) {
    return fail(msg(e, "Не удалось обновить остаток"));
  }
  revalidatePath("/admin", "layout");
  return { ok: true };
}

/** Приход (receipt) или списание (writeoff) с комментарием; операция атомарна и пишется в журнал. */
export async function moveStock(_: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin();
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
  try {
    const balance = await adjustStock(db(), {
      variantId: v.variant_id, delta: v.reason === "receipt" ? v.quantity : -v.quantity, reason: v.reason, note: v.note ?? "", userId: admin.id,
    });
    revalidatePath("/admin", "layout");
    return { message: `Готово. Остаток теперь ${balance} шт.` };
  } catch (e) {
    return { error: msg(e, "Не удалось выполнить операцию") };
  }
}

export async function setVariantActive(id: string, active: boolean): Promise<ActionResult> {
  await requireAdmin();
  if (!uuid.safeParse(id).success) return fail("Некорректный вариант");
  try {
    await db().execute({ sql: "update product_variants set is_active = ? where id = ?", args: [active ? 1 : 0, id] });
  } catch {
    return fail("Не удалось изменить вариант");
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function setProductActive(id: string, active: boolean): Promise<ActionResult> {
  await requireAdmin();
  if (!uuid.safeParse(id).success) return fail("Некорректный товар");
  try {
    await db().execute({ sql: "update products set is_active = ?, updated_at = ? where id = ?", args: [active ? 1 : 0, nowIso(), id] });
  } catch {
    return fail("Не удалось изменить товар");
  }
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
  const active = form.get("is_active") === "on" ? 1 : 0;
  try {
    if (v.id) {
      await db().execute({
        sql: "update categories set name = ?, slug = ?, description = ?, sort_order = ?, is_active = ? where id = ?",
        args: [v.name, slug, v.description ?? "", v.sort_order, active, v.id],
      });
    } else {
      await db().execute({
        sql: "insert into categories (id, name, slug, description, sort_order, is_active) values (?, ?, ?, ?, ?, ?)",
        args: [randomUUID(), v.name, slug, v.description ?? "", v.sort_order, active],
      });
    }
  } catch (e) {
    return { error: isUnique(e) ? "Категория с таким slug уже есть" : "Не удалось сохранить категорию" };
  }
  revalidatePath("/", "layout");
  return { message: "Категория сохранена" };
}

export async function deleteCategory(id: string): Promise<ActionResult> {
  await requireAdmin();
  if (!uuid.safeParse(id).success) return fail("Некорректная категория");
  const cat = await one<{ n: number; image_url: string | null }>(
    db(), "select (select count(*) from products where category_id = c.id) n, image_url from categories c where id = ?", [id],
  );
  if (!cat) return fail("Категория не найдена");
  if (cat.n > 0) return fail("В категории есть товары. Сначала перенесите или удалите их.");
  try {
    await db().execute({ sql: "delete from categories where id = ?", args: [id] });
  } catch {
    return fail("Не удалось удалить категорию");
  }
  await removeBlobs([cat.image_url]);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function uploadCategoryImage(id: string, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  if (!uuid.safeParse(id).success) return fail("Некорректная категория");
  const file = checkFile(form.get("file"));
  if (typeof file === "string") return fail(file);
  const cat = await one<{ image_url: string | null }>(db(), "select image_url from categories where id = ?", [id]);
  if (!cat) return fail("Категория не найдена");
  const url = await upload(`categories/${id}`, file);
  if (!url) return fail("Не удалось загрузить файл");
  try {
    await db().execute({ sql: "update categories set image_url = ? where id = ?", args: [url, id] });
  } catch {
    await removeBlobs([url]);
    return fail("Не удалось сохранить изображение");
  }
  await removeBlobs([cat.image_url]);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeCategoryImage(id: string): Promise<ActionResult> {
  await requireAdmin();
  if (!uuid.safeParse(id).success) return fail("Некорректная категория");
  const cat = await one<{ image_url: string | null }>(db(), "select image_url from categories where id = ?", [id]);
  try {
    await db().execute({ sql: "update categories set image_url = null where id = ?", args: [id] });
  } catch {
    return fail("Не удалось убрать изображение");
  }
  await removeBlobs([cat?.image_url]);
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Сдвигает категорию вверх/вниз и перенумеровывает порядок целиком, чтобы одинаковых значений не оставалось. */
export async function moveCategory(id: string, direction: "up" | "down"): Promise<ActionResult> {
  await requireAdmin();
  if (!uuid.safeParse(id).success || !["up", "down"].includes(direction)) return fail("Некорректные данные");
  try {
    await write(db(), async (tx) => {
      const ids = (await all<{ id: string }>(tx, "select id from categories order by sort_order, name")).map((c) => c.id);
      const i = ids.indexOf(id);
      const j = direction === "up" ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      for (const [k, cid] of ids.entries()) await tx.execute({ sql: "update categories set sort_order = ? where id = ?", args: [k, cid] });
    });
  } catch {
    return fail("Не удалось изменить порядок");
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

// ───────── заказы ─────────
export async function setOrderStatus(id: string, status: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  const s = z.enum(["pending", "paid", "processing", "shipped", "delivered", "cancelled"]).safeParse(status);
  if (!uuid.safeParse(id).success || !s.success) return fail("Некорректные данные");
  try {
    await changeOrderStatus(db(), id, s.data, admin.id);
  } catch (e) {
    return fail(msg(e, "Не удалось обновить статус"));
  }
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
  const fields = [
    v.code, v.description ?? "", v.min_order_total, v.max_uses,
    v.kind === "percent" ? v.value : null, v.kind === "amount" ? v.value : null, expires ? expires.toISOString() : null,
  ];
  try {
    if (v.id) {
      await db().execute({
        sql: "update promo_codes set code = ?, description = ?, min_order_total = ?, max_uses = ?, discount_percent = ?, discount_amount = ?, expires_at = ? where id = ?",
        args: [...fields, v.id],
      });
    } else {
      await db().execute({
        sql: "insert into promo_codes (code, description, min_order_total, max_uses, discount_percent, discount_amount, expires_at, id) values (?, ?, ?, ?, ?, ?, ?, ?)",
        args: [...fields, randomUUID()],
      });
    }
  } catch (e) {
    return { error: isUnique(e) ? "Такой промокод уже есть" : "Не удалось сохранить промокод" };
  }
  revalidatePath("/admin/promos");
  return { message: v.id ? "Промокод сохранён" : "Промокод создан" };
}

export async function setPromoActive(id: string, active: boolean): Promise<ActionResult> {
  await requireAdmin();
  if (!uuid.safeParse(id).success) return fail("Некорректный промокод");
  try {
    await db().execute({ sql: "update promo_codes set is_active = ? where id = ?", args: [active ? 1 : 0, id] });
  } catch {
    return fail("Не удалось обновить промокод");
  }
  revalidatePath("/admin/promos");
  return { ok: true };
}

export async function deletePromo(id: string): Promise<ActionResult> {
  await requireAdmin();
  if (!uuid.safeParse(id).success) return fail("Некорректный промокод");
  try {
    await write(db(), async (tx) => {
      await tx.execute({ sql: "update orders set promo_code_id = null where promo_code_id = ?", args: [id] });
      await tx.execute({ sql: "delete from promo_codes where id = ?", args: [id] });
    });
  } catch {
    return fail("Не удалось удалить промокод");
  }
  revalidatePath("/admin/promos");
  return { ok: true };
}

// ───────── клиенты ─────────
export async function setUserRole(id: string, role: "customer" | "admin"): Promise<ActionResult> {
  const me = await requireAdmin();
  if (!uuid.safeParse(id).success || !["customer", "admin"].includes(role)) return fail("Некорректные данные");
  if (id === me.id) return fail("Нельзя менять собственную роль");
  try {
    await db().execute({ sql: "update profiles set role = ?, updated_at = ? where id = ?", args: [role, nowIso(), id] });
  } catch {
    return fail("Не удалось изменить роль");
  }
  revalidatePath("/admin/customers");
  return { ok: true };
}
