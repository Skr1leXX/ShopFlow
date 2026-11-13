import Link from "next/link";
import { Users } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/common/states";
import { RoleSelect } from "@/components/admin/controls";
import { StatusBadge } from "@/components/shop/order-card";
import { buttonVariants } from "@/components/ui/button";
import { requireAdmin } from "@/lib/auth";
import { listCustomers } from "@/lib/data/admin";
import { formatDate, formatPrice } from "@/lib/format";

export const metadata = { title: "Клиенты" };

export default async function AdminCustomers({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const [me, customers] = await Promise.all([requireAdmin(), listCustomers(q)]);
  return (
    <>
      <PageHeader title="Клиенты" text={`Найдено: ${customers.length}`} />
      <form className="mb-6 flex gap-2" role="search">
        <input name="q" defaultValue={q} type="search" placeholder="Имя, email или телефон" aria-label="Поиск" className="h-10 min-w-64 flex-1 rounded-full border bg-background px-4 text-sm" />
        <button className={buttonVariants()}>Найти</button>
        {q && <Link href="/admin/customers" className={buttonVariants({ variant: "ghost" })}>Сбросить</Link>}
      </form>
      {customers.length ? (
        <div className="space-y-3">
          {customers.map((c) => (
            <details key={c.id} className="rounded-2xl border bg-background p-4">
              <summary className="grid cursor-pointer list-none gap-2 text-sm sm:grid-cols-[1.5fr_1fr_80px_110px_auto] sm:items-center">
                <span><span className="font-medium">{c.full_name || "Без имени"}</span><span className="block text-xs text-muted-foreground">{c.email}</span></span>
                <span className="text-muted-foreground">{c.phone || "телефон не указан"}</span>
                <span>{c.orders} зак.</span>
                <span className="font-semibold">{formatPrice(c.spent)}</span>
                <span className="text-xs text-muted-foreground">с {formatDate(c.created_at)}</span>
              </summary>
              <div className="mt-4 grid gap-6 border-t pt-4 text-sm md:grid-cols-[1fr_auto]">
                <div>
                  <p className="mb-2 font-medium">История заказов</p>
                  {c.history.length ? (
                    <ul className="divide-y">
                      {c.history.map((o) => (
                        <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                          <span>№{o.number} · {formatDate(o.created_at)}</span><StatusBadge status={o.status} /><span className="font-medium">{formatPrice(o.total)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="text-muted-foreground">Заказов нет</p>}
                </div>
                <div>
                  <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Роль</p>
                  <RoleSelect id={c.id} role={c.role} self={c.id === me.id} />
                </div>
              </div>
            </details>
          ))}
        </div>
      ) : <EmptyState icon={Users} title="Клиентов не найдено" text={q ? "Измените запрос." : undefined} />}
    </>
  );
}
