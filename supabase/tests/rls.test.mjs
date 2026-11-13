// Проверка миграций, seed и политик RLS на локальном PostgreSQL (pglite). Запуск: npm run test:db
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const db = new PGlite({ extensions: { pgcrypto, pg_trgm } });

// Заглушки того, что Supabase даёт из коробки.
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth; create schema storage;
  create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects(id uuid default gen_random_uuid() primary key, bucket_id text, name text);
  alter table storage.objects enable row level security;
  grant usage on schema public, auth, storage to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  grant select, insert, update, delete on storage.objects to anon, authenticated;
`);

for (const f of fs.readdirSync(`${root}/migrations`).sort()) {
  await db.exec(fs.readFileSync(`${root}/migrations/${f}`, "utf8"));
  console.log("applied", f);
}
// Supabase по умолчанию выдаёт эти права; безопасность обеспечивает RLS.
await db.exec(`grant select, insert, update, delete on all tables in schema public to anon, authenticated;
  grant usage on all sequences in schema public to anon, authenticated;`);

const seed = fs.readFileSync(`${root}/seed.sql`, "utf8");
await db.exec(seed);
await db.exec(seed); // seed должен быть идемпотентным

const U = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const users = { anna: U(1), boris: U(2), admin: U(9) };
for (const [name, id] of Object.entries(users))
  await db.exec(`insert into auth.users(id, email, raw_user_meta_data) values ('${id}', '${name}@x.test',
    '{"full_name":"${name}","role":"admin"}')`); // role в метаданных обязан игнорироваться
await db.exec(`update public.profiles set role = 'admin' where id = '${users.admin}'`); // серверный контекст

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`);
};

// Выполняет запросы от имени пользователя; транзакция всегда откатывается (commit=true — сохранить).
async function run(who, sql, commit = false) {
  await db.exec("begin");
  try {
    if (who === "anon") await db.exec("set local role anon");
    else {
      await db.exec("set local role authenticated");
      await db.exec(`select set_config('request.jwt.claim.sub', '${users[who]}', true)`);
    }
    let r;
    for (const q of [].concat(sql)) r = await db.query(q);
    if (commit) await db.exec("commit");
    return { rows: r.rows, affected: r.affectedRows };
  } catch (e) {
    if (commit) await db.exec("rollback");
    return { error: e.message };
  } finally {
    if (!commit) await db.exec("rollback");
  }
}
const count = async (who, table, where = "true") => (await run(who, `select count(*)::int c from public.${table} where ${where}`)).rows?.[0]?.c;

// ── seed ──
check("seed: 34 товара, 6 категорий", (await count("admin", "products")) === 34 && (await count("admin", "categories")) === 6);
check("seed: у каждого товара есть фото и варианты",
  (await run("admin", `select count(*)::int c from public.products p where not exists (select 1 from public.product_images i where i.product_id=p.id) or not exists (select 1 from public.product_variants v where v.product_id=p.id)`)).rows[0].c === 0);
check("seed: идемпотентен (повторный запуск не дублирует)", (await count("admin", "product_variants")) === 336);

// ── роли ──
const roleOf = async (n) => (await run("admin", `select role from public.profiles where id='${users[n]}'`)).rows[0].role;
check("регистрация создаёт customer, роль из metadata игнорируется", (await roleOf("anna")) === "customer");
check("при регистрации создаётся корзина", (await count("anna", "carts")) === 1);
check("customer не может сделать себя админом",
  !!(await run("anna", `update public.profiles set role='admin' where id='${users.anna}'`)).error);
check("customer может обновить своё имя",
  (await run("anna", `update public.profiles set full_name='Анна' where id='${users.anna}'`)).affected === 1);
check("customer не видит и не меняет чужой профиль",
  (await count("anna", "profiles")) === 1 &&
  (await run("anna", `update public.profiles set full_name='x' where id='${users.boris}'`)).affected === 0);
check("админ видит все профили", (await count("admin", "profiles")) === 3);

// ── каталог ──
check("anon читает каталог", (await count("anon", "products")) === 34 && (await count("anon", "inventory")) > 0);
check("anon не пишет в каталог", (await run("anon", `update public.products set price=1`)).affected === 0 && !!(await run("anon", `insert into public.categories(slug,name) values ('h','x')`)).error);
check("customer не пишет в каталог",
  (await run("anna", `update public.products set price=1`)).affected === 0 &&
  (await run("anna", `insert into public.categories(slug,name) values ('hack','x')`)).error !== undefined);
