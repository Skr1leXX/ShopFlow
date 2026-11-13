import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readState, resetCustomerData, setStockDirect, sqlRows, sqlRun, sqlVal } from "./support/db";
import { hasBackend } from "./support/env";
import { addToCartOnProduct, login, normalize, trackErrors } from "./support/helpers";

test.skip(!hasBackend, "нужна база данных (TURSO_DATABASE_URL, см. e2e/README.md)");
test.describe.configure({ mode: "serial" });

const total = async (page: Page) => normalize(await page.locator("aside dl").innerText());
const badge = (page: Page) => page.getByRole("link", { name: /^Корзина, товаров:/ });

test.describe("корзина гостя", () => {
  test("добавление, пересчёт, удаление и сохранение после перезагрузки", async ({ page }) => {
    const s = readState();
    const errors = trackErrors(page);
    await addToCartOnProduct(page, s.products.tee.slug);
    await expect(badge(page)).toHaveAccessibleName("Корзина, товаров: 1");

    await page.goto("/cart");
    await expect(page.getByRole("link", { name: s.products.tee.name })).toBeVisible();
    expect(await total(page)).toContain("2 000 ₽");

    await page.getByRole("button", { name: "Больше" }).click();
    await expect.poll(async () => total(page)).toContain("4 000 ₽");

    await page.reload(); // корзина гостя хранится в браузере
    await expect(page.getByRole("link", { name: s.products.tee.name })).toBeVisible();
    expect(await total(page)).toContain("4 000 ₽");
    await expect(badge(page)).toHaveAccessibleName("Корзина, товаров: 2");

    await page.getByRole("button", { name: "Меньше" }).click();
    await expect.poll(async () => total(page)).toContain("2 000 ₽");
    await expect(page.getByRole("button", { name: "Меньше" })).toBeDisabled(); // минимум 1

    await page.getByRole("button", { name: "Удалить" }).click();
    await expect(page.getByRole("heading", { name: "Корзина пуста" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("количество не превышает остаток", async ({ page }) => {
    const s = readState();
    await addToCartOnProduct(page, s.products.jacket.slug); // остаток 3
    await page.goto("/cart");
    const more = page.getByRole("button", { name: "Больше" });
    await more.click();
    await more.click();
    await expect(more).toBeDisabled();
    expect(await total(page)).toContain("27 000 ₽");
  });

  test("гость не может оформить заказ без входа, корзина при этом сохраняется", async ({ page }) => {
    const s = readState();
    await addToCartOnProduct(page, s.products.cap.slug);
    await page.goto("/cart");
    await expect(page.getByText("Войдите, чтобы применить промокод")).toBeVisible();
    await page.getByRole("link", { name: "Войти и оформить заказ" }).click();
    await expect(page).toHaveURL(/\/login\?next=(%2F|\/)checkout/);
  });

  test("вход объединяет гостевую корзину с корзиной пользователя", async ({ page }) => {
    const s = readState();
    await resetCustomerData(s.customer.id);
    // Сначала в корзине пользователя уже есть кепка (из другой «сессии»), у гостя — кепка и куртка.
    await sqlRun("insert into cart_items (id, user_id, variant_id, quantity) values (?, ?, ?, 1)", [randomUUID(), s.customer.id, s.products.cap.variantM]);

    await addToCartOnProduct(page, s.products.cap.slug);
    await addToCartOnProduct(page, s.products.jacket.slug);
    await login(page, s.customer.email, "/cart");

    await expect(page.getByRole("link", { name: s.products.jacket.name })).toBeVisible();
    await expect(page.getByRole("link", { name: s.products.cap.name })).toBeVisible();
    const items = await sqlRows("select variant_id, quantity from cart_items where user_id = ?", [s.customer.id]);
    expect(items.find((i) => i.variant_id === s.products.cap.variantM)?.quantity).toBe(2); // 1 + 1 суммируются
    expect(items.find((i) => i.variant_id === s.products.jacket.variantM)?.quantity).toBe(1);
    // гостевая корзина очищена и повторно не добавляется
    expect(await page.evaluate(() => localStorage.getItem("shopflow:guest-cart"))).toBe("[]");
    await page.reload();
    const after = await sqlRows("select quantity from cart_items where user_id = ?", [s.customer.id]);
    expect(after.reduce((n, i) => n + i.quantity, 0)).toBe(3);
  });
});

test.describe("корзина пользователя", () => {
  test.beforeEach(async ({ page }) => {
    const s = readState();
    await resetCustomerData(s.customer.id);
    await login(page, s.customer.email);
  });

  test("добавление, изменение, удаление и хранение в базе после перезагрузки", async ({ page }) => {
    const s = readState();
    await addToCartOnProduct(page, s.products.tee.slug);
    await page.goto("/cart");
    await page.getByRole("button", { name: "Больше" }).click();
    await expect.poll(async () => total(page)).toContain("4 000 ₽");

    const data = await sqlRows("select quantity from cart_items where user_id = ?", [s.customer.id]);
    expect(data).toHaveLength(1);
    expect(data[0].quantity).toBe(2); // изменение сохранено в БД, а не в браузере

    await page.reload();
    expect(await total(page)).toContain("4 000 ₽");

    await page.getByRole("button", { name: "Удалить" }).click();
    await expect(page.getByRole("heading", { name: "Корзина пуста" })).toBeVisible();
    const count = await sqlVal("select count(*) from cart_items where user_id = ?", [s.customer.id]);
    expect(count).toBe(0);
  });

  test("повторное добавление суммирует количество, но не превышает остаток", async ({ page }) => {
    const s = readState();
    await addToCartOnProduct(page, s.products.jacket.slug);
    await page.getByRole("button", { name: "Больше" }).click();
    await page.getByRole("button", { name: "Больше" }).click();
    await page.getByRole("button", { name: /В корзину/ }).click(); // 2 + 1 = 3 = остаток
    await page.goto("/cart");
    expect(await total(page)).toContain("27 000 ₽");
    await page.goto(`/product/${s.products.jacket.slug}`);
    await page.getByRole("button", { name: "M", exact: true }).click();
    await page.getByRole("button", { name: /В корзину/ }).click();
    await expect(page.getByText(/максимум/)).toBeVisible();
  });

  test("нехватка товара на складе блокирует оформление в корзине", async ({ page }) => {
    const s = readState();
    await addToCartOnProduct(page, s.products.cap.slug);
    await page.goto("/cart");
    await page.getByRole("button", { name: "Больше" }).click();
    await page.getByRole("button", { name: "Больше" }).click();
    await expect.poll(async () => total(page)).toContain("3 000 ₽");
    await setStockDirect(s.products.cap.variantM, 1); // кто-то купил товар
    try {
      await page.reload();
      await expect(page.getByText("Доступно только 1 шт.")).toBeVisible();
      await expect(page.getByText("Уменьшите количество или удалите")).toBeVisible();
      await expect(page.getByRole("link", { name: "Оформить заказ" })).toHaveCount(0);
      await page.goto("/checkout");
      await expect(page).toHaveURL(/\/cart$/); // сервер не даёт открыть оформление
    } finally {
      await setStockDirect(s.products.cap.variantM, 20);
    }
  });
});
