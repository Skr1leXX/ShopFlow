// Применяет db/migrations/*.sql к базе (Turso или локальный файл) и, по флагу --seed, загружает каталог из db/seed.sql.
// Переменные: TURSO_DATABASE_URL (по умолчанию file:local.db), TURSO_AUTH_TOKEN (для облачной базы).
// Запуск: npm run db:migrate  |  npm run db:setup (миграции + каталог). Повторный запуск безопасен.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "db");

export async function migrate(db, { seed = false, log = () => {}, url } = {}) {
  // WAL: читатели не блокируют писателя, поэтому приложение и скрипты могут работать с одним файлом одновременно (для облачной базы не нужно).
  if (url?.startsWith("file:")) await db.execute("pragma journal_mode = wal");
  await db.execute("create table if not exists _migrations (name text primary key, applied_at text not null)");
  const done = new Set((await db.execute("select name from _migrations")).rows.map((r) => r.name));
  const files = fs.readdirSync(path.join(root, "migrations")).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    await db.executeMultiple(fs.readFileSync(path.join(root, "migrations", f), "utf8"));
    await db.execute({ sql: "insert into _migrations (name, applied_at) values (?, ?)", args: [f, new Date().toISOString()] });
    log(`применена миграция ${f}`);
  }
  if (seed) {
    const { rows } = await db.execute("select count(*) n from products");
    if (rows[0].n === 0) {
      await db.executeMultiple(fs.readFileSync(path.join(root, "seed.sql"), "utf8"));
      log("загружен каталог: db/seed.sql");
    } else log("каталог уже загружен, пропускаю seed.sql");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const url = process.env.TURSO_DATABASE_URL || "file:local.db";
  const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  console.log(`База: ${url.startsWith("file:") ? url : url.replace(/\/\/.*@/, "//")}`);
  await migrate(db, { seed: process.argv.includes("--seed"), log: (m) => console.log(" ", m), url });
  console.log("Готово");
}
