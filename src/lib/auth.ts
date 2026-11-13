import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import type { Profile } from "@/lib/data/types";

/** Текущий пользователь, проверенный сервером Auth. */
export const getUser = cache(async () => {
  await cookies(); // всегда динамический рендер: приватные страницы не должны попадать в статику
  if (!isSupabaseConfigured) return null;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user;
});

export const getProfile = cache(async (): Promise<Profile | null> => {
  const user = await getUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  return data as Profile | null;
});

export async function requireUser(next = "/account") {
  const profile = await getProfile();
  if (!profile) redirect(`/login?next=${encodeURIComponent(next)}`);
  return profile;
}

/** Роль читается из БД на сервере; клиентским данным не верим. Данные всё равно защищены RLS. */
export async function requireAdmin() {
  const profile = await requireUser("/admin");
  if (profile.role !== "admin") redirect("/account?denied=1");
  return profile;
}

/** Разрешаем только относительные пути, чтобы ?next= не вёл на чужой сайт. */
export function safeNext(next: string | null | undefined, fallback = "/account") {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : fallback;
}
