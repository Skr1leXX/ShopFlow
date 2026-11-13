// Собирает supabase/setup.sql: все миграции и seed одним файлом, чтобы развернуть базу вставкой в Supabase SQL Editor.
// npm run db:bundle  — записать файл;  node scripts/bundle-sql.mjs --check  — проверить, что файл актуален.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.join(process.cwd(), "supabase");

export function buildBundle() {
  const parts = fs.readdirSync(path.join(root, "migrations")).filter((f) => f.endsWith(".sql")).sort()
    .map((f) => `-- ===== migrations/${f} =====\n${fs.readFileSync(path.join(root, "migrations", f), "utf8").trimEnd()}\n`);
  parts.push(`-- ===== seed.sql =====\n${fs.readFileSync(path.join(root, "seed.sql"), "utf8").trimEnd()}\n`);
  return `-- ShopFlow: полная установка (миграции + демо-каталог). GENERATED: npm run db:bundle. Не править вручную.\n-- Выполняйте на ПУСТОМ проекте Supabase один раз.\n\n${parts.join("\n")}`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const target = path.join(root, "setup.sql");
  const bundle = buildBundle();
  if (process.argv.includes("--check")) {
    const ok = fs.existsSync(target) && fs.readFileSync(target, "utf8") === bundle;
    console.log(ok ? "PASS  supabase/setup.sql актуален" : "FAIL  supabase/setup.sql устарел: выполните npm run db:bundle");
    process.exit(ok ? 0 : 1);
  }
  fs.writeFileSync(target, bundle);
  console.log(`Записано ${target} (${(bundle.length / 1024).toFixed(0)} КБ)`);
}
