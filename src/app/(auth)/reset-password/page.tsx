import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ActionForm } from "@/components/common/form";
import { updatePassword } from "@/lib/actions/auth";
import { getUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Новый пароль" };
const field = "h-11 w-full rounded-xl border bg-background px-4 text-sm";

export default async function ResetPasswordPage() {
  // На эту страницу попадают по ссылке из письма: /auth/callback уже создал сессию.
  if (!(await getUser())) redirect("/login?error=link");
  return (
    <>
      <h1 className="text-4xl font-semibold">Новый пароль</h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">Придумайте пароль не короче 8 символов.</p>
      <ActionForm action={updatePassword} submit="Сохранить пароль" className="[&>button]:w-full">
        <input name="password" type="password" required minLength={8} autoComplete="new-password" placeholder="Новый пароль" aria-label="Новый пароль" className={field} />
        <input name="confirm" type="password" required minLength={8} autoComplete="new-password" placeholder="Повторите пароль" aria-label="Повторите пароль" className={field} />
      </ActionForm>
    </>
  );
}
