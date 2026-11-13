import { expect, test } from "@playwright/test";
import { admin, readState } from "./support/db";
import { PASSWORD, hasBackend } from "./support/env";
import { login, logout, alertOf } from "./support/helpers";

test.skip(!hasBackend, "нужен проект Supabase (см. e2e/README.md)");

test.describe("регистрация и авторизация", () => {
  test("регистрация нового пользователя, затем вход после подтверждения", async ({ page }) => {
    const s = readState();
    const email = `e2e-reg-${s.run}@shopflow.test`;
    await page.goto("/register");
    await page.getByLabel("Имя и фамилия").fill("Новый Покупатель");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Пароль").fill(PASSWORD);
    await page.getByRole("button", { name: "Создать аккаунт" }).click();

    // Если в проекте включено подтверждение email — показываем сообщение, иначе сразу входим.
    await expect(page.getByText(/отправили письмо/).or(page.getByRole("heading", { name: "Профиль" }))).toBeVisible();
    if (await page.getByText(/отправили письмо/).isVisible()) {
      const { data } = await admin().auth.admin.listUsers({ perPage: 1000 });
      const u = data.users.find((x) => x.email === email)!;
      await admin().auth.admin.updateUserById(u.id, { email_confirm: true });
      await login(page, email);
    }
    await expect(page).toHaveURL(/\/account/);
    await expect(page.getByLabel("Имя и фамилия")).toHaveValue("Новый Покупатель");

    // Роль нового пользователя всегда customer.
    const { data: prof } = await admin().from("profiles").select("role").eq("email", email).single();
    expect(prof?.role).toBe("customer");
  });

  test("валидация формы регистрации: короткий пароль и занятый email", async ({ page }) => {
    const s = readState();
    await page.goto("/register");
    await page.getByLabel("Имя и фамилия").fill("Тест");
    await page.getByLabel("Email").fill(s.customer.email);
    await page.getByLabel("Пароль").fill("12345678");
    await page.getByRole("button", { name: "Создать аккаунт" }).click();
    // Занятый email: Supabase либо возвращает ошибку, либо (при включённом подтверждении) нейтральный ответ.
    await expect(alertOf(page).or(page.getByRole("status"))).toBeVisible();
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

  test("восстановление пароля: нейтральный ответ для любого адреса", async ({ page }) => {
    const s = readState();
    for (const email of [s.customer.email, "unknown-e2e@shopflow.test"]) {
      await page.goto("/forgot-password");
      await page.getByLabel("Email").fill(email);
      await page.getByRole("button", { name: "Отправить ссылку" }).click();
      await expect(page.getByRole("status")).toContainText("Если такой адрес зарегистрирован");
    }
  });

  test("страница нового пароля без ссылки из письма недоступна", async ({ page }) => {
    await page.goto("/reset-password");
    await expect(page).toHaveURL(/\/login\?error=link/);
    await expect(alertOf(page)).toContainText("Ссылка недействительна");
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
