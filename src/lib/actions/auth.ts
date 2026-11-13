"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { isDbConfigured } from "@/lib/env";
import { endSession, requireUser, safeNext, SESSION_COOKIE, startSession } from "@/lib/auth";
import { isUnique, one } from "@/lib/core/db";
import { hashPassword, verifyPassword } from "@/lib/core/password";
import { deleteOtherSessions } from "@/lib/core/session";

export type FormState = { error?: string; message?: string } | undefined;

const email = z.string().trim().toLowerCase().email("Введите корректный email");
const password = z.string().min(8, "Пароль — не короче 8 символов").max(72, "Пароль слишком длинный");

const NOT_CONFIGURED = "База данных не настроена: заполните .env.local (см. .env.example).";
// Хэш для сравнения, когда пользователя нет: время ответа не выдаёт, зарегистрирован ли email.
const DUMMY_HASH = "scrypt$AAAAAAAAAAAAAAAAAAAAAA==$" + "A".repeat(86) + "==";

export async function signIn(_: FormState, form: FormData): Promise<FormState> {
  if (!isDbConfigured) return { error: NOT_CONFIGURED };
  const parsed = z.object({ email, password: z.string().min(1, "Введите пароль") }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const user = await one<{ id: string; password_hash: string }>(db(), "select id, password_hash from profiles where email = ?", [parsed.data.email]);
  const ok = await verifyPassword(parsed.data.password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok) return { error: "Неверный email или пароль" };
  await startSession(user.id);
  redirect(safeNext(String(form.get("next") ?? "")));
}

export async function signUp(_: FormState, form: FormData): Promise<FormState> {
  if (!isDbConfigured) return { error: NOT_CONFIGURED };
  const parsed = z
    .object({ full_name: z.string().trim().min(2, "Укажите имя").max(120), email, password })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const id = crypto.randomUUID();
  try {
    // Роль всегда customer: администратором пользователя делает только скрипт или другой администратор.
    await db().execute({
      sql: "insert into profiles (id, email, password_hash, full_name, role) values (?, ?, ?, ?, 'customer')",
      args: [id, parsed.data.email, await hashPassword(parsed.data.password), parsed.data.full_name],
    });
  } catch (e) {
    if (isUnique(e)) return { error: "Этот email уже зарегистрирован" };
    return { error: "Не удалось создать аккаунт. Попробуйте ещё раз." };
  }
  await startSession(id);
  redirect("/account");
}

export async function signOut() {
  if (isDbConfigured) await endSession();
  redirect("/");
}

/** Смена пароля требует текущий пароль; остальные сессии пользователя закрываются. */
export async function changePassword(_: FormState, form: FormData): Promise<FormState> {
  const me = await requireUser("/account");
  const parsed = z
    .object({ current: z.string().min(1, "Введите текущий пароль"), password, confirm: z.string() })
    .refine((v) => v.password === v.confirm, { message: "Пароли не совпадают", path: ["confirm"] })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const row = await one<{ password_hash: string }>(db(), "select password_hash from profiles where id = ?", [me.id]);
  if (!row || !(await verifyPassword(parsed.data.current, row.password_hash))) return { error: "Текущий пароль указан неверно" };
  await db().execute({ sql: "update profiles set password_hash = ?, updated_at = ? where id = ?", args: [await hashPassword(parsed.data.password), new Date().toISOString(), me.id] });
  await deleteOtherSessions(db(), me.id, (await cookies()).get(SESSION_COOKIE)?.value);
  return { message: "Пароль изменён" };
}
