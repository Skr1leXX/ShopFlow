import { expect, test } from "@playwright/test";
import { createUser, readState, sqlVal } from "./support/db";
import { PASSWORD, hasBackend } from "./support/env";
import { login, logout, alertOf } from "./support/helpers";

test.skip(!hasBackend, "нужна база данных (TURSO_DATABASE_URL, см. e2e/README.md)");

test.describe("регистрация и авторизация", () => {
  test("регистрация нового пользователя и автоматический вход", async ({ page }) => {
    const s = readState();
    const email = `e2e-reg-${s.run}@shopflow.test`;
    await page.goto("/register");
    await page.getByLabel("Имя и фамилия").fill("Новый Покупатель");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Пароль").fill(PASSWORD);
    await page.getByRole("button", { name: "Создать аккаунт" }).click();

    // Подтверждения по почте нет (письма не отправляются): после регистрации пользователь сразу вошёл.
    await expect(page.getByRole("heading", { name: "Профиль" })).toBeVisible();
    await expect(page).toHaveURL(/\/account/);
    await expect(page.getByLabel("Имя и фамилия")).toHaveValue("Новый Покупатель");

    // Роль нового пользователя всегда customer.
    expect(await sqlVal("select role from profiles where email = ?", [email])).toBe("customer");
    expect(await sqlVal("select password_hash from profiles where email = ?", [email])).not.toContain(PASSWORD); // пароль не хранится в открытом виде
  });

  test("валидация формы регистрации: короткий пароль и занятый email", async ({ page }) => {
    const s = readState();
    await page.goto("/register");
    await page.getByLabel("Имя и фамилия").fill("Тест");
    await page.getByLabel("Email").fill(s.customer.email);
    await page.getByLabel("Пароль").fill("12345678");
    await page.getByRole("button", { name: "Создать аккаунт" }).click();
    await expect(alertOf(page)).toHaveText("Этот email уже зарегистрирован");
    await expect(page.getByLabel("Пароль")).toHaveAttribute("minlength", "8");
  });

  test("вход, выход и сохранение сессии после перезагрузки", async ({ page }) => {
    const s = readState();
    await login(page, s.customer.email);
    await expect(page).toHaveURL(/\/account/);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Профиль" })).toBeVisible();
    await logout(page);
    await page.goto("/account");
    await expect(page).toHaveURL(/\/login\?next=%2Faccount/);
  });

  test("неверный пароль и несуществующий пользователь дают одинаковую ошибку", async ({ page }) => {
    const s = readState();
    for (const email of [s.customer.email, "nobody-e2e@shopflow.test"]) {
      await page.goto("/login");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Пароль").fill("wrong-password-1");
      await page.getByRole("button", { name: "Войти" }).click();
      await expect(alertOf(page)).toHaveText("Неверный email или пароль");
    }
  });

  test("смена пароля: нужен текущий, новый действует, старый — нет", async ({ page }) => {
    const s = readState();
    const email = `e2e-pw-${s.run}@shopflow.test`;
    await createUser(email, "E2E Пароль");
    await login(page, email);
    await page.goto("/account");
    const form = page.locator("form", { has: page.getByRole("button", { name: "Изменить пароль" }) });
    await form.getByLabel("Текущий пароль").fill("wrong-password-1");
    await form.getByLabel("Новый пароль", { exact: true }).fill("New-Passw0rd!x");
    await form.getByLabel("Повторите новый пароль").fill("New-Passw0rd!x");
    await form.getByRole("button", { name: "Изменить пароль" }).click();
    await expect(alertOf(page)).toHaveText("Текущий пароль указан неверно");
    await form.getByLabel("Текущий пароль").fill(PASSWORD);
    await form.getByLabel("Новый пароль", { exact: true }).fill("New-Passw0rd!x");
    await form.getByLabel("Повторите новый пароль").fill("другой-пароль-1");
    await form.getByRole("button", { name: "Изменить пароль" }).click();
    await expect(alertOf(page)).toHaveText("Пароли не совпадают");
    await form.getByLabel("Текущий пароль").fill(PASSWORD);
    await form.getByLabel("Новый пароль", { exact: true }).fill("New-Passw0rd!x");
    await form.getByLabel("Повторите новый пароль").fill("New-Passw0rd!x");
    await form.getByRole("button", { name: "Изменить пароль" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Пароль изменён" })).toBeVisible();

    await logout(page);
    for (const [pw, ok] of [[PASSWORD, false], ["New-Passw0rd!x", true]] as const) {
      await page.goto("/login");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Пароль").fill(pw);
      await page.getByRole("button", { name: "Войти" }).click();
      if (ok) await expect(page).toHaveURL(/\/account/);
      else await expect(alertOf(page)).toHaveText("Неверный email или пароль");
    }
  });

  test("поддельная или чужая cookie сессии не даёт доступа", async ({ page, context }) => {
    await context.addCookies([{ name: "sf_session", value: "forged-token-value", url: "http://localhost:3300" }]);
    await page.goto("/account");
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login/);
  });

  test("покупатель не попадает в админ-панель и экспорт", async ({ page }) => {
    const s = readState();
    await login(page, s.customer.email);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/account\?denied=1/);
    const r = await page.request.get("/admin/export/products");
    expect(r.status()).toBeGreaterThanOrEqual(300);
    expect(r.headers()["content-type"] ?? "").not.toContain("text/csv");
  });

  test("защита приватных страниц и возврат по ссылке next", async ({ page }) => {
    const s = readState();
    for (const path of ["/account", "/account/orders", "/checkout", "/admin", "/admin/products"]) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(path).replace(/%/g, "%")}`));
    }
    await login(page, s.customer.email, "/account/orders");
    await expect(page).toHaveURL(/\/account\/orders$/);
  });

  test("open redirect через next не работает", async ({ page }) => {
    const s = readState();
    await login(page, s.customer.email, "//evil.example.com");
    await expect(page).toHaveURL(/localhost:3300\/account/);
  });

  test("вошедший пользователь не видит страницу входа", async ({ page }) => {
    const s = readState();
    await login(page, s.customer.email);
    await page.goto("/login");
    await expect(page).toHaveURL(/\/account/);
  });
});
