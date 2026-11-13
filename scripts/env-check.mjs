// Проверка переменных окружения. Запуск: npm run check:env (подробный отчёт) или как prebuild (--guard: падает только на опасных ошибках).
// Пустое окружение допустимо: приложение покажет инструкцию по подключению Supabase.
import { pathToFileURL } from "node:url";

const jwtRole = (token) => {
  try { return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).role ?? null; } catch { return null; }
};

/** @returns {{ errors: string[], warnings: string[], configured: boolean }} */
export function inspectEnv(env) {
  const errors = [];
  const warnings = [];
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (Boolean(url) !== Boolean(anon)) errors.push("Задана только одна из NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY: нужны обе.");
  if (url) {
    try {
      const u = new URL(url);
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
      if (u.protocol !== "https:" && !local) errors.push("NEXT_PUBLIC_SUPABASE_URL должен начинаться с https://.");
      if (u.pathname !== "/" && u.pathname !== "") warnings.push("NEXT_PUBLIC_SUPABASE_URL лучше указывать без пути (https://<ref>.supabase.co).");
    } catch { errors.push("NEXT_PUBLIC_SUPABASE_URL не является корректным URL."); }
  }

  // Самая опасная ошибка: секретный ключ в переменной, которая уходит в браузер.
  const isSecret = (v) => v && (jwtRole(v) === "service_role" || v.startsWith("sb_secret_"));
  if (isSecret(anon)) errors.push("NEXT_PUBLIC_SUPABASE_ANON_KEY содержит СЕКРЕТНЫЙ ключ (service_role). Он попадёт в браузер. Используйте anon/publishable key.");
  if (anon && !isSecret(anon) && !anon.startsWith("sb_publishable_") && jwtRole(anon) !== "anon") warnings.push("NEXT_PUBLIC_SUPABASE_ANON_KEY не похож на anon/publishable ключ Supabase.");
  for (const [k, v] of Object.entries(env)) {
    if (k.startsWith("NEXT_PUBLIC_") && v && (/SERVICE|SECRET|PRIVATE/i.test(k) || isSecret(v)) && k !== "NEXT_PUBLIC_SUPABASE_ANON_KEY")
      errors.push(`${k}: переменные с NEXT_PUBLIC_ публикуются в браузере, секретам там не место.`);
  }

  if (env.SUPABASE_SERVICE_ROLE_KEY && env.VERCEL) warnings.push("SUPABASE_SERVICE_ROLE_KEY задан на Vercel: приложению он не нужен (только локальным скриптам). Удалите его из настроек проекта.");
  const site = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (site) {
    try {
      const u = new URL(site);
      if (env.NODE_ENV === "production" && u.protocol !== "https:" && u.hostname !== "localhost") warnings.push("NEXT_PUBLIC_SITE_URL в production должен быть https://.");
    } catch { errors.push("NEXT_PUBLIC_SITE_URL не является корректным URL."); }
  } else if (url) warnings.push("NEXT_PUBLIC_SITE_URL не задан: ссылки из писем (подтверждение, сброс пароля) будут строиться по заголовку Host.");

  return { errors, warnings, configured: Boolean(url && anon) };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const guard = process.argv.includes("--guard");
  const { errors, warnings, configured } = inspectEnv(process.env);
  if (!guard || errors.length || warnings.length) {
    console.log(configured ? "Supabase: настроен" : "Supabase: не настроен (приложение покажет инструкцию по подключению)");
    errors.forEach((e) => console.error(`ОШИБКА: ${e}`));
    warnings.forEach((w) => console.warn(`Предупреждение: ${w}`));
    if (!errors.length && !guard) console.log("Ошибок нет.");
  }
  process.exit(errors.length ? 1 : 0);
}
