/* eslint-disable @typescript-eslint/no-explicit-any -- строки из тестовой БД не типизированы, тесты сами приводят значения */
import { createClient, type Client, type InValue } from "@libsql/client";
import fs from "node:fs";
import { hashPassword } from "../../src/lib/core/password.ts";
import { PASSWORD, STATE_FILE, type State } from "./env";

// Прямой доступ к базе нужен только тестовому процессу: подготовить данные и проверить результат.
// Приложение работает со своей учёткой базы; тесты видят то же самое хранилище.
let client: Client | undefined;
export const conn = () => (client ??= createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN }));

// Приложение и тесты пишут в один файл SQLite: при "database is locked" запрос повторяется.
async function exec(sql: string, args: InValue[]) {
  for (let i = 1; ; i++) {
    try { return await conn().execute({ sql, args }); } catch (e) {
      if (i >= 8 || !/SQLITE_BUSY|database is locked/i.test(String((e as Error).message))) throw e;
      await new Promise((r) => setTimeout(r, 100 * i));
    }
  }
}
export async function sqlRows<T = Record<string, any>>(sql: string, args: InValue[] = []): Promise<T[]> {
  return (await exec(sql, args)).rows.map((r) => ({ ...r })) as T[];
}
export const sqlRow = async <T = Record<string, any>>(sql: string, args: InValue[] = []) => (await sqlRows<T>(sql, args))[0];
export const sqlVal = async (sql: string, args: InValue[] = []) => Object.values((await sqlRow(sql, args)) ?? {})[0];
export const sqlRun = (sql: string, args: InValue[] = []) => exec(sql, args);

export const readState = (): State => JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));

export async function createUser(email: string, name: string, role: "customer" | "admin" = "customer") {
  const id = crypto.randomUUID();
  await sqlRun("insert into profiles (id, email, password_hash, full_name, role) values (?, ?, ?, ?, ?)", [id, email, await hashPassword(PASSWORD), name, role]);
  return { id, email };
}

/** Остаток варианта напрямую из БД. */
export async function stockOf(variantId: string) {
  return (await sqlVal("select quantity from inventory where variant_id = ?", [variantId])) as number;
}

export const setStockDirect = (variantId: string, quantity: number) =>
  sqlRun("update inventory set quantity = ? where variant_id = ?", [quantity, variantId]);

export const ordersOf = (userId: string) =>
  sqlRows<{ id: string; number: number; status: string; total: number; discount: number }>(
    "select id, number, status, total, discount from orders where user_id = ? order by created_at", [userId],
  );

export async function resetCustomerData(userId: string) {
  await sqlRun("delete from orders where user_id = ?", [userId]);
  await sqlRun("delete from cart_items where user_id = ?", [userId]);
  await sqlRun("delete from favorites where user_id = ?", [userId]);
}
