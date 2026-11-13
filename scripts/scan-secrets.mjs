// Ищет секреты в файлах, которые попадут в git (отслеживаемые и новые, не игнорируемые). Запуск: npm run scan:secrets
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const RULES = [
  { name: "JWT (токен доступа)", re: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g },
  { name: "приватный ключ", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: "строка подключения к БД с паролем", re: /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]{3,}@[^\s/]+/g, test: (m) => !/:(password|\[YOUR-PASSWORD\]|your-password|postgres)@/i.test(m) },
  { name: "адрес базы libsql с токеном в URL", re: /libsql:\/\/[^\s"']*authToken=[^\s"'&]{10,}/g },
  { name: "непустое значение TURSO_AUTH_TOKEN", re: /TURSO_AUTH_TOKEN[ \t]*[=:][ \t]*["']?(eyJ[A-Za-z0-9._-]{20,}|[A-Za-z0-9._-]{40,})/g },
  { name: "токен Vercel Blob", re: /vercel_blob_rw_[A-Za-z0-9_]{10,}/g },
  { name: "токен GitHub", re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
  { name: "ключ API (sk-…)", re: /\bsk-[A-Za-z0-9]{32,}\b/g },
  { name: "ключ AWS", re: /\bAKIA[0-9A-Z]{16}\b/g },
];
const SKIP = /(^|\/)(package-lock\.json|\.next|node_modules|e2e-report|e2e-results)(\/|$)|\.(png|jpe?g|webp|avif|ico|woff2?)$/;

/** @returns {string[]} найденные проблемы */
export function scanText(file, text) {
  const hits = [];
  for (const r of RULES)
    for (const m of text.matchAll(r.re)) if (!r.test || r.test(m[0])) hits.push(`${file}: ${r.name}`);
  return hits;
}

export function scanRepo(cwd = process.cwd()) {
  const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { cwd, encoding: "utf8" }).split("\n").filter(Boolean);
  const problems = [];
  for (const f of files) {
    if (/(^|\/)\.env(\.|$)/.test(f) && !f.endsWith(".env.example")) problems.push(`${f}: файл окружения не должен попадать в git`);
    if (SKIP.test(f) || !fs.existsSync(path.join(cwd, f))) continue;
    const stat = fs.statSync(path.join(cwd, f));
    if (stat.size > 2_000_000) continue;
    problems.push(...scanText(f, fs.readFileSync(path.join(cwd, f), "utf8")));
  }
  return { files: files.length, problems };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { files, problems } = scanRepo();
  if (problems.length) {
    problems.forEach((p) => console.error(`FAIL  ${p}`));
    console.error(`\nНайдено проблем: ${problems.length}. Не публикуйте репозиторий, пока секреты не удалены и не перевыпущены.`);
    process.exit(1);
  }
  console.log(`PASS  секретов не найдено (проверено файлов: ${files})`);
}
