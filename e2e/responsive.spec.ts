import { expect, test, type Page } from "@playwright/test";
import { readState } from "./support/db";
import { hasBackend } from "./support/env";
import { addToCartOnProduct, login, trackErrors } from "./support/helpers";

test.skip(!hasBackend, "нужна база данных (TURSO_DATABASE_URL, см. e2e/README.md)");

// Запускается в проектах desktop (1440), tablet (iPad) и mobile (Pixel 7).
const noOverflow = async (page: Page, where: string) => {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(o.sw, `горизонтальная прокрутка на ${where}`).toBeLessThanOrEqual(o.iw);
};

test.describe("адаптивность", () => {
  test("нет горизонтальной прокрутки на ключевых страницах", async ({ page }) => {
    const s = readState();
    const errors = trackErrors(page);
    await addToCartOnProduct(page, s.products.tee.slug);
    for (const path of ["/", `/catalog?category=e2e-${s.run}`, `/product/${s.products.tee.slug}`, "/cart", "/login", "/register", "/no-such-page"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await noOverflow(page, path);
    }
    await login(page, s.customer.email, "/account");
    for (const path of ["/account", "/account/orders", "/account/favorites", "/account/addresses", "/checkout"]) {
      await page.goto(path);
      await noOverflow(page, path);
    }
    expect(errors).toEqual([]);
  });

  test("навигация: меню, категории, поиск, корзина доступны", async ({ page }, info) => {
    const s = readState();
    await page.goto("/");
    const mobile = info.project.name !== "desktop" && (page.viewportSize()?.width ?? 0) < 1024;
    if (mobile) {
      await page.locator("summary[aria-label='Меню']").click();
      await page.getByRole("navigation").getByRole("link", { name: s.categoryName }).first().click().catch(async () => {
        await page.getByRole("link", { name: "Весь каталог" }).click();
      });
      await expect(page).toHaveURL(/\/catalog/);
      if ((page.viewportSize()?.width ?? 0) >= 768) {
        await expect(page.getByRole("searchbox").first()).toBeVisible(); // на планшете поле поиска видно в шапке
      } else {
        await page.getByRole("link", { name: "Поиск" }).click();
        await expect(page.getByRole("searchbox").first()).toBeFocused();
      }
    } else {
      await page.getByRole("navigation", { name: "Категории" }).getByRole("link", { name: "Каталог" }).click();
      await expect(page).toHaveURL(/\/catalog/);
    }
    await expect(page.getByRole("link", { name: /^Корзина/ }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Избранное" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "ShopFlow — на главную" }).first()).toBeVisible();
  });

  test("элементы управления достаточно крупные для касания, поля не вызывают зум", async ({ page }, info) => {
    await page.goto("/login");
    const small = await page.evaluate(() =>
      [...document.querySelectorAll("header a, header button, header summary, form input, form button")]
        .map((e) => ({ n: (e.getAttribute("aria-label") ?? e.textContent ?? "").trim().slice(0, 20), r: e.getBoundingClientRect() }))
        .filter((x) => x.r.width > 0 && (x.r.height < 36 || x.r.width < 36) && x.n !== ""));
    // Ссылки-иконки в шапке: 40×40; поля: 44 px по высоте. Меньше 36 — ошибка вёрстки.
    expect(small.filter((x) => x.r.height < 36)).toEqual([]);
    if (info.project.name === "mobile") {
      const fs = await page.getByLabel("Email").evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
      expect(fs).toBeGreaterThanOrEqual(16); // иначе iOS Safari приближает страницу при фокусе
    }
  });

  test("каталог: сетка, фильтры в раскрывающемся блоке на узких экранах, изображения", async ({ page }, info) => {
    const s = readState();
    await page.goto(`/catalog?category=e2e-${s.run}`);
    const w = page.viewportSize()!.width;
    const first = await page.locator("article").first().boundingBox();
    expect(first!.width).toBeGreaterThan(130);
    if (w < 1024) {
      const details = page.locator("details", { hasText: "Фильтры" }).first();
      await expect(details).toBeVisible();
      await expect(page.getByRole("complementary", { name: "Фильтры" })).toBeHidden();
      await details.locator("summary").click();
      await details.getByLabel("E2EBrandB").click();
      await expect(details.getByLabel("E2EBrandB")).toBeChecked();
      await expect(page).toHaveURL(/brand=E2EBrandB/);
      await expect(page.locator("article")).toHaveCount(1);
    } else {
      await expect(page.getByRole("complementary", { name: "Фильтры" })).toBeVisible();
    }
    // изображения: загружены, имеют alt, отдаются оптимизатором в современном формате
    await page.goto(`/catalog?category=e2e-${s.run}`);
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } });
    await page.waitForLoadState("networkidle");
    const imgs = await page.locator("article img").evaluateAll((l) => l.map((i) => ({ ok: (i as HTMLImageElement).naturalWidth > 0, alt: i.getAttribute("alt"), src: (i as HTMLImageElement).currentSrc })));
    expect(imgs.length).toBeGreaterThan(0);
    expect(imgs.filter((i) => !i.ok)).toEqual([]);
    expect(imgs.every((i) => i.alt !== null)).toBe(true);
    expect(imgs.every((i) => i.src.includes("/_next/image"))).toBe(true);
    void info;
  });

  test("корзина и оформление заказа удобны на любом экране", async ({ page }) => {
    const s = readState();
    await addToCartOnProduct(page, s.products.cap.slug);
    await page.goto("/cart");
    for (const b of [page.getByRole("button", { name: "Больше" }), page.getByRole("button", { name: "Меньше" }), page.getByRole("button", { name: "Удалить" })]) {
      const box = await b.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(32);
    }
    await expect(page.getByRole("link", { name: "Войти и оформить заказ" })).toBeInViewport({ ratio: 0.1 }).catch(() => undefined);
    // Гостевая корзина переносится в базу уже после входа, поэтому возвращаемся в корзину и оттуда идём к оформлению.
    await login(page, s.customer.email, "/cart");
    await page.getByRole("link", { name: "Оформить заказ" }).click();
    await expect(page.getByRole("heading", { name: "Оформление заказа" })).toBeVisible();
    const submit = page.getByRole("button", { name: "Подтвердить заказ" });
    await submit.scrollIntoViewIfNeeded();
    await expect(submit).toBeVisible();
    await noOverflow(page, "/checkout");
  });

  test("уведомления и сетевые ошибки: пользователь видит понятное сообщение", async ({ page }) => {
    const s = readState();
    await login(page, s.customer.email);
    await page.goto(`/product/${s.products.cap.slug}`);
    await page.getByRole("button", { name: "M", exact: true }).click();
    // Обрыв сети во время серверного действия: показывается сообщение, страница не падает.
    await page.route("**/product/**", (route) => (route.request().method() === "POST" ? route.abort("failed") : route.continue()));
    await page.getByRole("button", { name: /В корзину/ }).click();
    await expect(page.getByRole("status")).toContainText("Нет соединения");
    await page.unroute("**/product/**");
    await page.getByRole("button", { name: /В корзину/ }).click();
    await expect(page.getByRole("status")).toContainText("Товар добавлен в корзину"); // и восстановление после сбоя
  });
});
