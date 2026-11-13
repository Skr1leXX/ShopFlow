import fs from "node:fs";
import { admin, createUser } from "./db";
import { STATE_FILE, hasBackend, type State } from "./env";

/**
 * Создаёт изолированные тестовые данные (префикс E2E): 2 пользователя, категорию, 15 товаров с известными
 * ценами, брендами, размерами, цветами и остатками, промокод. Реальный каталог не затрагивается.
 */
export default async function globalSetup() {
  if (!hasBackend) return;
  const db = admin();
  const run = Date.now().toString(36);
  const state: State = {
    run,
    admin: await createUser(db, `e2e-admin-${run}@shopflow.test`, "E2E Админ", "admin"),
    customer: await createUser(db, `e2e-customer-${run}@shopflow.test`, "E2E Покупатель"),
    products: {},
    categoryId: "",
    categoryName: `E2E Категория ${run}`,
    promo: `E2E${run}`.toUpperCase().slice(0, 12),
  };

  const cat = await db.from("categories").insert({ slug: `e2e-${run}`, name: state.categoryName, sort_order: 900 }).select("id").single();
  if (cat.error) throw cat.error;
  state.categoryId = cat.data.id;

  // Именованные товары для точных проверок.
  const named = [
    { key: "tee", name: `E2E Футболка ${run}`, brand: "E2EBrandA", price: 2000, old: 2500, desc: "уникальноеслово-хлопок", color: ["Красный", "#c8342b"], stock: 5 },
    { key: "jacket", name: `E2E Куртка ${run}`, brand: "E2EBrandB", price: 9000, old: null, desc: "тёплая куртка", color: ["Синий", "#1f2a44"], stock: 3 },
    { key: "cap", name: `E2E Кепка ${run}`, brand: "E2EBrandA", price: 1000, old: null, desc: "кепка", color: ["Красный", "#c8342b"], stock: 20 },
  ];
  for (const [i, n] of named.entries()) {
    const p = await db.from("products").insert({
      slug: `e2e-${n.key}-${run}`, name: n.name, brand: n.brand, description: n.desc, category_id: state.categoryId,
      price: n.price, old_price: n.old, is_featured: true,
    }).select("id,slug").single();
    if (p.error) throw p.error;
    await db.from("product_images").insert({ product_id: p.data.id, url: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=800&q=60", alt: n.name, sort_order: 0 }).throwOnError();
    const vs = await db.from("product_variants").insert([
      { product_id: p.data.id, sku: `E2E-${run}-${n.key}-M`.toUpperCase(), size: "M", color: n.color[0], color_hex: n.color[1] },
      { product_id: p.data.id, sku: `E2E-${run}-${n.key}-L`.toUpperCase(), size: "L", color: n.color[0], color_hex: n.color[1] },
    ]).select("id,size");
    if (vs.error) throw vs.error;
    const m = vs.data.find((v) => v.size === "M")!, l = vs.data.find((v) => v.size === "L")!;
    // Размер L намеренно закончился: проверяем «нет в наличии».
    await db.from("inventory").insert([{ variant_id: m.id, quantity: n.stock }, { variant_id: l.id, quantity: 0 }]).throwOnError();
    state.products[n.key] = { id: p.data.id, slug: p.data.slug, name: n.name, variantM: m.id, variantL: l.id };
    void i;
  }

  // 12 дополнительных товаров + 3 именованных = 15: гарантированно две страницы пагинации (12 на странице).
  for (let i = 1; i <= 12; i++) {
    const p = await db.from("products").insert({
      slug: `e2e-bulk-${i}-${run}`, name: `E2E Массовый ${String(i).padStart(2, "0")} ${run}`, brand: "E2EBulk",
      description: "массовый товар", category_id: state.categoryId, price: 500 + i,
    }).select("id").single();
    if (p.error) throw p.error;
    const v = await db.from("product_variants").insert({ product_id: p.data.id, sku: `E2E-${run}-B${i}`, size: "S", color: "Серый", color_hex: "#9a9a9e" }).select("id").single();
    await db.from("inventory").insert({ variant_id: v.data!.id, quantity: 10 }).throwOnError();
  }

  await db.from("promo_codes").insert({ code: state.promo, description: "E2E", discount_percent: 10, min_order_total: 1000 }).throwOnError();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}
