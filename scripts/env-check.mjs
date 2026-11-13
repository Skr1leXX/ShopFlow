// Проверка переменных окружения. Запуск: npm run check:env (подробный отчёт) или как prebuild (--guard: падает только на опасных ошибках).
// Пустое окружение допустимо: приложение покажет инструкцию по подключению базы.
import { pathToFileURL } from "node:url";

const LOCAL = ["localhost", "127.0.0.1", "[::1]"];

/** @returns {{ errors: string[], warnings: string[], configured: boolean }} */
export function inspectEnv(env) {
  const errors = [];
  const warnings = [];
  const url = env.TURSO_DATABASE_URL?.trim();
  const token = env.TURSO_AUTH_TOKEN?.trim();

  if (url) {
    if (url.startsWith("file:")) {
      if (env.VERCEL) errors.push("TURSO_DATABASE_URL указывает на локальный файл: на Vercel файловая система временная, нужна облачная база (libsql://…).");
    } else {
      try {
        const u = new URL(url);
        if (!["libsql:", "https:", "wss:", "http:", "ws:"].includes(u.protocol)) errors.push("TURSO_DATABASE_URL должен начинаться с libsql://, https:// или file:.");
        else if (["http:", "ws:"].includes(u.protocol) && !LOCAL.includes(u.hostname)) errors.push("Для не-localhost адреса базы нужен защищённый протокол (libsql:// или https://).");
        if (!token && !LOCAL.includes(u.hostname)) errors.push("Для облачной базы нужен TURSO_AUTH_TOKEN (turso db tokens create <имя-базы>).");
      } catch { errors.push("TURSO_DATABASE_URL не является корректным URL."); }
    }
  } else if (token) warnings.push("Задан TURSO_AUTH_TOKEN без TURSO_DATABASE_URL: токен не используется.");

  // Самая опасная ошибка: секрет в переменной, которая уходит в браузер.
  for (const [k, v] of Object.entries(env))
    if (k.startsWith("NEXT_PUBLIC_") && v && /TOKEN|SECRET|PRIVATE|SERVICE|TURSO|BLOB|PASSWORD/i.test(k))
      errors.push(`${k}: переменные с NEXT_PUBLIC_ публикуются в браузере, секретам там не место.`);

  if (url && !env.BLOB_READ_WRITE_TOKEN) warnings.push("BLOB_READ_WRITE_TOKEN не задан: загрузка фото в админке отключена (можно использовать только ссылки на фото).");
  if (env.DEMO_PASSWORD && env.VERCEL) warnings.push("DEMO_PASSWORD задан на Vercel: он нужен только локальному скрипту seed:demo. Удалите его из настроек проекта.");

  return { errors, warnings, configured: Boolean(url) };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const guard = process.argv.includes("--guard");
  const { errors, warnings, configured } = inspectEnv(process.env);
  if (!guard || errors.length || warnings.length) {
    console.log(configured ? "База данных: настроена" : "База данных: не настроена (приложение покажет инструкцию по подключению)");
    errors.forEach((e) => console.error(`ОШИБКА: ${e}`));
    warnings.forEach((w) => console.warn(`Предупреждение: ${w}`));
    if (!errors.length && !guard) console.log("Ошибок нет.");
  }
  process.exit(errors.length ? 1 : 0);
}
