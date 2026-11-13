// Проверяет итоговый артефакт установки supabase/setup.sql на чистой базе: именно его вставляют в SQL Editor.
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const db = new PGlite({ extensions: { pgcrypto, pg_trgm } });
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth; create schema storage;
  create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects(id uuid default gen_random_uuid() primary key, bucket_id text, name text);
  alter table storage.objects enable row level security;
`);

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`); };

try {
  await db.exec(fs.readFileSync(`${root}/setup.sql`, "utf8"));
  const n = async (t) => Number((await db.query(`select count(*)::int c from public.${t}`)).rows[0].c);
  check("setup.sql применяется на чистой базе", true);
  check("установка: 34 товара, 6 категорий, 3 промокода", (await n("products")) === 34 && (await n("categories")) === 6 && (await n("promo_codes")) === 3);
  check("установка: у всех товаров есть фото, варианты и остатки",
    (await db.query(`select count(*)::int c from public.products p where not exists (select 1 from public.product_images i where i.product_id=p.id)
      or not exists (select 1 from public.product_variants v join public.inventory i on i.variant_id=v.id where v.product_id=p.id)`)).rows[0].c === 0);
  check("установка: бакет product-images создан и публичный", (await db.query(`select public from storage.buckets where id='product-images'`)).rows[0]?.public === true);
  check("установка: RLS включён на всех таблицах",
    (await db.query(`select count(*)::int c from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity`)).rows[0].c === 0);
} catch (e) {
  check("setup.sql применяется на чистой базе", false, e.message);
}
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
