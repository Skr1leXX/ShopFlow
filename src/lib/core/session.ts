import { createHash, randomBytes } from "node:crypto";
import { nowIso, one, type Q } from "./db.ts";

export const SESSION_DAYS = 30;
const sha = (token: string) => createHash("sha256").update(token).digest("hex");

export type SessionUser = { id: string; email: string; full_name: string; phone: string | null; role: "customer" | "admin"; created_at: string };

/** Создаёт сессию и возвращает токен для cookie. В базе хранится только хэш токена. */
export async function createSession(q: Q, userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  await q.execute({ sql: "delete from sessions where expires_at < ?", args: [nowIso()] });
  await q.execute({ sql: "insert into sessions (token_hash, user_id, expires_at) values (?, ?, ?)", args: [sha(token), userId, expires] });
  return { token, expires: new Date(expires) };
}

export async function findSessionUser(q: Q, token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  return one<SessionUser>(
    q,
    `select p.id, p.email, p.full_name, p.phone, p.role, p.created_at from sessions s
     join profiles p on p.id = s.user_id where s.token_hash = ? and s.expires_at > ?`,
    [sha(token), nowIso()],
  );
}

export async function deleteSession(q: Q, token: string) {
  await q.execute({ sql: "delete from sessions where token_hash = ?", args: [sha(token)] });
}

/** После смены пароля все остальные сессии пользователя закрываются. */
export async function deleteOtherSessions(q: Q, userId: string, keepToken: string | undefined) {
  await q.execute({ sql: "delete from sessions where user_id = ? and token_hash <> ?", args: [userId, keepToken ? sha(keepToken) : ""] });
}