check("админ пишет в каталог", (await run("admin", `update public.products set is_featured=true where slug='basic-tee-heavy'`)).affected === 1);
check("скрытый товар не виден anon",
  (await run("admin", [`update public.products set is_active=false where slug='cap-classic'`], true)).affected === 1 &&
  (await count("anon", "products")) === 33 && (await count("anon", "product_variants", "true")) < 336);
await run("admin", `update public.products set is_active=true where slug='cap-classic'`, true);

check("поиск без учёта регистра работает по-русски (ilike)",
  (await count("anon", "products", "name ilike '%пальто%' or description ilike '%ПАЛЬТО%'")) === 1);

// ── фасеты каталога ──
const facets = (await run("anon", `select public.catalog_facets() f`)).rows[0].f;
check("catalog_facets: бренды, размеры, цвета и диапазон цен одним запросом для anon",
  facets.brands.length === 5 && facets.sizes.includes("M") && facets.sizes.includes("42") && facets.colors.length === 9 && facets.min === 1890 && facets.max === 24900,
  JSON.stringify({ b: facets.brands.length, c: facets.colors.length, min: facets.min, max: facets.max }));
check("catalog_facets не показывает скрытые товары",
  (await run("admin", [`update public.products set is_active=false where brand='Orbit'`, `select public.catalog_facets() f`])).rows[0].f.brands.length === 4);

// ── промокоды ──
check("anon/customer не видят промокоды", (await count("anon", "promo_codes")) === 0 && (await count("anna", "promo_codes")) === 0);
check("customer не создаёт промокоды",
  !!(await run("anna", `insert into public.promo_codes(code,discount_percent) values ('HACK',99)`)).error);

// ── корзина и заказ ──
const variant = async (slug, minStock = 3) => (await run("admin",
  `select pv.id from public.product_variants pv join public.products p on p.id=pv.product_id join public.inventory i on i.variant_id=pv.id
   where p.slug='${slug}' and i.quantity>=${minStock} order by pv.sku limit 1`)).rows[0].id;
const cartOf = async (n) => (await db.query(`select id from public.carts where user_id='${users[n]}'`)).rows[0].id; // чужие корзины не видны даже админу
const v1 = await variant("basic-tee-heavy"), v2 = await variant("jeans-straight");
const annaCart = await cartOf("anna"), borisCart = await cartOf("boris");

check("customer кладёт товар в свою корзину",
  (await run("anna", `insert into public.cart_items(cart_id,variant_id,quantity) values ('${annaCart}','${v1}',2)`, true)).affected === 1);
check("customer не кладёт товар в чужую корзину",
  !!(await run("anna", `insert into public.cart_items(cart_id,variant_id,quantity) values ('${borisCart}','${v1}',1)`)).error);
check("чужую корзину не видно и не изменить",
  (await count("boris", "cart_items")) === 0 &&
  (await run("boris", `update public.cart_items set quantity=50`)).affected === 0 &&
  (await run("boris", `delete from public.cart_items`)).affected === 0);
check("количество в корзине ограничено", !!(await run("anna", `update public.cart_items set quantity=0`)).error);

await run("anna", `insert into public.cart_items(cart_id,variant_id,quantity) values ('${annaCart}','${v2}',1)`, true);
const addr = `'{"city":"Москва","street":"Тверская 1","postal_code":"125009"}'::jsonb`;
const place = (who, promo = "null", delivery = "courier", key = "null") =>
  run(who, `select public.place_order('Анна','anna@x.test','+79990000000','${delivery}','card',${addr},'',${promo},${key}) id`, true);

check("прямой INSERT в orders запрещён",
  !!(await run("anna", `insert into public.orders(user_id,subtotal,total,contact_name,contact_email,contact_phone,delivery_method,payment_method,shipping_address)
    values ('${users.anna}',1,1,'a','a','a','courier','card','{}')`)).error);
check("анонимный place_order запрещён", !!(await run("anon", `select public.place_order('a','a','a','courier','card','{}'::jsonb,'',null)`)).error);
check("quote_order считает цены из БД",
  (await run("anna", `select public.quote_order('WELCOME10','courier') q`)).rows[0].q.discount > 0);
check("неверный промокод отклоняется", !!(await run("anna", `select public.quote_order('NOPE','courier')`)).error);

