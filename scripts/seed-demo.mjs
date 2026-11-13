// Демо-данные для показа: аккаунты администратора и покупателей, адреса, избранное и заказы за последние ~4 недели.
// Заказы создаются тем же кодом, что и в магазине (placeOrder / setOrderStatus), поэтому остатки и журнал склада согласованы.
// Нужен TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN для облачной базы); миграции и каталог: npm run db:setup.
// Запуск: npm run seed:demo. Пароль: DEMO_PASSWORD или случайный (печатается один раз). Все данные вымышленные: домен .demo, телефоны 555.
// Повторный запуск безопасен: пользователи обновляются, заказы создаются только если их ещё нет.
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@libsql/client";
import { addLine } from "../src/lib/core/cart.ts";
import { adjustStock, placeOrder, setOrderStatus } from "../src/lib/core/orders.ts";
import { hashPassword } from "../src/lib/core/password.ts";

const url = process.env.TURSO_DATABASE_URL;
if (!url) {
  console.error("Задайте TURSO_DATABASE_URL (npm run seed:demo читает .env.local) и выполните npm run db:setup");
  process.exit(1);
}
const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
const password = process.env.DEMO_PASSWORD ?? randomBytes(9).toString("base64url");
if (password.length < 8) { console.error("DEMO_PASSWORD должен быть не короче 8 символов"); process.exit(1); }
if ((await db.execute("select count(*) n from products")).rows[0].n === 0) {
  console.error("В базе нет каталога: сначала выполните npm run db:setup");
  process.exit(1);
}

const USERS = [
  { email: "admin@shopflow.demo", name: "Администратор Демо", role: "admin", phone: "+7 555 000-00-01" },
  { email: "anna@shopflow.demo", name: "Анна Смирнова", role: "customer", phone: "+7 555 000-00-02" },
  { email: "ivan@shopflow.demo", name: "Иван Петров", role: "customer", phone: "+7 555 000-00-03" },
  { email: "maria@shopflow.demo", name: "Мария Орлова", role: "customer", phone: "+7 555 000-00-04" },
];
const ADDRESS = {
  "anna@shopflow.demo": { label: "Дом", city: "Москва", street: "ул. Тестовая, д. 1, кв. 12", postal_code: "101000" },
  "ivan@shopflow.demo": { label: "Работа", city: "Казань", street: "пр. Примерный, д. 7", postal_code: "420000" },
  "maria@shopflow.demo": { label: "Дом", city: "Новосибирск", street: "ул. Демонстрационная, д. 3, кв. 40", postal_code: "630000" },
};

// Заказы: [пользователь, конечный статус, доставка, оплата, дней назад, промокод?, [[slug, размер, кол-во], …]]
const ORDERS = [
  ["anna@shopflow.demo", "delivered", "courier", "card", 26, null, [["linen-shirt", "M", 1], ["jeans-straight", "30", 1]]],
  ["ivan@shopflow.demo", "delivered", "pickup", "cash", 22, null, [["sneakers-court", "42", 1]]],
  ["maria@shopflow.demo", "delivered", "post", "card", 18, "WELCOME10", [["knit-crew", "S", 1], ["scarf-wool", "Один размер", 1]]],
  ["anna@shopflow.demo", "shipped", "courier", "card", 9, null, [["coat-wool", "M", 1]]],
  ["ivan@shopflow.demo", "processing", "courier", "invoice", 5, null, [["hoodie-oversize", "L", 2], ["cap-classic", "Один размер", 1]]],
  ["maria@shopflow.demo", "paid", "courier", "card", 3, null, [["trench-city", "S", 1]]],
  ["anna@shopflow.demo", "pending", "pickup", "cash", 1, null, [["backpack-daily", "Один размер", 1]]],
  ["ivan@shopflow.demo", "cancelled", "courier", "card", 12, null, [["boots-chelsea", "43", 1]]],
];
const FAVORITES = { "anna@shopflow.demo": ["bomber-core", "watch-minimal", "sneakers-runner"], "maria@shopflow.demo": ["blazer-soft", "tote-canvas"] };
// Путь статусов до конечного (отмена — прямо из «Новый»).
const PATH = { pending: [], paid: ["paid"], processing: ["paid", "processing"], shipped: ["paid", "processing", "shipped"], delivered: ["paid", "processing", "shipped", "delivered"], cancelled: ["cancelled"] };

