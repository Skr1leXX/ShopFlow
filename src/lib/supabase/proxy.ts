import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured, supabaseAnonKey, supabaseUrl } from "./env";

// Страницы приложения. Без настроенного Supabase они показывают инструкцию, а страницы не выполняют запросы и не падают.
const APP_ROUTES = /^\/(catalog|product|cart|checkout|account|login|register|forgot-password|reset-password)(\/|$)|^\/$|^\/admin(?!\/export)(\/|$)/;

const PRIVATE = ["/account", "/checkout", "/admin"];
const AUTH_PAGES = ["/login", "/register", "/forgot-password"];

/** Обновляет cookie сессии и закрывает приватные страницы. Роль admin проверяется на сервере в layout и в RLS. */
export async function updateSession(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return APP_ROUTES.test(request.nextUrl.pathname)
      ? NextResponse.rewrite(new URL("/setup", request.url))
      : NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list) {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getUser() проверяет токен на сервере Auth; getSession() доверять нельзя.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPrivate = PRIVATE.some((p) => pathname === p || pathname.startsWith(p + "/"));
  let target: string | null = null;
  if (!user && isPrivate) target = `/login?next=${encodeURIComponent(pathname + request.nextUrl.search)}`;
  else if (user && AUTH_PAGES.includes(pathname)) target = "/account";

  if (target) {
    const redirect = NextResponse.redirect(new URL(target, request.url));
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  }
  return response;
}
