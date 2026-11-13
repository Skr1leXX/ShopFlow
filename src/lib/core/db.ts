// Общие помощники для libSQL. Без зависимостей от Next.js: код ядра запускается и в тестах на node.
import type { Client, InValue, Transaction } from "@libsql/client";

export type Q = Client | Transaction;
export type Row = Record<string, unknown>;

/** Ошибка бизнес-правила: текст безопасен для показа пользователю. Остальные ошибки скрываются. */
export class BizError extends Error {}

export const nowIso = () => new Date().toISOString();

export async function all<T = Row>(q: Q, sql: string, args: InValue[] = []): Promise<T[]> {
  const res = await q.execute({ sql, args });
  return res.rows.map((r) => ({ ...r })) as T[];
}

export async function one<T = Row>(q: Q, sql: string, args: InValue[] = []): Promise<T | null> {
  return (await all<T>(q, sql, args))[0] ?? null;
}

/** Выполняет изменения одной транзакцией: при любой ошибке откатывается всё. SQLite пускает одного писателя за раз. */
export async function write<T>(db: Client, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  // Файловая SQLite при одновременной записи из двух процессов отвечает "database is locked": транзакция откатилась целиком,
  // поэтому её безопасно повторить. Облачная Turso сама ставит записи в очередь.
  for (let attempt = 1; ; attempt++) {
    const tx = await db.transaction("write").catch((e) => e as Error);
    if (tx instanceof Error) {
      if (attempt < 6 && isBusy(tx)) { await sleep(100 * attempt); continue; }
      throw tx;
    }
    try {
      const result = await fn(tx);
      await tx.commit();
      return result;
    } catch (e) {
      await tx.rollback().catch(() => undefined);
      if (attempt < 6 && isBusy(e)) { await sleep(100 * attempt); continue; }
      throw e;
    } finally {
      tx.close();
    }
  }
}
const isBusy = (e: unknown) => /SQLITE_BUSY|database is locked/i.test(String((e as Error)?.message));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const placeholders = (n: number) => Array(n).fill("?").join(",");
export const flag = (v: unknown) => v === 1 || v === true || v === "1";
export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Нарушение уникальности / внешнего ключа определяем по тексту ошибки SQLite. */
export const isUnique = (e: unknown) => /UNIQUE constraint failed/i.test(String((e as Error)?.message));
export const isForeignKey = (e: unknown) => /FOREIGN KEY constraint failed/i.test(String((e as Error)?.message));