const ids = {};
const hash = await hashPassword(password);
for (const u of USERS) {
  const found = (await db.execute({ sql: "select id from profiles where email = ?", args: [u.email] })).rows[0];
  if (found) {
    ids[u.email] = found.id;
    await db.execute({ sql: `update profiles set role = ?, full_name = ?, phone = ?${process.env.DEMO_PASSWORD ? ", password_hash = ?" : ""} where id = ?`, args: [u.role, u.name, u.phone, ...(process.env.DEMO_PASSWORD ? [hash] : []), found.id] });
  } else {
    ids[u.email] = randomUUID();
    await db.execute({ sql: "insert into profiles (id, email, password_hash, full_name, phone, role) values (?, ?, ?, ?, ?, ?)", args: [ids[u.email], u.email, hash, u.name, u.phone, u.role] });
  }
}

for (const [email, a] of Object.entries(ADDRESS)) {
  const n = (await db.execute({ sql: "select count(*) n from addresses where user_id = ?", args: [ids[email]] })).rows[0].n;
  const u = USERS.find((x) => x.email === email);
  if (!n) await db.execute({ sql: "insert into addresses (id, user_id, label, recipient, phone, city, street, postal_code, is_default) values (?, ?, ?, ?, ?, ?, ?, ?, 1)", args: [randomUUID(), ids[email], a.label, u.name, u.phone, a.city, a.street, a.postal_code] });
}
for (const [email, slugs] of Object.entries(FAVORITES))
  for (const slug of slugs)
    await db.execute({ sql: "insert or ignore into favorites (user_id, product_id) select ?, id from products where slug = ?", args: [ids[email], slug] });

const placeholders = Object.values(ids).map(() => "?").join(",");
const existing = (await db.execute({ sql: `select count(*) n from orders where user_id in (${placeholders})`, args: Object.values(ids) })).rows[0].n;
if (existing) {
  console.log(`Демо-заказы уже есть (${existing}), пропускаю создание.`);
} else {
  const variantOf = async (slug, size) => {
    const r = (await db.execute({ sql: "select pv.id, coalesce(i.quantity, 0) stock from product_variants pv join products p on p.id = pv.product_id left join inventory i on i.variant_id = pv.id where p.slug = ? and pv.size = ? limit 1", args: [slug, size] })).rows[0];
    if (!r) throw new Error(`В каталоге нет варианта ${slug} / ${size}: сначала выполните npm run db:setup`);
    return r;
  };
  for (const [email, status, delivery, payment, daysAgo, promo, lines] of ORDERS) {
    const u = USERS.find((x) => x.email === email);
    for (const [slug, size, qty] of lines) {
      const v = await variantOf(slug, size);
      if (v.stock < qty) await adjustStock(db, { variantId: v.id, delta: qty - v.stock + 3, reason: "receipt", note: "Поставка под демо-заказы" });
      await addLine(db, ids[email], v.id, qty);
    }
    const orderId = await placeOrder(db, ids[email], {
      name: u.name, email: u.email, phone: u.phone, delivery, payment, promo,
      address: delivery === "pickup" ? null : (({ city, street, postal_code }) => ({ city, street, postal_code }))(ADDRESS[email]),
    });
    for (const s of PATH[status]) await setOrderStatus(db, orderId, s);
    // Задним числом: заказы и движения по складу «случились» daysAgo дней назад.
    const when = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
    await db.execute({ sql: "update orders set created_at = ?, updated_at = ? where id = ?", args: [when, when, orderId] });
    await db.execute({ sql: "update inventory_movements set created_at = ? where order_id = ?", args: [when, orderId] });
  }
  console.log(`Создано демо-заказов: ${ORDERS.length} (через тот же код, что и в магазине: остатки и журнал склада согласованы)`);
}

console.log("\nДемо-аккаунты (вымышленные, только для демонстрационной базы):");
USERS.forEach((u) => console.log(`  ${u.role.padEnd(8)} ${u.email}`));
console.log(`Пароль: ${process.env.DEMO_PASSWORD ? "(значение DEMO_PASSWORD)" : password}`);
