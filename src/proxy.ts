import { NextResponse, type NextRequest } from "next/server";
import { isDbConfigured } from "@/lib/env";

// Страницы приложения. Без настроенной базы они показывают инструкцию и не выполняют запросов.
const APP_ROUTES = /^\/(catalog|product|cart|checkout|account|login|register)(\/|$)|^\/$|^\/admin(?!\/export)(\/|$)/;
const PRIVATE = ["/account", "/checkout", "/admin"];

/**
 * Быстрый редирект гостей с приватных страниц. Это только удобство: подлинность сессии и роль
 * проверяются в базе на сервере (requireUser / requireAdmin) и в каждом действии, а не здесь.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (!isDbConfigured) return APP_ROUTES.test(pathname) ? NextResponse.rewrite(new URL("/setup", request.url)) : NextResponse.next();
  const isPrivate = PRIVATE.some((p) => pathname === p || pathname.startsWith(p + "/"));
  if (isPrivate && !request.cookies.has("sf_session"))
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(pathname + search)}`, request.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
