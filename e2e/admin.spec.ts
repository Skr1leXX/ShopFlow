import { expect, test, type Browser, type Page } from "@playwright/test";
import { admin, ordersOf, readState, resetCustomerData, setStockDirect, stockOf } from "./support/db";
import { hasBackend } from "./support/env";
import { login, normalize, trackErrors, alertOf } from "./support/helpers";

test.skip(!hasBackend, "нужен проект Supabase (см. e2e/README.md)");
test.describe.configure({ mode: "serial" });

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const png = (name = "e2e.png") => ({ name, mimeType: "image/png", buffer: PNG });

async function asAdmin(page: Page) {
  await login(page, readState().admin.email, "/admin");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}
const confirmDialog = async (page: Page) => {
  const d = page.getByRole("dialog");
  await expect(d).toBeVisible();
  await d.getByRole("button", { name: "Подтвердить" }).click();
};

/** Покупатель оформляет заказ через интерфейс в отдельном контексте браузера. */
async function placeCustomerOrder(browser: Browser) {
  const s = readState();
  await resetCustomerData(s.customer.id);
  await setStockDirect(s.products.tee.variantM, 5);
  const ctx = await browser.newContext({ baseURL: "http://localhost:3300", locale: "ru-RU" });
  const page = await ctx.newPage();
  await login(page, s.customer.email);
  await page.goto(`/product/${s.products.tee.slug}`);
  await page.getByRole("button", { name: "M", exact: true }).click();
  await page.getByRole("button", { name: /В корзину/ }).click();
  await expect(page.getByText("Товар добавлен в корзину")).toBeVisible();
  await page.goto("/checkout");
  await page.getByLabel("Телефон").fill("+7 900 000-00-01");
  await page.getByLabel("Самовывоз").check();
  await page.getByRole("button", { name: "Подтвердить заказ" }).click();
  await expect(page).toHaveURL(/placed=1/);
  await ctx.close();
  return (await ordersOf(s.customer.id))[0];
}

test.describe("доступ к админ-панели", () => {
  test("администратор видит все разделы", async ({ page }) => {
    const errors = trackErrors(page);
    await asAdmin(page);
    for (const [name, h] of [["Товары", "Товары"], ["Категории", "Категории"], ["Заказы", "Заказы"], ["Клиенты", "Клиенты"], ["Склад", "Склад"], ["Промокоды", "Промокоды"], ["Настройки", "Настройки"]]) {
      await page.getByRole("navigation", { name: "Разделы админ-панели" }).getByRole("link", { name }).click();
      await expect(page.getByRole("heading", { level: 1, name: h })).toBeVisible();
    }
    expect(errors).toEqual([]);
  });

  test("обычный пользователь заблокирован на всех страницах и в экспорте", async ({ page }) => {
    const s = readState();
    await login(page, s.customer.email);
    for (const path of ["/admin", "/admin/products", "/admin/products/new", "/admin/orders", "/admin/customers", "/admin/inventory", "/admin/promos", "/admin/settings"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/account\?denied=1/);
      await expect(alertOf(page)).toContainText("нет доступа");
    }
    for (const kind of ["products", "orders"]) {
      expect((await page.request.get(`/admin/export/${kind}`)).status()).toBe(403);
    }
    // Админ-меню пользователю не показывается, а прямой доступ к данным закрыт RLS (проверено и в test:db).
    await page.goto("/");
    await page.locator("summary[aria-label='Аккаунт']").click();
    await expect(page.getByRole("link", { name: "Админ-панель" })).toHaveCount(0);
  });

  test("аноним: админка и экспорт перенаправляют на вход", async ({ page, request }) => {
    const r = await request.get("/admin/export/products", { maxRedirects: 0 });
    expect(r.status()).toBeGreaterThanOrEqual(300);
    expect(r.status()).toBeLessThan(400);
    expect(r.headers()["location"]).toContain("/login");
    await page.goto("/admin/orders");
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Forders/);
  });
});