const before = (await run("admin", `select quantity from public.inventory where variant_id='${v1}'`)).rows[0].quantity;
const KEY = "'11111111-1111-1111-1111-111111111111'";
const placed = await place("anna", "'WELCOME10'", "courier", KEY);
check("place_order создаёт заказ", !placed.error && placed.rows[0].id, placed.error);
const orderId = placed.rows?.[0]?.id;
const order = (await run("admin", `select * from public.orders where id='${orderId}'`)).rows[0];
check("итог = товары − скидка + доставка",
  Number(order.total) === Number(order.subtotal) - Number(order.discount) + Number(order.shipping) && Number(order.discount) > 0);
check("корзина очищена, остаток списан, промокод засчитан",
  (await count("anna", "cart_items")) === 0 &&
  (await run("admin", `select quantity from public.inventory where variant_id='${v1}'`)).rows[0].quantity === before - 2 &&
  (await run("admin", `select used_count from public.promo_codes where code='WELCOME10'`)).rows[0].used_count === 1);
check("пустую корзину оформить нельзя", !!(await place("anna")).error);
const repeat = await place("anna", "'WELCOME10'", "courier", KEY);
check("повтор запроса с тем же ключом возвращает тот же заказ, без двойного списания",
  repeat.rows?.[0]?.id === orderId && (await count("anna", "orders")) === 1 &&
  (await run("admin", `select quantity from public.inventory where variant_id='${v1}'`)).rows[0].quantity === before - 2 &&
  (await run("admin", `select used_count from public.promo_codes where code='WELCOME10'`)).rows[0].used_count === 1);
check("ключ одного пользователя не даёт доступ к заказу другого",
  (await place("boris", "null", "pickup", KEY)).rows?.[0]?.id !== orderId);

check("покупатель видит свой заказ и позиции", (await count("anna", "orders")) === 1 && (await count("anna", "order_items")) === 2);
check("чужой заказ не виден", (await count("boris", "orders")) === 0 && (await count("boris", "order_items")) === 0);
check("customer не меняет статус и сумму заказа",
  (await run("anna", `update public.orders set status='delivered', total=1`)).affected === 0 &&
  (await run("anna", `delete from public.orders`)).affected === 0 &&
  (await run("anna", `update public.order_items set unit_price=1`)).affected === 0);
check("админ видит все заказы и меняет статус",
  (await count("admin", "orders")) === 1 && (await run("admin", `update public.orders set status='shipped' where id='${orderId}'`)).affected === 1);

await run("admin", `update public.orders set status='cancelled' where id='${orderId}'`, true);
check("отмена возвращает товар на склад",
  (await run("admin", `select quantity from public.inventory where variant_id='${v1}'`)).rows[0].quantity === before);

// ── склад: журнал, приход, списание ──
const mv = async (sql) => (await run("admin", `select reason, delta, balance from public.inventory_movements where ${sql} order by created_at, id`)).rows;
const mvs = await mv(`order_id='${orderId}' and variant_id='${v1}'`);
check("журнал: продажа и возврат при отмене записаны с заказом",
  mvs.length === 2 && mvs[0].reason === "sale" && mvs[0].delta === -2 && mvs[1].reason === "return" && mvs[1].delta === 2, JSON.stringify(mvs));
check("отмена уменьшила использование промокода", (await run("admin", `select used_count from public.promo_codes where code='WELCOME10'`)).rows[0].used_count === 0);
check("отменённый заказ нельзя вернуть в работу (нет двойного возврата)",
  /нельзя/.test((await run("admin", `update public.orders set status='processing' where id='${orderId}'`)).error ?? ""));
check("customer не видит журнал склада", (await count("anna", "inventory_movements")) === 0 && (await count("admin", "inventory_movements")) > 0);
check("журнал нельзя подделать напрямую",
  !!(await run("admin", `insert into public.inventory_movements(variant_id,delta,balance,reason) values ('${v1}',1,1,'receipt')`)).error);

const adj = (who, d, r, n = "") => run(who, `select public.adjust_stock('${v1}', ${d}, '${r}', '${n}') q`, true);
const stock = async () => (await run("admin", `select quantity from public.inventory where variant_id='${v1}'`)).rows[0].quantity;
const s0 = await stock();
check("приход увеличивает остаток и пишется в журнал",
  (await adj("admin", 7, "receipt", "поставка")).rows?.[0]?.q === s0 + 7 &&
  (await mv(`variant_id='${v1}' and reason='receipt'`)).at(-1).balance === s0 + 7);
check("списание уменьшает остаток", (await adj("admin", -3, "writeoff", "брак")).rows?.[0]?.q === s0 + 4);
check("списание больше остатка отклоняется, остаток не меняется",
  /Недостаточно/.test((await adj("admin", -100000, "writeoff")).error ?? "") && (await stock()) === s0 + 4);
