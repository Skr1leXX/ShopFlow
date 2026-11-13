// Проверки production-сборки: утечка секретов и бюджет размера клиентских чанков. Запуск: npm run test:static (после npm run build).
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const root = path.join(process.cwd(), ".next");
if (!fs.existsSync(root)) {
  console.error("Нет .next: сначала выполните npm run build");
  process.exit(1);
}

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`);
};

// ── 1. Секреты не попадают в клиентский код ──
// Серверные файлы могут читать process.env, но значения ключей не должны быть вшиты ни туда, ни сюда.
const clientFiles = walk(path.join(root, "static")).filter((f) => /\.(js|css|html|json|map)$/.test(f));
const serverFiles = walk(path.join(root, "server")).filter((f) => /\.(js|html|rsc|json)$/.test(f));
const secretValues = [process.env.TURSO_AUTH_TOKEN, process.env.BLOB_READ_WRITE_TOKEN].filter(Boolean);
const jwtRe = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;

const leaks = [];
for (const f of [...clientFiles, ...serverFiles]) {
  const text = fs.readFileSync(f, "utf8");
  const isClient = f.startsWith(path.join(root, "static"));
  if (isClient && /TURSO_AUTH_TOKEN|BLOB_READ_WRITE_TOKEN|password_hash/.test(text)) leaks.push(`${path.relative(root, f)}: упоминание серверного секрета`);
  for (const v of secretValues) if (text.includes(v)) leaks.push(`${path.relative(root, f)}: значение ключа`);
  if (text.match(jwtRe)?.length) leaks.push(`${path.relative(root, f)}: JWT-токен`);
}
check("секреты: токенов базы и Blob нет в сборке", leaks.length === 0, leaks.slice(0, 5).join("; "));

const envExample = fs.readFileSync(path.join(process.cwd(), ".env.example"), "utf8");
check(".env.example не содержит значений секретов", /^TURSO_AUTH_TOKEN=\s*$/m.test(envExample) && /^BLOB_READ_WRITE_TOKEN=\s*$/m.test(envExample) && !jwtRe.test(envExample));
const tracked = fs.readFileSync(path.join(process.cwd(), ".gitignore"), "utf8");
check(".env.local исключён из git", /^\.env\*/m.test(tracked) && /!\.env\.example/.test(tracked));

// ── 2. Бюджет клиентского JS ──
const chunks = clientFiles
  .filter((f) => f.endsWith(".js"))
  .map((f) => ({ f: path.relative(root, f), gz: zlib.gzipSync(fs.readFileSync(f)).length }))
  .sort((a, b) => b.gz - a.gz);
const total = chunks.reduce((n, c) => n + c.gz, 0);
console.log("\nКрупнейшие клиентские чанки (gzip):");
chunks.slice(0, 5).forEach((c) => console.log(`  ${(c.gz / 1024).toFixed(1).padStart(7)} КБ  ${c.f}`));
console.log(`  Всего клиентского JS: ${(total / 1024).toFixed(0)} КБ\n`);
check("бюджет: ни один чанк не больше 120 КБ gzip", chunks[0].gz < 120 * 1024, `${chunks[0].f} ${(chunks[0].gz / 1024).toFixed(0)} КБ`);
check("бюджет: весь клиентский JS не больше 900 КБ gzip", total < 900 * 1024, `${(total / 1024).toFixed(0)} КБ`);

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
