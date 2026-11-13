import path from "node:path";

/** Сценарии с данными требуют базу (TURSO_DATABASE_URL: Turso или локальный файл) — миграции применит global-setup. */
export const hasBackend = Boolean(process.env.TURSO_DATABASE_URL);
/** Загрузка фото работает только с токеном Vercel Blob; без него проверяется понятное сообщение. */
export const hasBlob = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

export const PASSWORD = "E2e-Passw0rd!x";
export const STATE_FILE = path.join(__dirname, "..", ".state.json");

export type State = {
  run: string;
  admin: { id: string; email: string };
  customer: { id: string; email: string };
  products: Record<string, { id: string; slug: string; name: string; variantM: string; variantL: string }>;
  categoryId: string;
  categoryName: string;
  promo: string;
};
