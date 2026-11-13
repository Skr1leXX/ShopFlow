// Демо-данные для показа: аккаунты администратора и покупателей, адреса, избранное и заказы за последние ~4 недели.
// Нужны NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY (только локально: node --env-file=.env.local scripts/seed-demo.mjs).
// Пароль: DEMO_PASSWORD или случайный (печатается один раз). Все данные вымышленные: домен .demo, телефоны 555.
// Повторный запуск безопасен: пользователи обновляются, заказы создаются только если их ещё нет.
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Задайте NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY (npm run seed:demo читает .env.local)");
  process.exit(1);
}
const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
const password = process.env.DEMO_PASSWORD ?? randomBytes(9).toString("base64url");
if (password.length < 8) { console.error("DEMO_PASSWORD должен быть не короче 8 символов"); process.exit(1); }

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

// Заказы: [пользователь, статус, доставка, оплата, дней назад, промокод?, [[slug, размер, кол-во], …]]
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

async function ensureUser(u) {
  const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
  let user = list?.users.find((x) => x.email === u.email);
  if (!user) {
    const { data, error } = await db.auth.admin.createUser({ email: u.email, password, email_confirm: true, user_metadata: { full_name: u.name } });
    if (error) throw error;
    user = data.user;
  } else if (process.env.DEMO_PASSWORD) {
    await db.auth.admin.updateUserById(user.id, { password });
  }
  // Роль меняется только здесь, через service role: клиентам это запрещено триггером и RLS.
  const { error } = await db.from("profiles").update({ role: u.role, full_name: u.name, phone: u.phone }).eq("id", user.id);
  if (error) throw error;
  return user.id;
}

const ids = {};
for (const u of USERS) ids[u.email] = await ensureUser(u);

// адреса и избранное
for (const [email, a] of Object.entries(ADDRESS)) {
  const { count } = await db.from("addresses").select("id", { count: "exact", head: true }).eq("user_id", ids[email]);
  if (!count) {
    const u = USERS.find((x) => x.email === email);
    await db.from("addresses").insert({ ...a, user_id: ids[email], recipient: u.name, phone: u.phone, is_default: true }).throwOnError();
  }
}
for (const [email, slugs] of Object.entries(FAVORITES)) {
  const { data: prods } = await db.from("products").select("id").in("slug", slugs);
  await db.from("favorites").upsert((prods ?? []).map((p) => ({ user_id: ids[email], product_id: p.id })), { ignoreDuplicates: true });
}

const { count: existing } = await db.from("orders").select("id", { count: "exact", head: true }).in("user_id", Object.values(ids));
if (existing) {
  console.log(`Демо-заказы уже есть (${existing}), пропускаю создание.`);
} else {
  const variantOf = async (slug, size) => {
    const { data } = await db.from("product_variants").select("id,size,color,products!inner(id,name,price,slug,product_images(url,sort_order))").eq("products.slug", slug).eq("size", size).limit(1);
    if (!data?.length) throw new Error(`В каталоге нет варианта ${slug} / ${size}: сначала выполните supabase/seed.sql`);
    return data[0];
  };
  const { data: promos } = await db.from("promo_codes").select("id,discount_percent,code");
  let created = 0;
  for (const [email, status, delivery, payment, daysAgo, promoCode, lines] of ORDERS) {
    const items = [];
    for (const [slug, size, qty] of lines) items.push({ v: await variantOf(slug, size), qty });
    const subtotal = items.reduce((s, i) => s + Number(i.v.products.price) * i.qty, 0);
    const promo = promoCode ? promos?.find((p) => p.code === promoCode) : null;
    const discount = promo ? Math.round((subtotal * promo.discount_percent) / 100) : 0;
    const shipping = delivery === "pickup" || subtotal - discount >= 15000 ? 0 : delivery === "courier" ? 490 : 290;
    const u = USERS.find((x) => x.email === email);
    const when = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
    const { data: order, error } = await db.from("orders").insert({
      user_id: ids[email], status, subtotal, discount, shipping, total: subtotal - discount + shipping, promo_code_id: promo?.id ?? null,
      contact_name: u.name, contact_email: u.email, contact_phone: u.phone, delivery_method: delivery, payment_method: payment,
      shipping_address: delivery === "pickup" ? {} : (({ city, street, postal_code }) => ({ city, street, postal_code }))(ADDRESS[email]),
      created_at: when, updated_at: when,
    }).select("id").single();
    if (error) throw error;
    await db.from("order_items").insert(items.map(({ v, qty }) => ({
      order_id: order.id, variant_id: v.id, product_id: v.products.id, product_name: v.products.name, size: v.size, color: v.color,
      image_url: [...v.products.product_images].sort((a, b) => a.sort_order - b.sort_order)[0]?.url ?? null, unit_price: v.products.price, quantity: qty,
    }))).throwOnError();
    created++;
  }
  const used = ORDERS.filter((o) => o[5] === "WELCOME10").length;
  if (used) await db.from("promo_codes").update({ used_count: used }).eq("code", "WELCOME10");
  console.log(`Создано демо-заказов: ${created} (остатки они не списывают: заказы вставлены напрямую)`);
}

console.log("\nДемо-аккаунты (вымышленные, только для демонстрационного проекта):");
USERS.forEach((u) => console.log(`  ${u.role.padEnd(8)} ${u.email}`));
console.log(`Пароль: ${process.env.DEMO_PASSWORD ? "(значение DEMO_PASSWORD)" : password}`);
