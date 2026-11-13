// Назначает администратора: пользователь сначала регистрируется на сайте, затем: npm run make-admin -- email@example.com
// Роль нельзя получить через интерфейс регистрации: только этим скриптом (доступ к базе) или другим администратором.
import { createClient } from "@libsql/client";

const email = process.argv[2]?.trim().toLowerCase();
if (!email || !process.env.TURSO_DATABASE_URL) {
  console.error("Использование: npm run make-admin -- email@example.com (нужен TURSO_DATABASE_URL в .env.local)");
  process.exit(1);
}
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const res = await db.execute({ sql: "update profiles set role = 'admin', updated_at = ? where email = ?", args: [new Date().toISOString(), email] });
if (!res.rowsAffected) { console.error(`Пользователь ${email} не найден: сначала зарегистрируйтесь на сайте.`); process.exit(1); }
console.log(`${email} теперь администратор.`);
