import { expect, test } from "@playwright/test";
import { hasBackend } from "./support/env";

// Проверки без бэкенда: приложение корректно ведёт себя без настроенной базы и отдаёт безопасные заголовки.
// При наличии бэкенда эти же заголовки проверяет perf.spec.ts.
test.describe("приложение без настроенной базы данных", () => {
  test.skip(hasBackend, "бэкенд настроен: см. остальные сценарии");

  test("главная показывает инструкцию по подключению, а не падает", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const r = await page.goto("/");
    expect(r?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Подключите базу данных" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  for (const path of ["/login", "/register", "/catalog", "/cart", "/admin"]) {
    test(`${path}: инструкция, без 5xx`, async ({ page }) => {
      const r = await page.goto(path);
      expect(r?.status()).toBeLessThan(500);
      await expect(page.getByText("Подключите базу данных")).toBeVisible();
    });
  }

  test("несуществующая страница: 404 с понятным текстом", async ({ page }) => {
    const r = await page.goto("/no-such-page");
    expect(r?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Страница не найдена" })).toBeVisible();
    await page.getByRole("link", { name: "В каталог" }).click();
    await expect(page).toHaveURL(/\/catalog/);
  });

  test("CSV-экспорт без входа недоступен", async ({ request }) => {
    for (const kind of ["products", "orders"]) expect((await request.get(`/admin/export/${kind}`)).status()).toBe(401);
  });

  test("заголовки безопасности и отсутствие утечек в HTML", async ({ request }) => {
    const r = await request.get("/");
    const h = r.headers();
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["permissions-policy"]).toContain("camera=()");
    expect(h["x-powered-by"]).toBeUndefined();
    const html = await r.text();
    expect(html).not.toMatch(/TURSO_AUTH_TOKEN|BLOB_READ_WRITE_TOKEN|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./);
  });

  test("мобильная вёрстка заглушки без горизонтальной прокрутки", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 });
    await page.goto("/login");
    const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    expect(o.sw).toBeLessThanOrEqual(o.iw);
  });
});
