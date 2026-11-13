import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/common/form";
import { requestPasswordReset } from "@/lib/actions/auth";

export const metadata: Metadata = { title: "Восстановление пароля" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="text-4xl font-semibold">Восстановление пароля</h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">Укажите email — мы отправим ссылку для создания нового пароля.</p>
      <ActionForm action={requestPasswordReset} submit="Отправить ссылку" className="[&>button]:w-full">
        <input name="email" type="email" required autoComplete="email" placeholder="Email" aria-label="Email" className="h-11 w-full rounded-xl border bg-background px-4 text-sm" />
      </ActionForm>
      <p className="mt-6 text-center text-sm"><Link href="/login" className="text-muted-foreground hover:text-foreground">Вернуться ко входу</Link></p>
    </>
  );
}
