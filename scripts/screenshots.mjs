// Делает скриншоты для README и демонстрации в docs/screenshots. Нужен запущенный сайт с демо-данными
// (npm run seed:demo) и DEMO_PASSWORD. Запуск: npm run build && npm start, затем в другом окне npm run screenshots.
// Переменные: BASE_URL (по умолчанию http://localhost:3000), DEMO_PASSWORD, E2E_BROWSER_PATH (необязательно).
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const password = process.env.DEMO_PASSWORD;
if (!password) { console.error("Задайте DEMO_PASSWORD (пароль демо-аккаунтов из seed:demo)"); process.exit(1); }

const candidates = [
  process.env.E2E_BROWSER_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];
const executablePath = candidates.find((c) => c && fs.existsSync(c));
const out = path.join(process.cwd(), "docs", "screenshots");
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch(executablePath ? { executablePath } : {});

async function login(page, email) {
  await page.goto(`${base}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Пароль").fill(password);
  await page.getByRole("button", { name: "Войти" }).click();
  await page.waitForURL(/\/account/);
}
const shot = async (page, name, url, opts = {}) => {
  await page.goto(`${base}${url}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: opts.full ?? false });
  console.log("  ", name);
};

// Витрина (гость), десктоп
let ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
let page = await ctx.newPage();
await shot(page, "01-home", "/");
await shot(page, "02-catalog", "/catalog?category=outerwear");
const slug = await page.locator("article a").first().getAttribute("href");
await shot(page, "03-product", slug);
await ctx.close();

// Покупатель: корзина, оформление, заказы
ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
page = await ctx.newPage();
await login(page, "anna@shopflow.demo");
await page.goto(`${base}${slug}`);
await page.getByRole("button", { name: /^(XS|S|M|L|XL|\d+|Один размер)$/ }).and(page.locator("button:enabled")).first().click().catch(() => undefined);
await page.getByRole("button", { name: /В корзину/ }).click();
await page.waitForTimeout(800);
await shot(page, "04-cart", "/cart");
await shot(page, "05-checkout", "/checkout");
await shot(page, "06-account-orders", "/account/orders");
await ctx.close();

// Администратор
ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
page = await ctx.newPage();
await page.goto(`${base}/login?next=/admin`);
await page.getByLabel("Email").fill("admin@shopflow.demo");
await page.getByLabel("Пароль").fill(password);
await page.getByRole("button", { name: "Войти" }).click();
await page.waitForURL((u) => u.pathname === "/admin");
await shot(page, "07-admin-dashboard", "/admin", { full: true });
await shot(page, "08-admin-products", "/admin/products");
await shot(page, "09-admin-orders", "/admin/orders");
await shot(page, "10-admin-inventory", "/admin/inventory");
await ctx.close();

// Телефон
ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "ru-RU" });
page = await ctx.newPage();
await shot(page, "11-mobile-home", "/");
await shot(page, "12-mobile-catalog", "/catalog");
await ctx.close();

await browser.close();
console.log(`\nГотово: ${out}`);
