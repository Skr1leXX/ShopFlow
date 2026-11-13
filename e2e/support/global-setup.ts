import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { createUser, sqlRun } from "./db";
import { STATE_FILE, hasBackend, type State } from "./env";

const IMG = "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=800&q=60";

/**
 * Применяет миграции и создаёт изолированные тестовые данные (префикс E2E): 2 пользователя, категорию, 15 товаров
 * с известными ценами, брендами, размерами, цветами и остатками, промокод. Реальный каталог не затрагивается.
 */
export default async function globalSetup() {
  if (!hasBackend) return;
  execFileSync(process.execPath, ["scripts/migrate.mjs"], { stdio: "ignore" });
  const run = Date.now().toString(36);
  const state: State = {
    run,
    admin: await createUser(`e2e-admin-${run}@shopflow.test`, "E2E Админ", "admin"),
    customer: await createUser(`e2e-customer-${run}@shopflow.test`, "E2E Покупатель"),
    products: {},
    categoryId: crypto.randomUUID(),
    categoryName: `E2E Категория ${run}`,
    promo: `E2E${run}`.toUpperCase().slice(0, 12),
  };
  await sqlRun("insert into categories (id, slug, name, sort_order) values (?, ?, ?, 900)", [state.categoryId, `e2e-${run}`, state.categoryName]);

  const addProduct = async (slug: string, name: string, brand: string, desc: string, price: number, old: number | null, featured: number) => {
    const id = crypto.randomUUID();
    await sqlRun(
      "insert into products (id, slug, name, brand, description, search, category_id, price, old_price, is_featured) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [id, slug, name, brand, desc, `${name} ${brand} ${desc}`.toLowerCase(), state.categoryId, price, old, featured],
    );
    return id;
  };
  const addVariant = async (productId: string, sku: string, size: string, color: string, hex: string, qty: number) => {
    const id = crypto.randomUUID();
    await sqlRun("insert into product_variants (id, product_id, sku, size, color, color_hex) values (?, ?, ?, ?, ?, ?)", [id, productId, sku, size, color, hex]);
    await sqlRun("insert into inventory (variant_id, quantity) values (?, ?)", [id, qty]);
    return id;
  };

  // Именованные товары для точных проверок.
  const named = [
    { key: "tee", name: `E2E Футболка ${run}`, brand: "E2EBrandA", price: 2000, old: 2500, desc: "уникальноеслово-хлопок", color: ["Красный", "#c8342b"], stock: 5 },
    { key: "jacket", name: `E2E Куртка ${run}`, brand: "E2EBrandB", price: 9000, old: null, desc: "тёплая куртка", color: ["Синий", "#1f2a44"], stock: 3 },
    { key: "cap", name: `E2E Кепка ${run}`, brand: "E2EBrandA", price: 1000, old: null, desc: "кепка", color: ["Красный", "#c8342b"], stock: 20 },
  ];
  for (const n of named) {
    const slug = `e2e-${n.key}-${run}`;
    const id = await addProduct(slug, n.name, n.brand, n.desc, n.price, n.old, 1);
    await sqlRun("insert into product_images (id, product_id, url, alt, sort_order) values (?, ?, ?, ?, 0)", [crypto.randomUUID(), id, IMG, n.name]);
    const m = await addVariant(id, `E2E-${run}-${n.key}-M`.toUpperCase(), "M", n.color[0], n.color[1], n.stock);
    // Размер L намеренно закончился: проверяем «нет в наличии».
    const l = await addVariant(id, `E2E-${run}-${n.key}-L`.toUpperCase(), "L", n.color[0], n.color[1], 0);
    state.products[n.key] = { id, slug, name: n.name, variantM: m, variantL: l };
  }

  // 12 дополнительных товаров + 3 именованных = 15: гарантированно две страницы пагинации (12 на странице).
  for (let i = 1; i <= 12; i++) {
    const id = await addProduct(`e2e-bulk-${i}-${run}`, `E2E Массовый ${String(i).padStart(2, "0")} ${run}`, "E2EBulk", "массовый товар", 500 + i, null, 0);
    await sqlRun("insert into product_images (id, product_id, url, alt, sort_order) values (?, ?, ?, ?, 0)", [crypto.randomUUID(), id, IMG, `E2E ${i}`]);
    await addVariant(id, `E2E-${run}-B${i}`, "S", "Серый", "#9a9a9e", 10);
  }

  await sqlRun("insert into promo_codes (id, code, description, discount_percent, min_order_total) values (?, ?, 'E2E', 10, 1000)", [crypto.randomUUID(), state.promo]);
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}
