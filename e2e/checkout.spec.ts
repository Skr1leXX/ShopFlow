import { expect, test, type Page } from "@playwright/test";
import { ordersOf, readState, resetCustomerData, setStockDirect, sqlRun, sqlVal, stockOf } from "./support/db";
import { hasBackend } from "./support/env";
import { addToCartOnProduct, login, normalize, trackErrors, alertOf } from "./support/helpers";

test.skip(!hasBackend, "нужна база данных (TURSO_DATABASE_URL, см. e2e/README.md)");
test.describe.configure({ mode: "serial" });

const summary = async (page: Page) => normalize(await page.locator("aside").last().innerText());

async function fillDelivery(page: Page) {
  await page.getByLabel("Телефон").fill("+7 900 111-22-33");
  await page.getByLabel("Город").fill("Москва");
  await page.getByLabel("Индекс").fill("125009");
  await page.getByLabel("Улица, дом, квартира").fill("Тверская ул., 1, кв. 5");
}

test.describe("оформление заказа", () => {
  test.beforeEach(async ({ page }) => {
    const s = readState();
    await resetCustomerData(s.customer.id);
    await setStockDirect(s.products.tee.variantM, 5);
    await login(page, s.customer.email);
    await addToCartOnProduct(page, s.products.tee.slug);
  });

  test("обязательные поля: заказ не создаётся без телефона и адреса", async ({ page }) => {
    const s = readState();
    await page.goto("/checkout");
    await page.getByRole("button", { name: "Подтвердить заказ" }).click();
    // Браузерная валидация останавливает отправку: ни перехода, ни заказа в БД.
    await expect(page).toHaveURL(/\/checkout$/);
    const invalid = await page.evaluate(() => [...document.querySelectorAll("form :invalid")].map((e) => (e as HTMLInputElement).name));
    expect(invalid).toEqual(expect.arrayContaining(["phone", "city", "postal_code", "street"]));
    expect(await ordersOf(s.customer.id)).toHaveLength(0);
  });

  test("самовывоз скрывает адрес и делает доставку бесплатной", async ({ page }) => {
    await page.goto("/checkout");
    await expect(page.getByLabel("Город")).toBeVisible();
    await page.getByLabel("Самовывоз").check();
    await expect(page.getByLabel("Город")).toHaveCount(0);
    await expect.poll(async () => summary(page)).toContain("Бесплатно");
    await page.getByLabel("Курьер").check();
    await expect.poll(async () => summary(page)).toContain("490 ₽");
  });

  test("промокод: неверный отклоняется, верный применяется на сервере", async ({ page }) => {
    const s = readState();
    await page.goto("/cart");
    await page.getByLabel("Промокод").fill("NOSUCHCODE");
    await page.getByRole("button", { name: "Применить" }).click();
    await expect(alertOf(page)).toHaveText("Промокод не найден");

    await page.getByLabel("Промокод").fill(s.promo.toLowerCase()); // регистр не важен
    await page.getByRole("button", { name: "Применить" }).click();
    await expect(page.getByRole("status")).toContainText("применён");
    expect(await total(page)).toContain("−200 ₽"); // 10% от 2 000
    await page.getByRole("link", { name: "Оформить заказ" }).click();
    await expect(page).toHaveURL(/promo=/);
    await expect.poll(async () => summary(page)).toContain("−200 ₽");
  });

  test("полный сценарий: заказ, цены, остатки, корзина, личный кабинет", async ({ page }) => {
    const s = readState();
    const errors = trackErrors(page);
    const used0 = (await sqlVal("select used_count from promo_codes where code = ?", [s.promo])) as number;

    await page.goto("/cart");
    await page.getByRole("button", { name: "Больше" }).click();
    await expect.poll(async () => total(page)).toContain("4 000 ₽");
    await page.getByLabel("Промокод").fill(s.promo);
    await page.getByRole("button", { name: "Применить" }).click();
    await expect(page.getByRole("status")).toContainText("применён");
    await page.getByRole("link", { name: "Оформить заказ" }).click();

    await fillDelivery(page);
    await page.getByLabel("Картой онлайн").check();
    await expect(page.getByText("Демонстрационный режим оплаты")).toBeVisible();
    await expect.poll(async () => summary(page)).toContain("4 090 ₽"); // 4000 − 400 + 490
    await page.getByRole("button", { name: "Подтвердить заказ" }).click();

    await expect(page).toHaveURL(/\/account\/orders\/[0-9a-f-]{36}\?placed=1/);
    await expect(page.getByText("Заказ оформлен")).toBeVisible();
    await expect(page.getByText(s.products.tee.name)).toBeVisible();

    const orders = await ordersOf(s.customer.id);
    expect(orders).toHaveLength(1);
    expect(Number(orders[0].total)).toBe(4090);
    expect(Number(orders[0].discount)).toBe(400);
    expect(await stockOf(s.products.tee.variantM)).toBe(3); // 5 − 2
    expect(await sqlVal("select used_count from promo_codes where code = ?", [s.promo])).toBe(used0 + 1);

    // корзина очищена только после успешного создания
    await page.goto("/cart");
    await expect(page.getByRole("heading", { name: "Корзина пуста" })).toBeVisible();

    // заказ виден в кабинете
    await page.goto("/account/orders");
    await expect(page.getByText(`Заказ №${orders[0].number}`)).toBeVisible();
    expect(normalize(await page.locator("main").innerText())).toContain("4 090 ₽");

    // цена зафиксирована на момент покупки: изменение цены товара не меняет заказ
    await sqlRun("update products set price = 99999, old_price = null where id = ?", [s.products.tee.id]);
    try {
      await page.goto(`/account/orders`);
      await page.getByText(`Заказ №${orders[0].number}`).click();
      await expect(page).toHaveURL(/\/account\/orders\/[0-9a-f-]{36}/);
      expect(normalize(await page.locator("main").innerText())).toContain("2 000 ₽");
      expect(normalize(await page.locator("main").innerText())).not.toContain("99 999");
    } finally {
      await sqlRun("update products set price = 2000, old_price = 2500 where id = ?", [s.products.tee.id]);
    }
    expect(errors).toEqual([]);
  });

  test("защита от повторного оформления: двойной клик создаёт один заказ", async ({ page }) => {
    const s = readState();
    await page.goto("/checkout");
    await fillDelivery(page);
    await page.getByRole("button", { name: "Подтвердить заказ" }).dblclick();
    await expect(page).toHaveURL(/\/account\/orders\/[0-9a-f-]{36}\?placed=1/);
    await page.waitForTimeout(500);
    expect(await ordersOf(s.customer.id)).toHaveLength(1);
    expect(await stockOf(s.products.tee.variantM)).toBe(4); // списано один раз
  });

  test("недостаточно товара на сервере: заказ не создаётся, корзина остаётся", async ({ page }) => {
    const s = readState();
    await page.goto("/checkout");
    await fillDelivery(page);
    await setStockDirect(s.products.tee.variantM, 0); // после открытия формы товар разобрали
    await page.getByRole("button", { name: "Подтвердить заказ" }).click();
    await expect(alertOf(page)).toContainText("Недостаточно товара на складе");
    expect(await ordersOf(s.customer.id)).toHaveLength(0);
    const count = await sqlVal("select count(*) from cart_items where user_id = ?", [s.customer.id]);
    expect(count).toBe(1);
  });

  test("подмена цены в браузере не влияет на сумму заказа", async ({ page }) => {
    const s = readState();
    await page.goto("/checkout");
    await fillDelivery(page);
    // Сервер не принимает цены от клиента: добавляем «лишние» поля, они игнорируются.
    await page.evaluate(() => {
      const f = document.querySelector("form")!;
      for (const [n, v] of [["price", "1"], ["total", "1"], ["discount", "99999"]]) {
        const i = document.createElement("input"); i.type = "hidden"; i.name = n; i.value = v; f.appendChild(i);
      }
    });
    await page.getByRole("button", { name: "Подтвердить заказ" }).click();
    await expect(page).toHaveURL(/placed=1/);
    const [o] = await ordersOf(s.customer.id);
    expect(Number(o.total)).toBe(2490); // 2000 + 490 доставка
    expect(Number(o.discount)).toBe(0);
  });
});

async function total(page: Page) {
  return normalize(await page.locator("aside dl").innerText());
}
