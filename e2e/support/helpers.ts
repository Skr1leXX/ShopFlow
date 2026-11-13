import { expect, type Page } from "@playwright/test";
import { PASSWORD } from "./env";

export async function login(page: Page, email: string, next?: string) {
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Пароль").fill(PASSWORD);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

export async function logout(page: Page) {
  await page.getByRole("button", { name: "Аккаунт" }).or(page.locator("summary[aria-label='Аккаунт']")).first().click();
  await page.getByRole("button", { name: "Выйти" }).click();
  await expect(page.getByRole("link", { name: "Войти" }).first()).toBeVisible();
}

/** Выбирает размер M и добавляет товар в корзину на странице товара. */
export async function addToCartOnProduct(page: Page, slug: string, size = "M") {
  await page.goto(`/product/${slug}`);
  if (size) await page.getByRole("button", { name: size, exact: true }).click();
  await page.getByRole("button", { name: /В корзину/ }).click();
  await expect(page.getByText(/добавлен|максимум/i).first()).toBeVisible();
}

/** Собирает ошибки консоли и неудачные запросы приложения за время теста. */
export function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    // Внешние картинки и расширения браузера не считаем ошибками приложения.
    if (m.type() === "error" && !/Failed to load resource|favicon|net::ERR/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  page.on("response", (r) => {
    const u = new URL(r.url());
    if (u.origin === new URL(page.url() || "http://localhost").origin && r.status() >= 500) errors.push(`${r.status()} ${u.pathname}`);
  });
  return errors;
}

/** Уведомления об ошибках приложения. Служебный объявитель Next.js (тоже role=alert) не учитывается. */
export const alertOf = (page: Page) => page.locator("main [role=alert]");

export const money = (n: number) => new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(n).replace(/\s/g, " ");
export const normalize = (s: string) => s.replace(/[  ]/g, " ");
