import { Logo } from "@/components/layout/header";
import { SetupNotice } from "@/components/common/states";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { isDbConfigured } from "@/lib/env";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (isDbConfigured && (await getUser())) redirect("/account"); // вошедшему пользователю форма входа не нужна
  return (
    <main className="grid flex-1 place-items-center bg-muted/50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center"><Logo /></div>
        <div className="rounded-3xl border bg-background p-6 shadow-sm sm:p-8">
          {isDbConfigured ? children : <SetupNotice />}
        </div>
      </div>
    </main>
  );
}
