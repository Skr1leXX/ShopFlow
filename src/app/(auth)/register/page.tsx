import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/common/form";
import { signUp } from "@/lib/actions/auth";

export const metadata: Metadata = { title: "Регистрация" };
const field = "h-11 w-full rounded-xl border bg-background px-4 text-sm";

export default function RegisterPage() {
  return (
    <>
      <h1 className="text-4xl font-semibold">Регистрация</h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">Создайте аккаунт покупателя.</p>
      <ActionForm action={signUp} submit="Создать аккаунт" className="[&>button]:w-full">
        <input name="full_name" required autoComplete="name" placeholder="Имя и фамилия" aria-label="Имя и фамилия" className={field} />
        <input name="email" type="email" required autoComplete="email" placeholder="Email" aria-label="Email" className={field} />
        <input name="password" type="password" required minLength={8} autoComplete="new-password" placeholder="Пароль (от 8 символов)" aria-label="Пароль" className={field} />
      </ActionForm>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Уже есть аккаунт? <Link href="/login" className="font-medium text-foreground underline">Войти</Link>
      </p>
    </>
  );
}
