import "server-only";
import { createClient, type Client } from "@libsql/client";

let client: Client | undefined;

/** Клиент Turso (libSQL). Создаётся один раз на процесс; токен базы живёт только на сервере и в браузер не попадает. */
export function db(): Client {
  client ??= createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
  return client;
}
