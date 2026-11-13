import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { isDbConfigured } from "@/lib/env";
import { createSession, deleteSession, findSessionUser, type SessionUser } from "@/lib/core/session";
import type { Profile } from "@/lib/data/types";

export const SESSION_COOKIE = "sf_session";

/** Выдаёт сессию: токен лежит в httpOnly cookie, в базе хранится только его хэш. */
export async function startSession(userId: string) {
  const { token, expires } = await createSession(db(), userId);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires,
  });
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(db(), token);
  jar.delete(SESSION_COOKIE);
}

/** Текущий пользователь, проверенный по базе: подделать cookie без знания токена нельзя. */
export const getUser = cache(async (): Promise<SessionUser | null> => {
  const jar = await cookies(); // всегда динамический рендер: приватные страницы не должны попадать в статику
  if (!isDbConfigured) return null;
  return findSessionUser(db(), jar.get(SESSION_COOKIE)?.value);
});

export const getProfile = getUser as () => Promise<Profile | null>;

export async function requireUser(next = "/account") {
  const profile = await getProfile();
  if (!profile) redirect(`/login?next=${encodeURIComponent(next)}`);
  return profile;
}

/** Роль читается из БД на сервере при каждом запросе; клиентским данным не верим. */
export async function requireAdmin() {
  const profile = await requireUser("/admin");
  if (profile.role !== "admin") redirect("/account?denied=1");
  return profile;
}

/** Разрешаем только относительные пути, чтобы ?next= не вёл на чужой сайт. */
export function safeNext(next: string | null | undefined, fallback = "/account") {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : fallback;
}