test.describe("dashboard", () => {
  test("показатели совпадают с данными в базе", async ({ page, browser }) => {
    await placeCustomerOrder(browser);
    await asAdmin(page);
    const db = admin();
    const { data } = await db.from("orders").select("total,status");
    const valid = data!.filter((o) => o.status !== "cancelled");
    const revenue = valid.reduce((n, o) => n + Number(o.total), 0);
    const text = normalize(await page.locator("main").innerText());
    expect(text).toContain(`${Math.round(revenue).toLocaleString("ru-RU").replace(/ /g, " ")} ₽`);
    expect(text).toContain("Средний чек");
    expect(text).toContain("Продажи за 30 дней");
    await expect(page.getByRole("img", { name: /Выручка за 30 дней/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Популярные товары" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Последние заказы" })).toBeVisible();
  });
});

test.describe("товары: CRUD, фото, варианты", () => {
  test("создание, проверка и редактирование, фото, варианты, скрытие, удаление", async ({ page }) => {
    const s = readState();
    const name = `E2E Админ-товар ${s.run}`;
    const errors = trackErrors(page);
    await asAdmin(page);
    await page.goto("/admin/products/new");

    // валидация: старая цена должна быть выше цены
    await page.getByLabel("Название", { exact: true }).fill(name);
    await page.getByLabel("Бренд").fill("E2EBrandA");
    await page.getByLabel("Категория").selectOption({ label: s.categoryName });
    await page.getByLabel("Цена, ₽").fill("1500");
    await page.getByLabel(/Старая цена/).fill("1000");
    await page.getByRole("button", { name: "Создать товар" }).click();
    await expect(alertOf(page)).toHaveText("Старая цена должна быть выше текущей");

    await page.getByLabel(/Старая цена/).fill("");
    await page.getByLabel("Slug (адрес страницы; пусто — из названия)").fill(`e2e-admin-${s.run}`);
    await page.getByLabel("Описание").fill("Создан автотестом");
    await page.getByLabel(/Характеристики/).fill("Материал: хлопок\nУход: 30°C");
    await page.getByRole("button", { name: "Создать товар" }).click();
    await expect(page).toHaveURL(/\/admin\/products\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

    // редактирование цены и скидки
    await page.getByLabel("Цена, ₽").fill("1800");
    await page.getByLabel(/Старая цена/).fill("2400");
    await page.getByRole("button", { name: "Сохранить товар" }).click();
    await expect(page.getByRole("status")).toHaveText("Товар сохранён");
    const { data: row } = await admin().from("products").select("id,price,old_price,details").eq("slug", `e2e-admin-${s.run}`).single();
    expect(Number(row!.price)).toBe(1800);
    expect(Number(row!.old_price)).toBe(2400);
    expect(row!.details).toMatchObject({ "Материал": "хлопок" });

    // варианты и остатки
    const vForm = page.locator("form", { has: page.getByRole("button", { name: "Добавить вариант" }) });
    await vForm.getByLabel("Размер").fill("XL");
    await vForm.getByLabel("Название цвета").fill("Зелёный");
    await vForm.getByLabel("Остаток").fill("4");
    await vForm.getByRole("button", { name: "Добавить вариант" }).click();
    await expect(page.getByText("Вариант добавлен")).toBeVisible();
    await expect(page.getByRole("cell", { name: "XL" })).toBeVisible();
    await vForm.getByLabel("Размер").fill("XL");
    await vForm.getByLabel("Название цвета").fill("Зелёный");
    await vForm.getByRole("button", { name: "Добавить вариант" }).click();
    await expect(alertOf(page)).toHaveText("Такой вариант уже есть");

    const stockCell = page.locator("tr", { hasText: "XL" }).getByLabel("Остаток");
    await stockCell.fill("9");
    await page.locator("tr", { hasText: "XL" }).getByRole("button", { name: "Сохранить" }).click();
    await expect.poll(async () => {
      const { data } = await admin().from("inventory").select("quantity, product_variants!inner(sku)").like("product_variants.sku", `%E2E-ADMIN-${s.run.toUpperCase()}%`);
      return data?.[0]?.quantity;
    }).toBe(9);

    // фото: загрузка, замена, удаление
    const photos = page.locator("section", { has: page.getByRole("heading", { name: "Фотографии" }) });
    await photos.locator("input[type=file]").last().setInputFiles(png());
    await expect(photos.locator("img")).toHaveCount(1);
    const { data: img1 } = await admin().from("product_images").select("id,storage_path,url").eq("product_id", row!.id);
    expect(img1).toHaveLength(1);
    expect(img1![0].storage_path).toMatch(new RegExp(`^${row!.id}/.+\\.png$`));
    const oldPath = img1![0].storage_path!;

    await photos.locator("input[type=file]").first().setInputFiles(png("replace.png"));
    await expect.poll(async () => (await admin().from("product_images").select("storage_path").eq("product_id", row!.id)).data![0].storage_path).not.toBe(oldPath);
    const gone = await admin().storage.from("product-images").list(row!.id);
    expect(gone.data!.some((f) => oldPath.endsWith(f.name))).toBe(false); // старый файл удалён из Storage

    // недопустимый тип файла отклоняется
    await photos.locator("input[type=file]").last().setInputFiles({ name: "x.txt", mimeType: "text/plain", buffer: Buffer.from("hi") });
    await expect(alertOf(page).filter({ hasText: "Допустимы JPG" })).toBeVisible();

    await photos.getByRole("button", { name: "Удалить фото" }).click();
    await confirmDialog(page);
    await expect(photos.locator("img")).toHaveCount(0);

    // скрытие: товар пропадает с витрины, но остаётся в админке
    await page.getByLabel("Показывать в каталоге").uncheck();
    await page.getByRole("button", { name: "Сохранить товар" }).click();
    await expect(page.getByRole("status")).toHaveText("Товар сохранён");
    const pub = await page.request.get(`/product/e2e-admin-${s.run}`);
    expect(pub.status()).toBe(404);
    await page.getByLabel("Показывать в каталоге").check();
    await page.getByRole("button", { name: "Сохранить товар" }).click();
    await expect(page.getByRole("status")).toHaveText("Товар сохранён");

    // список: поиск, фильтр, быстрое скрытие
    await page.goto(`/admin/products?q=${encodeURIComponent(name)}`);
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await page.getByRole("switch", { name: "Скрыть товар" }).click();
    await expect(page.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    await page.goto(`/admin/products?q=${encodeURIComponent(name)}&status=active`);
    await expect(page.getByText("Ничего не найдено")).toBeVisible();

    // удаление с подтверждением: Esc отменяет, «Подтвердить» удаляет
    await page.goto(`/admin/products/${row!.id}`);
    await page.getByRole("button", { name: "Удалить", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    expect((await admin().from("products").select("id").eq("id", row!.id)).data).toHaveLength(1);
    await page.getByRole("button", { name: "Удалить", exact: true }).click();
    await confirmDialog(page);
    await expect(page).toHaveURL(/\/admin\/products$/);
    expect((await admin().from("products").select("id").eq("id", row!.id)).data).toHaveLength(0);
    expect(errors.filter((e) => !/400|413/.test(e))).toEqual([]);
  });

  test("список: фильтр по наличию, сортировка и несуществующий товар", async ({ page }) => {
    const s = readState();
    await asAdmin(page);
    await page.goto(`/admin/products?q=${encodeURIComponent(s.run)}&sort=price_desc`);
    const first = await page.locator("tbody tr").first().innerText();
    expect(first).toContain(s.products.jacket.name);
    await page.goto(`/admin/products?q=${encodeURIComponent(s.run)}&stock=out`);
    await expect(page.getByText("Ничего не найдено")).toBeVisible();
    const r = await page.goto("/admin/products/00000000-0000-0000-0000-000000000000");
    expect(r?.status()).toBe(404);
  });
});

test.describe("категории: CRUD, изображение, порядок", () => {
  test("создание, редактирование, порядок, изображение, удаление", async ({ page }) => {
    const s = readState();
    await asAdmin(page);
    await page.goto("/admin/categories");
    const name = `E2E Кат-тест ${s.run}`;
    const form = page.locator("section", { has: page.getByRole("heading", { name: "Новая категория" }) });
    await form.getByLabel("Название").fill(name);
    await form.getByLabel("Slug").fill(`e2e-cat-${s.run}`);
    await form.getByRole("button", { name: "Создать" }).click();
    await expect(form.getByRole("status")).toHaveText("Категория сохранена");
    const row = page.locator("div.rounded-2xl", { hasText: name }).first();
    await expect(row).toBeVisible();

    // дубликат slug
    await form.getByLabel("Название").fill("Дубль");
    await form.getByLabel("Slug").fill(`e2e-cat-${s.run}`);
    await form.getByRole("button", { name: "Создать" }).click();
    await expect(form.getByRole("alert")).toHaveText("Категория с таким slug уже есть");

    // редактирование
    await row.locator("summary").click();
    await row.getByLabel("Название").fill(`${name} ред.`);
    await row.getByRole("button", { name: "Сохранить" }).click();
    await expect(row.getByRole("status")).toHaveText("Категория сохранена");
    const { data: c } = await admin().from("categories").select("id,name,sort_order").eq("slug", `e2e-cat-${s.run}`).single();
    expect(c!.name).toBe(`${name} ред.`);

    // порядок: стрелка вверх меняет sort_order
    const before = c!.sort_order;
    await row.getByRole("button", { name: "Выше" }).click();
    await expect.poll(async () => (await admin().from("categories").select("sort_order").eq("id", c!.id).single()).data!.sort_order).toBeLessThan(before);

    // изображение
    await row.locator("input[type=file]").setInputFiles(png());
    await expect.poll(async () => (await admin().from("categories").select("image_url").eq("id", c!.id).single()).data!.image_url).toContain("/product-images/categories/");
    await row.getByRole("button", { name: "Убрать" }).click();
    await confirmDialog(page);
    await expect.poll(async () => (await admin().from("categories").select("image_url").eq("id", c!.id).single()).data!.image_url).toBeNull();

    // категорию с товарами удалить нельзя
    const used = page.locator("div.rounded-2xl", { hasText: s.categoryName }).first();
    await used.locator("summary").click();
    await used.getByRole("button", { name: "Удалить" }).click();
    await confirmDialog(page);
    await expect(used.getByRole("alert")).toContainText("есть товары");

    // пустую — можно
    await row.getByRole("button", { name: "Удалить" }).click();
    await confirmDialog(page);
    await expect.poll(async () => (await admin().from("categories").select("id").eq("id", c!.id)).data!.length).toBe(0);
  });
});

test.describe("заказы и склад", () => {
  test("поиск, подробности, смена статуса, отмена возвращает остаток", async ({ page, browser }) => {
    const s = readState();
    const order = await placeCustomerOrder(browser); // списывает 1 шт.
    expect(await stockOf(s.products.tee.variantM)).toBe(4);

    await asAdmin(page);
    await page.goto(`/admin/orders?q=${order.number}`);
    await expect(page.locator("details")).toHaveCount(1);
    await page.locator("details summary").click();
    const d = page.locator("details");
    await expect(d).toContainText(s.products.tee.name);
    await expect(d).toContainText("E2E Покупатель");
    await expect(d).toContainText(s.customer.email);
    await expect(d).toContainText("демо-оплата");

    await d.getByLabel("Статус заказа").selectOption("paid");
    await expect.poll(async () => (await admin().from("orders").select("status").eq("id", order.id).single()).data!.status).toBe("paid");

    await d.getByLabel("Статус заказа").selectOption("cancelled");
    await expect.poll(async () => (await admin().from("orders").select("status").eq("id", order.id).single()).data!.status).toBe("cancelled");
    expect(await stockOf(s.products.tee.variantM)).toBe(5); // остаток вернулся

    // из «Отменён» выйти нельзя: понятная ошибка, статус не меняется, остаток не удваивается
    await page.goto(`/admin/orders?q=${order.number}`);
    await page.locator("details summary").click();
    await page.locator("details").getByLabel("Статус заказа").selectOption("processing");
    await expect(alertOf(page)).toContainText("изменить нельзя");
    expect((await admin().from("orders").select("status").eq("id", order.id).single()).data!.status).toBe("cancelled");
    expect(await stockOf(s.products.tee.variantM)).toBe(5);

    // фильтр по статусу
    await page.goto(`/admin/orders?status=cancelled&q=${s.customer.email.split("@")[0]}`);
    await expect(page.locator("details")).toHaveCount(1);
    await page.goto(`/admin/orders?status=shipped&q=${order.number}`);
    await expect(page.getByText("Ничего не найдено")).toBeVisible();
  });

  test("клиенты: поиск, контакты, история заказов, сумма", async ({ page }) => {
    const s = readState();
    await asAdmin(page);
    await page.goto(`/admin/customers?q=${encodeURIComponent(s.customer.email)}`);
    await expect(page.locator("details")).toHaveCount(1);
    await expect(page.locator("details")).toContainText("E2E Покупатель");
    await page.locator("details summary").click();
    await expect(page.getByText("История заказов")).toBeVisible();
    await page.goto("/admin/customers?q=нетакогоклиента");
    await expect(page.getByText("Клиентов не найдено")).toBeVisible();
  });

  test("склад: приход, списание, ошибка при нехватке, журнал, фильтры", async ({ page }) => {
    const s = readState();
    await setStockDirect(s.products.cap.variantM, 20);
    await asAdmin(page);
    await page.goto("/admin/inventory");
    const form = page.locator("section", { has: page.getByRole("heading", { name: "Приход / списание" }) });
    const label = `${s.products.cap.name} · Красный, M`;
    const pick = async () => {
      const opt = form.getByLabel("Товар").locator("option", { hasText: label });
      await form.getByLabel("Товар").selectOption(await opt.getAttribute("value"));
    };

    await pick();
    await form.getByLabel("Тип операции").selectOption("receipt");
    await form.getByLabel("Количество").fill("5");
    await form.getByLabel("Комментарий").fill("поставка e2e");
    await form.getByRole("button", { name: "Провести операцию" }).click();
    await expect(form.getByRole("status")).toContainText("Остаток теперь 25");
    expect(await stockOf(s.products.cap.variantM)).toBe(25);

    await pick();
    await form.getByLabel("Тип операции").selectOption("writeoff");
    await form.getByLabel("Количество").fill("2");
    await form.getByLabel("Комментарий").fill("брак e2e");
    await form.getByRole("button", { name: "Провести операцию" }).click();
    await expect(form.getByRole("status")).toContainText("Остаток теперь 23");

    await pick();
    await form.getByLabel("Тип операции").selectOption("writeoff");
    await form.getByLabel("Количество").fill("1000");
    await form.getByRole("button", { name: "Провести операцию" }).click();
    await expect(form.getByRole("alert")).toContainText("Недостаточно товара");
    expect(await stockOf(s.products.cap.variantM)).toBe(23); // не изменился

    await page.goto("/admin/inventory");
    const hist = page.locator("section", { has: page.getByRole("heading", { name: "История движения" }) });
    await expect(hist).toContainText("поставка e2e");
    await expect(hist).toContainText("брак e2e");
    await expect(hist.locator("tr", { hasText: "брак e2e" })).toContainText("-2");

    // «нет в наличии» — размер L у E2E-товаров; фильтр и поиск
    await page.goto(`/admin/inventory?filter=out&q=${encodeURIComponent(s.products.tee.name)}`);
    await expect(page.locator("tbody tr").first()).toContainText("L");
    await page.goto(`/admin/inventory?filter=low&q=${encodeURIComponent(s.products.jacket.name)}`);
    await expect(page.locator("tbody tr")).toHaveCount(1); // куртка M: остаток 3 ≤ 3
    // ручная установка остатка пишет корректировку
    await page.goto(`/admin/inventory?q=${encodeURIComponent(s.products.cap.name)}`);
    const row = page.locator("tr", { hasText: `E2E-${s.run}-CAP-M`.toUpperCase() });
    await row.getByLabel("Остаток").fill("30");
    await row.getByRole("button", { name: "Сохранить" }).click();
    await expect.poll(() => stockOf(s.products.cap.variantM)).toBe(30);
    await setStockDirect(s.products.cap.variantM, 20);
  });

  test("промокоды: создание, правка, отключение, удаление", async ({ page }) => {
    const s = readState();
    await asAdmin(page);
    await page.goto("/admin/promos");
    const code = `E2EP${s.run}`.toUpperCase().slice(0, 12);
    const form = page.locator("section", { has: page.getByRole("heading", { name: "Новый промокод" }) });
    await form.getByLabel("Код").fill(code);
    await form.getByLabel("Размер скидки").fill("95");
    await form.getByRole("button", { name: "Создать" }).click();
    await expect(form.getByRole("alert")).toContainText("1 до 90");
    await form.getByLabel("Размер скидки").fill("15");
    await form.getByLabel("Лимит использований").fill("2");
    await form.getByLabel(/Действует до/).fill("2099-12-31");
    await form.getByRole("button", { name: "Создать" }).click();
    await expect(form.getByRole("status")).toHaveText("Промокод создан");

    const row = page.locator("details", { hasText: code });
    await row.locator("summary").click();
    await row.getByLabel("Размер скидки").fill("20");
    await row.getByRole("button", { name: "Сохранить" }).click();
    await expect(row.getByRole("status")).toHaveText("Промокод сохранён");
    const { data } = await admin().from("promo_codes").select("discount_percent,max_uses,expires_at").eq("code", code).single();
    expect(data).toMatchObject({ discount_percent: 20, max_uses: 2 });
    expect(data!.expires_at).toContain("2099-12-31");

    await row.getByRole("button", { name: "Отключить" }).click();
    await expect.poll(async () => (await admin().from("promo_codes").select("is_active").eq("code", code).single()).data!.is_active).toBe(false);
    await row.getByRole("button", { name: "Удалить" }).click();
    await confirmDialog(page);
    await expect.poll(async () => (await admin().from("promo_codes").select("id").eq("code", code)).data!.length).toBe(0);
  });
});

test.describe("экспорт CSV", () => {
  test("товары и заказы: заголовки, BOM, содержимое и фильтры", async ({ page }) => {
    const s = readState();
    await asAdmin(page);
    const p = await page.request.get(`/admin/export/products?q=${encodeURIComponent(s.run)}`);
    expect(p.status()).toBe(200);
    expect(p.headers()["content-type"]).toContain("text/csv");
    expect(p.headers()["content-disposition"]).toMatch(/attachment; filename="products-\d{4}-\d{2}-\d{2}\.csv"/);
    const csv = await p.text();
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("Название;Slug;Бренд");
    expect(csv).toContain(s.products.tee.name);
    expect(csv).not.toContain("Reebok");
    expect(csv.trim().split("\r\n").length).toBe(16); // заголовок + 15 товаров прогона

    const o = await page.request.get("/admin/export/orders?status=all");
    expect(o.status()).toBe(200);
    expect(await o.text()).toContain("Номер;Дата;Статус;Покупатель");
    expect((await page.request.get("/admin/export/secrets")).status()).toBe(404);

    // кнопка экспорта на странице учитывает фильтры
    await page.goto(`/admin/products?q=${encodeURIComponent(s.run)}&status=active`);
    await expect(page.getByRole("link", { name: "CSV" })).toHaveAttribute("href", /export\/products\?.*q=.*status=active/);
  });
});
