// Тесты бизнес-логики на настоящей SQLite (libSQL в памяти): заказы, склад, промокоды, отмена, сессии, пароли.
// Запуск: npm run test:db (node --test, TS-файлы ядра подключаются напрямую).
import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@libsql/client";
import { migrate } from "../scripts/migrate.mjs";
import { addLine, setLineQuantity } from "../src/lib/core/cart.ts";
import { BizError } from "../src/lib/core/db.ts";
import { adjustStock, placeOrder, quoteOrder, setOrderStatus, shippingCost } from "../src/lib/core/orders.ts";
import { hashPassword, verifyPassword } from "../src/lib/core/password.ts";
import { createSession, deleteSession, findSessionUser } from "../src/lib/core/session.ts";

async function fresh() {
  const db = createClient({ url: "file::memory:" });
  await db.execute("pragma foreign_keys = on");
  await migrate(db, { seed: true });
  return db;
}
const val = async (db, sql, args = []) => Object.values((await db.execute({ sql, args })).rows[0] ?? {})[0];
async function user(db, email = "u@test.demo", role = "customer") {
  const id = crypto.randomUUID();
  await db.execute({ sql: "insert into profiles (id, email, password_hash, full_name, role) values (?, ?, 'x', 'Тест', ?)", args: [id, email, role] });
  return id;
}
/** Вариант с заданным остатком, активный, у активного товара. */
async function variant(db, price, stock) {
  const cat = await val(db, "select id from categories limit 1");
  const pid = crypto.randomUUID(), vid = crypto.randomUUID();
  await db.execute({ sql: "insert into products (id, slug, name, brand, category_id, price) values (?, ?, 'Тестовый товар', 'T', ?, ?)", args: [pid, `t-${pid}`, cat, price] });
  await db.execute({ sql: "insert into product_variants (id, product_id, sku, size, color, color_hex) values (?, ?, ?, 'M', 'Красный', '#ff0000')", args: [vid, pid, `SKU-${vid}`] });
  await db.execute({ sql: "insert into inventory (variant_id, quantity) values (?, ?)", args: [vid, stock] });
  return vid;
}
const order = { name: "Иван", email: "i@test.demo", phone: "+7 555 000-00-00", delivery: "pickup", payment: "card", address: null };
const stock = (db, v) => val(db, "select quantity from inventory where variant_id = ?", [v]);
const rejects = (p, re) => assert.rejects(p, (e) => e instanceof BizError && re.test(e.message));

test("миграции и каталог: 34 товара, 6 категорий, 336 вариантов, 3 промокода", async () => {
  const db = await fresh();
  assert.deepEqual(
    [await val(db, "select count(*) from products"), await val(db, "select count(*) from categories"), await val(db, "select count(*) from product_variants"), await val(db, "select count(*) from promo_codes")],
    [34, 6, 336, 3],
  );
  assert.equal(await val(db, "select count(*) from products p where not exists (select 1 from product_images i where i.product_id = p.id)"), 0);
  await migrate(db, { seed: true }); // повторный запуск ничего не ломает
  assert.equal(await val(db, "select count(*) from products"), 34);
});

test("доставка: самовывоз бесплатно, бесплатно от 15 000, иначе курьер 490 / почта 290", () => {
  assert.deepEqual([shippingCost("pickup", 100), shippingCost("courier", 15000), shippingCost("courier", 14999), shippingCost("post", 100)], [0, 0, 490, 290]);
});

test("заказ: цены из БД, остаток списан, корзина очищена, журнал склада записан", async () => {
  const db = await fresh(), u = await user(db), v = await variant(db, 1500, 5);
  await addLine(db, u, v, 2);
  const id = await placeOrder(db, u, { ...order, delivery: "courier", address: { city: "Москва", street: "Тверская, 1", postal_code: "101000" } });
  const o = (await db.execute({ sql: "select * from orders where id = ?", args: [id] })).rows[0];
  assert.deepEqual([o.subtotal, o.shipping, o.total, o.number, o.status], [3000, 490, 3490, 10001, "pending"]);
  assert.equal(await stock(db, v), 3);
  assert.equal(await val(db, "select count(*) from cart_items where user_id = ?", [u]), 0);
  const m = (await db.execute({ sql: "select delta, balance, reason, order_id from inventory_movements where variant_id = ?", args: [v] })).rows[0];
  assert.deepEqual([m.delta, m.balance, m.reason, m.order_id], [-2, 3, "sale", id]);
});

