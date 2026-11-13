import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/common/form";
import { signIn } from "@/lib/actions/auth";
import { safeNext } from "@/lib/auth";

export const metadata: Metadata = { title: "Вход" };
const field = "h-11 w-full rounded-xl border bg-background px-4 text-sm";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <>
      <h1 className="text-4xl font-semibold">Вход</h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">Войдите, чтобы пользоваться корзиной, избранным и заказами.</p>
      <ActionForm action={signIn} submit="Войти" className="[&>button]:w-full">
        <input type="hidden" name="next" value={safeNext(next)} />
        <input name="email" type="email" required autoComplete="email" placeholder="Email" aria-label="Email" className={field} />
        <input name="password" type="password" required autoComplete="current-password" placeholder="Пароль" aria-label="Пароль" className={field} />
      </ActionForm>
      <div className="mt-6 flex justify-end text-sm">
        <Link href="/register" className="font-medium underline">Регистрация</Link>
      </div>
    </>
  );
}
