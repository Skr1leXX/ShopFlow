"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { safeNext } from "@/lib/auth";

export type FormState = { error?: string; message?: string } | undefined;

const email = z.string().trim().toLowerCase().email("Введите корректный email");
const password = z.string().min(8, "Пароль — не короче 8 символов").max(72, "Пароль слишком длинный");

const NOT_CONFIGURED = "Supabase не настроен: заполните .env.local (см. .env.example).";

async function origin() {
  const h = await headers();
  return process.env.NEXT_PUBLIC_SITE_URL ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
}

function authError(message: string) {
  if (/invalid login/i.test(message)) return "Неверный email или пароль";
  if (/already registered/i.test(message)) return "Этот email уже зарегистрирован";
  if (/email not confirmed/i.test(message)) return "Подтвердите email по ссылке из письма";
  if (/rate limit/i.test(message)) return "Слишком много попыток, попробуйте позже";
  return "Не удалось выполнить операцию. Попробуйте ещё раз.";
}

export async function signIn(_: FormState, form: FormData): Promise<FormState> {
  if (!isSupabaseConfigured) return { error: NOT_CONFIGURED };
  const parsed = z.object({ email, password: z.string().min(1, "Введите пароль") }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: authError(error.message) };
  redirect(safeNext(String(form.get("next") ?? "")));
}

export async function signUp(_: FormState, form: FormData): Promise<FormState> {
  if (!isSupabaseConfigured) return { error: NOT_CONFIGURED };
  const parsed = z
    .object({ full_name: z.string().trim().min(2, "Укажите имя").max(120), email, password })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { full_name: parsed.data.full_name }, emailRedirectTo: `${await origin()}/auth/callback` },
  });
  if (error) return { error: authError(error.message) };
  if (data.session) redirect("/account");
  return { message: "Мы отправили письмо со ссылкой подтверждения. Перейдите по ней, чтобы войти." };
}

export async function signOut() {
  if (isSupabaseConfigured) await (await createClient()).auth.signOut();
  redirect("/");
}

export async function requestPasswordReset(_: FormState, form: FormData): Promise<FormState> {
  if (!isSupabaseConfigured) return { error: NOT_CONFIGURED };
  const parsed = z.object({ email }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${await origin()}/auth/callback?next=/reset-password`,
  });
  // Ответ одинаковый для любого адреса, чтобы нельзя было перебирать зарегистрированные email.
  return { message: "Если такой адрес зарегистрирован, мы отправили на него ссылку для сброса пароля." };
}

export async function updatePassword(_: FormState, form: FormData): Promise<FormState> {
  if (!isSupabaseConfigured) return { error: NOT_CONFIGURED };
  const parsed = z
    .object({ password, confirm: z.string() })
    .refine((v) => v.password === v.confirm, { message: "Пароли не совпадают", path: ["confirm"] })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: "Ссылка устарела. Запросите сброс пароля заново." };
  redirect("/account");
}