check("неверный знак и причина отклоняются",
  !!(await adj("admin", -1, "receipt")).error && !!(await adj("admin", 1, "writeoff")).error && !!(await adj("admin", 1, "sale")).error && !!(await adj("admin", 0, "receipt")).error);
check("customer не может менять остаток через RPC и напрямую",
  !!(await adj("anna", 5, "receipt")).error && (await run("anna", `update public.inventory set quantity=9999`)).affected === 0 && (await stock()) === s0 + 4);

// ── переходы статусов ──
const co = (extra) => `select public.place_order('Б','b@x.test','+7999000','pickup','cash','{}'::jsonb,'',null,${extra}) id`;
await run("boris", `delete from public.cart_items`, true);
await run("boris", `insert into public.cart_items(cart_id,variant_id,quantity) values ('${borisCart}','${v1}',1)`, true);
const o2 = (await run("boris", co("null"), true)).rows[0].id;
check("отгруженный заказ нельзя отменить",
  (await run("admin", `update public.orders set status='shipped' where id='${o2}'`, true)).affected === 1 &&
  /нельзя/.test((await run("admin", `update public.orders set status='cancelled' where id='${o2}'`)).error ?? ""));
check("доставленный заказ нельзя изменить",
  (await run("admin", `update public.orders set status='delivered' where id='${o2}'`, true)).affected === 1 &&
  !!(await run("admin", `update public.orders set status='cancelled' where id='${o2}'`)).error);

// ── аналитика Dashboard ──
check("аналитика доступна только админу",
  !!(await run("anna", `select * from public.admin_sales_by_day(30)`)).error && !!(await run("anon", `select * from public.admin_top_products(5)`)).error &&
  (await run("admin", `select * from public.admin_sales_by_day(30)`)).rows.length === 30);
const top = (await run("admin", `select * from public.admin_top_products(5)`)).rows;
check("популярные товары считаются без отменённых заказов", top.length === 1 && Number(top[0].units) === 1, JSON.stringify(top));

const lowVariant = (await run("admin", `select pv.id from public.product_variants pv join public.inventory i on i.variant_id=pv.id where i.quantity between 1 and 2 limit 1`)).rows[0].id;
await run("boris", `insert into public.cart_items(cart_id,variant_id,quantity) values ('${borisCart}','${lowVariant}',50)`, true);
const ov = await run("boris", `select public.place_order('Б','b@x.test','+7999000','pickup','cash','{}'::jsonb,'',null)`);
check("нельзя заказать больше, чем есть на складе",
  /Недостаточно/.test(ov.error ?? ""), ov.error);

// ── избранное и адреса ──
const pid = (await run("admin", `select id from public.products limit 1`)).rows[0].id;
check("customer ведёт своё избранное",
  (await run("anna", `insert into public.favorites(user_id,product_id) values ('${users.anna}','${pid}')`, true)).affected === 1);
check("чужое избранное не видно и не создаётся",
  (await count("boris", "favorites")) === 0 &&
  !!(await run("boris", `insert into public.favorites(user_id,product_id) values ('${users.anna}','${pid}')`)).error);
check("адреса изолированы",
  (await run("anna", `insert into public.addresses(user_id,recipient,phone,city,street,postal_code) values ('${users.anna}','A','1','М','У','1')`, true)).affected === 1 &&
  (await count("boris", "addresses")) === 0 &&
  !!(await run("boris", `insert into public.addresses(user_id,recipient,phone,city,street,postal_code) values ('${users.anna}','A','1','М','У','1')`)).error);

// ── Storage ──
const put = (who) => run(who, `insert into storage.objects(bucket_id,name) values ('product-images','p/x.jpg')`);
check("Storage: загрузка только у админа",
  !!(await put("anon")).error && !!(await put("anna")).error && !(await put("admin")).error);
check("Storage: удаление чужим запрещено",
  (await run("admin", `insert into storage.objects(bucket_id,name) values ('product-images','p/y.jpg')`, true)).affected === 1 &&
  (await run("anna", `delete from storage.objects where bucket_id='product-images'`)).affected === 0 &&
  (await run("admin", `delete from storage.objects where bucket_id='product-images'`)).affected === 1);

// ── RLS включён везде ──
const noRls = (await db.query(`select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r' and not c.relrowsecurity`)).rows;
check("RLS включён на всех таблицах public", noRls.length === 0, noRls.map((r) => r.relname).join(","));

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
