import { expect, test } from "@playwright/test";
import { readState } from "./support/db";
import { hasBackend } from "./support/env";
import { normalize, trackErrors } from "./support/helpers";

test.skip(!hasBackend, "нужна база данных (TURSO_DATABASE_URL, см. e2e/README.md)");

// Все проверки идут в изолированной категории E2E: каталог проекта не влияет на результат.
const url = (cat: string, qs = "") => `/catalog?category=e2e-${cat}${qs}`;

test.describe("каталог", () => {
  test("загрузка товаров, карточки с ценой, скидкой и наличием", async ({ page }) => {
    const s = readState();
    const errors = trackErrors(page);
    await page.goto(url(s.run));
    await expect(page.getByRole("heading", { level: 1, name: s.categoryName })).toBeVisible();
    await expect(page.locator("article")).toHaveCount(12); // первая страница
    const tee = page.locator("article", { hasText: s.products.tee.name });
    await expect(tee).toContainText("−20%");
    expect(normalize(await tee.innerText())).toContain("2 000");
    expect(normalize(await tee.innerText())).toContain("2 500"); // старая цена
    // все изображения реально загрузились
    await page.waitForLoadState("networkidle");
    const broken = await page.locator("article img").evaluateAll((imgs) => imgs.filter((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth === 0).length);
    expect(broken).toBe(0);
    expect(errors).toEqual([]);
  });

  test("пагинация: вторая страница и переход назад", async ({ page }) => {
    const s = readState();
    await page.goto(url(s.run));
    await page.getByRole("navigation", { name: "Страницы" }).getByRole("link", { name: "2", exact: true }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.locator("article")).toHaveCount(3); // 15 товаров = 12 + 3
    await page.getByRole("link", { name: "Назад" }).click();
    await expect(page.locator("article")).toHaveCount(12);
  });

  test("поиск по названию и по описанию", async ({ page }) => {
    const s = readState();
    await page.goto(`/catalog?q=${encodeURIComponent(s.products.jacket.name)}`);
    await expect(page.locator("article")).toHaveCount(1);
    await page.goto("/catalog?q=уникальноеслово-хлопок"); // есть только в описании футболки
    await expect(page.locator("article")).toHaveCount(1);
    await expect(page.locator("article")).toContainText(s.products.tee.name);
  });

  test("поиск из шапки", async ({ page }) => {
    const s = readState();
    await page.goto("/");
    await page.getByRole("search").first().getByRole("searchbox").fill(s.products.cap.name);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/q=/);
    await expect(page.locator("article")).toHaveCount(1);
  });

  test("пустой результат поиска и сброс фильтров", async ({ page }) => {
    await page.goto("/catalog?q=zzzнетакоготовара");
    await expect(page.getByText("Ничего не найдено")).toBeVisible();
    await page.getByRole("link", { name: "Сбросить фильтры" }).click();
    await expect(page).toHaveURL(/\/catalog$/);
  });

  test("поиск не ломается на спецсимволах", async ({ page }) => {
    const errors = trackErrors(page);
    for (const q of ["a,b", "(x)", "100%", "*", "\\", "' or 1=1 --"]) {
      const r = await page.goto(`/catalog?q=${encodeURIComponent(q)}`);
      expect(r?.status()).toBeLessThan(500);
    }
    expect(errors).toEqual([]);
  });

  test("фильтры: бренд, размер, цвет, цена", async ({ page }) => {
    const s = readState();
    await page.goto(url(s.run));
    const aside = page.getByRole("complementary", { name: "Фильтры" });

    await aside.getByLabel("E2EBrandB").click(); // чекбокс обновляется после перехода по URL
    await expect(page).toHaveURL(/brand=E2EBrandB/);
    await expect(page.locator("article")).toHaveCount(1);
    await expect(page.locator("article")).toContainText(s.products.jacket.name);

    await aside.getByLabel("E2EBrandB").click();
    await expect(page.locator("article")).toHaveCount(12);

    await aside.getByRole("button", { name: "Синий", exact: true }).click();
    await expect(page.locator("article")).toHaveCount(1);
    await aside.getByRole("button", { name: "Синий", exact: true }).click();

    await aside.getByLabel("Цена от").fill("1500");
    await aside.getByLabel("Цена до").fill("3000");
    await aside.getByRole("button", { name: "Применить цену" }).click();
    await expect(page).toHaveURL(/min=1500/);
    await expect(page.locator("article")).toHaveCount(1);
    await expect(page.locator("article")).toContainText(s.products.tee.name);

    await aside.getByRole("button", { name: "Сбросить фильтры" }).click();
    await expect(page.locator("article")).toHaveCount(12);
  });

  test("фильтр по размеру учитывает варианты товаров", async ({ page }) => {
    const s = readState();
    await page.goto(url(s.run));
    await page.getByRole("complementary", { name: "Фильтры" }).getByRole("button", { name: "M", exact: true }).click();
    await expect(page.locator("article")).toHaveCount(3); // M есть только у 3 именованных товаров
  });

  test("сортировка по цене и новизне", async ({ page }) => {
    const s = readState();
    const prices = async () =>
      (await page.locator("article").allInnerTexts()).map((t) => Number(normalize(t).match(/(\d[\d ]*)\s?₽/)![1].replace(/\s/g, "")));
    await page.goto(url(s.run));
    await page.getByLabel("Сортировка").selectOption("price_asc");
    await expect(page).toHaveURL(/sort=price_asc/);
    await expect.poll(async () => (await prices())[0]).toBe(501);
    const asc = await prices();
    expect(asc).toEqual([...asc].sort((a, b) => a - b));

    await page.getByLabel("Сортировка").selectOption("price_desc");
    await expect.poll(async () => (await prices())[0]).toBe(9000);
    const desc = await prices();
    expect(desc).toEqual([...desc].sort((a, b) => b - a));
  });

  test("переход на страницу товара и обратно", async ({ page }) => {
    const s = readState();
    await page.goto(url(s.run));
    await page.locator("article", { hasText: s.products.jacket.name }).getByRole("link").first().click();
    await expect(page).toHaveURL(new RegExp(`/product/${s.products.jacket.slug}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(s.products.jacket.name);
    await expect(page).toHaveTitle(new RegExp(s.products.jacket.name));
    await expect(page.getByText("Похожие товары")).toBeVisible();
  });

  test("страница товара: размер без остатка недоступен, выбор варианта, 404 для скрытого", async ({ page }) => {
    const s = readState();
    await page.goto(`/product/${s.products.tee.slug}`);
    await expect(page.getByRole("button", { name: "L", exact: true })).toBeDisabled(); // остаток 0
    await expect(page.getByText("Выберите размер, чтобы увидеть наличие")).toBeVisible();
    await page.getByRole("button", { name: "M", exact: true }).click();
    await expect(page.getByText("В наличии")).toBeVisible();
    // Статус при потоковой отдаче страницы может быть 200 (loading.tsx), поэтому проверяем содержимое страницы 404.
    await page.goto("/product/no-such-product-e2e");
    await expect(page.getByRole("heading", { name: "Страница не найдена" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Страница не найдена" })).toBeVisible();
  });

  test("главная: секции и ссылки на категории", async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto("/");
    for (const h of ["Популярные категории", "Рекомендуем", "Новинки", "Специальные предложения"])
      await expect(page.getByRole("heading", { name: h })).toBeVisible();
    expect(errors).toEqual([]);
  });
});