test("идемпотентность: повтор с тем же ключом возвращает тот же заказ, остаток списан один раз", async () => {
  const db = await fresh(), u = await user(db), v = await variant(db, 1000, 5);
  await addLine(db, u, v, 1);
  const key = crypto.randomUUID();
  const a = await placeOrder(db, u, { ...order, key });
  const b = await placeOrder(db, u, { ...order, key });
  assert.equal(a, b);
  assert.equal(await val(db, "select count(*) from orders"), 1);
  assert.equal(await stock(db, v), 4);
});

test("параллельные заказы: последний товар достаётся одному покупателю", async () => {
  const db = await fresh(), v = await variant(db, 1000, 1);
  const users = [await user(db, "a@t.demo"), await user(db, "b@t.demo")];
  for (const u of users) await addLine(db, u, v, 1);
  const res = await Promise.allSettled(users.map((u) => placeOrder(db, u, order)));
  assert.equal(res.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(await stock(db, v), 0);
  assert.equal(await val(db, "select count(*) from orders"), 1);
});

test("нехватка остатка: заказ отклонён, корзина и склад не тронуты", async () => {
  const db = await fresh(), u = await user(db), v = await variant(db, 1000, 5);
  await addLine(db, u, v, 3);
  await adjustStock(db, { variantId: v, delta: -4, reason: "writeoff" }); // остаток 1 < 3 в корзине
  await rejects(placeOrder(db, u, order), /Недостаточно товара/);
  assert.equal(await stock(db, v), 1);
  assert.equal(await val(db, "select count(*) from cart_items where user_id = ?", [u]), 1);
  assert.equal(await val(db, "select count(*) from orders"), 0);
});

test("пустая корзина, скрытый товар и неполный адрес не проходят", async () => {
  const db = await fresh(), u = await user(db), v = await variant(db, 1000, 5);
  await rejects(placeOrder(db, u, order), /Корзина пуста/);
  await addLine(db, u, v, 1);
  await rejects(placeOrder(db, u, { ...order, delivery: "courier", address: { city: "Москва" } }), /адрес доставки/);
  await db.execute({ sql: "update product_variants set is_active = 0 where id = ?", args: [v] });
  await rejects(placeOrder(db, u, order), /Корзина пуста|недоступные/);
});

test("добавление в корзину ограничено остатком; скрытый товар добавить нельзя", async () => {
  const db = await fresh(), u = await user(db), v = await variant(db, 1000, 3);
  assert.deepEqual(await addLine(db, u, v, 2), { capped: false, total: 2 });
  assert.deepEqual(await addLine(db, u, v, 5), { capped: true, total: 3 });
  const item = await val(db, "select id from cart_items where user_id = ?", [u]);
  await setLineQuantity(db, u, item, 99);
  assert.equal(await val(db, "select quantity from cart_items where id = ?", [item]), 3);
  const other = await user(db, "o@t.demo");
  await rejects(setLineQuantity(db, other, item, 1), /не найден/); // чужую позицию менять нельзя
  await db.execute({ sql: "update product_variants set is_active = 0 where id = ?", args: [v] });
  await rejects(addLine(db, other, v, 1), /нет в наличии/);
});

test("промокоды: процент, фиксированная сумма, минимальная сумма, лимит, срок, неизвестный код", async () => {
  const db = await fresh(), u = await user(db), v = await variant(db, 4000, 50);
  await addLine(db, u, v, 1);
  assert.deepEqual(await quoteOrder(db, u, "welcome10", "pickup"), { subtotal: 4000, discount: 400, shipping: 0, total: 3600 });
  await rejects(quoteOrder(db, u, "SPRING500", "pickup"), /Минимальная сумма/);
  await rejects(quoteOrder(db, u, "NOPE", "pickup"), /не найден/);
  await db.execute("update promo_codes set max_uses = 1, used_count = 1 where code = 'WELCOME10'");
  await rejects(quoteOrder(db, u, "WELCOME10", "pickup"), /исчерпан/);
  await db.execute("update promo_codes set max_uses = null, expires_at = '2020-01-01T00:00:00.000Z' where code = 'WELCOME10'");
  await rejects(quoteOrder(db, u, "WELCOME10", "pickup"), /истёк/);
  await addLine(db, u, v, 1); // 8000
  assert.equal((await quoteOrder(db, u, "SPRING500", "courier")).discount, 500);
});

test("отмена: остаток и промокод возвращаются один раз; конечные статусы не меняются", async () => {
  const db = await fresh(), u = await user(db), v = await variant(db, 4000, 5);
  await addLine(db, u, v, 2);
  const id = await placeOrder(db, u, { ...order, promo: "WELCOME10" });
  assert.equal(await stock(db, v), 3);
  assert.equal(await val(db, "select used_count from promo_codes where code = 'WELCOME10'"), 1);
  await setOrderStatus(db, id, "paid");
  await setOrderStatus(db, id, "cancelled");
  assert.equal(await stock(db, v), 5);
  assert.equal(await val(db, "select used_count from promo_codes where code = 'WELCOME10'"), 0);
  assert.equal(await val(db, "select reason from inventory_movements where variant_id = ? order by created_at desc, rowid desc limit 1", [v]), "return");
  await rejects(setOrderStatus(db, id, "paid"), /нельзя/);
  await setOrderStatus(db, id, "cancelled").catch(() => undefined);
  assert.equal(await stock(db, v), 5); // повторная отмена не вернула товар второй раз
});

test("отправленный заказ нельзя отменить, доставленный — менять", async () => {
  const db = await fresh(), u = await user(db), v = await variant(db, 1000, 5);
  await addLine(db, u, v, 1);
  const id = await placeOrder(db, u, order);
  await setOrderStatus(db, id, "shipped");
  await rejects(setOrderStatus(db, id, "cancelled"), /Отправленный/);
  await setOrderStatus(db, id, "delivered");
  await rejects(setOrderStatus(db, id, "processing"), /нельзя/);
  await rejects(setOrderStatus(db, crypto.randomUUID(), "paid"), /не найден/);
});

test("склад: приход, списание, запрет ухода в минус, валидация", async () => {
  const db = await fresh(), v = await variant(db, 1000, 5);
  assert.equal(await adjustStock(db, { variantId: v, delta: 10, reason: "receipt", note: "поставка" }), 15);
  assert.equal(await adjustStock(db, { variantId: v, delta: -15, reason: "writeoff" }), 0);
  await rejects(adjustStock(db, { variantId: v, delta: -1, reason: "writeoff" }), /Недостаточно/);
  await rejects(adjustStock(db, { variantId: v, delta: -1, reason: "receipt" }), /положительным/);
  await rejects(adjustStock(db, { variantId: v, delta: 0, reason: "adjustment" }), /ненулевым/);
  await rejects(adjustStock(db, { variantId: crypto.randomUUID(), delta: 1, reason: "receipt" }), /не найден/);
  assert.equal(await stock(db, v), 0);
  assert.equal(await val(db, "select count(*) from inventory_movements where variant_id = ?", [v]), 2);
  await assert.rejects(db.execute({ sql: "update inventory set quantity = -1 where variant_id = ?", args: [v] }), /CHECK/); // защита на уровне БД
});

test("роль нельзя задать произвольной строкой; email уникален без учёта регистра", async () => {
  const db = await fresh();
  await user(db, "Dup@Test.demo");
  await assert.rejects(user(db, "dup@test.demo"), /UNIQUE/);
  await assert.rejects(db.execute("insert into profiles (id, email, password_hash, role) values ('x', 'r@t.demo', 'x', 'superuser')"), /CHECK/);
});

test("пароли: scrypt с солью, неверный пароль отклоняется", async () => {
  const h1 = await hashPassword("Correct-horse-1"), h2 = await hashPassword("Correct-horse-1");
  assert.notEqual(h1, h2);
  assert.ok(!h1.includes("Correct-horse"));
  assert.equal(await verifyPassword("Correct-horse-1", h1), true);
  assert.equal(await verifyPassword("wrong-password", h1), false);
  assert.equal(await verifyPassword("x", "garbage"), false);
});

test("сессии: в базе только хэш токена, выход и истечение срока закрывают доступ", async () => {
  const db = await fresh(), u = await user(db, "s@t.demo", "admin");
  const { token } = await createSession(db, u);
  assert.equal(await val(db, "select count(*) from sessions where token_hash = ?", [token]), 0);
  assert.deepEqual((await findSessionUser(db, token)) && { id: (await findSessionUser(db, token)).id, role: (await findSessionUser(db, token)).role }, { id: u, role: "admin" });
  assert.ok(!("password_hash" in (await findSessionUser(db, token))));
  assert.equal(await findSessionUser(db, "forged-token"), null);
  assert.equal(await findSessionUser(db, undefined), null);
  await db.execute("update sessions set expires_at = '2020-01-01T00:00:00.000Z'");
  assert.equal(await findSessionUser(db, token), null);
  const second = await createSession(db, u);
  await deleteSession(db, second.token);
  assert.equal(await findSessionUser(db, second.token), null);
});
