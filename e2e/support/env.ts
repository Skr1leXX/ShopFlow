import path from "node:path";

/** Сценарии с данными требуют настоящий проект Supabase (миграции применены) и сервисный ключ только для подготовки данных. */
export const hasBackend = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY,
);

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
