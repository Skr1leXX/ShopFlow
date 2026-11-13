import { expect, test } from "@playwright/test";
import { readState } from "./support/db";
import { hasBackend } from "./support/env";

test.skip(!hasBackend, "нужна база данных (TURSO_DATABASE_URL, см. e2e/README.md)");

// Бюджеты рассчитаны на production-сборку на локальной машине; цель — ловить регрессии (лишние запросы, тяжёлые страницы).
test.describe("производительность", () => {
  test("каталог: число запросов, вес страницы и скорость загрузки", async ({ page }) => {
    const s = readState();
    const reqs: { url: string; type: string; size: number }[] = [];
    page.on("requestfinished", async (r) => {
      const size = (await r.sizes().catch(() => null))?.responseBodySize ?? 0;
      reqs.push({ url: r.url(), type: r.resourceType(), size });
    });
    await page.goto(`/catalog?category=e2e-${s.run}`, { waitUntil: "networkidle" });
    const nav = await page.evaluate(() => {
      const n = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
      return { dcl: n.domContentLoadedEventEnd, ttfb: n.responseStart };
    });
    const app = reqs.filter((r) => new URL(r.url).origin === "http://localhost:3300");
    const js = app.filter((r) => r.type === "script").reduce((n, r) => n + r.size, 0);
    expect(nav.ttfb, "TTFB").toBeLessThan(1500);
    expect(nav.dcl, "DOMContentLoaded").toBeLessThan(3500);
    expect(js / 1024, "JS на странице каталога, КБ (сжатый)").toBeLessThan(450);
    expect(app.filter((r) => (r.type === "fetch" || r.type === "xhr") && !r.url.includes("_rsc=")).length, "лишние XHR/fetch при открытии").toBeLessThanOrEqual(2);
    expect(reqs.length, "всего запросов").toBeLessThan(60);
  });

  test("изображения: оптимизатор, современные форматы, кэш, ленивая загрузка", async ({ page }) => {
    const s = readState();
    const images: { type: string | undefined; cache: string | undefined; w: number }[] = [];
    page.on("response", (r) => {
      if (new URL(r.url()).pathname === "/_next/image")
        images.push({ type: r.headers()["content-type"], cache: r.headers()["cache-control"], w: Number(new URL(r.url()).searchParams.get("w")) });
    });
    await page.goto(`/catalog?category=e2e-${s.run}`, { waitUntil: "networkidle" });
    expect(images.length).toBeGreaterThan(0);
    for (const i of images) {
      expect(i.type).toMatch(/image\/(avif|webp)/);
      expect(i.cache).toContain("max-age");
    }
    // Картинки ниже первого экрана грузятся лениво, первый ряд — сразу.
    const lazy = await page.locator("article img").evaluateAll((l) => l.map((i) => i.getAttribute("loading")));
    expect(lazy.filter((x) => x === "lazy").length).toBeGreaterThan(0);
    const heroPage = await page.goto("/");
    expect(heroPage?.status()).toBe(200);
    const hero = page.locator("section img").first();
    expect(await hero.getAttribute("loading")).not.toBe("lazy"); // LCP-изображение грузится сразу (preload)
  });

  test("главная и товар: быстрый ответ сервера и заголовки безопасности", async ({ request }) => {
    const s = readState();
    for (const path of ["/", "/catalog", `/product/${s.products.tee.slug}`]) {
      const t = Date.now();
      const r = await request.get(path);
      expect(r.status()).toBe(200);
      expect(Date.now() - t, `${path}`).toBeLessThan(2500);
      expect(r.headers()["x-frame-options"]).toBe("DENY");
      expect(r.headers()["x-content-type-options"]).toBe("nosniff");
    }
  });

  test("в клиентском коде нет секретов", async ({ page }) => {
    const s = readState();
    const bodies: string[] = [];
    page.on("response", async (r) => {
      const ct = r.headers()["content-type"] ?? "";
      if (/javascript|html|json/.test(ct)) bodies.push(await r.text().catch(() => ""));
    });
    await page.goto(`/product/${s.products.tee.slug}`, { waitUntil: "networkidle" });
    const secrets = [process.env.TURSO_AUTH_TOKEN, process.env.BLOB_READ_WRITE_TOKEN].filter((v): v is string => !!v);
    for (const b of bodies) {
      for (const k of secrets) expect(b.includes(k)).toBe(false);
      expect(b).not.toMatch(/TURSO_AUTH_TOKEN|BLOB_READ_WRITE_TOKEN|password_hash/);
    }
  });
});
