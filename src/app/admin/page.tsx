import Link from "next/link";
import { AlertTriangle, Banknote, Package, Receipt, ShoppingBag, Users } from "lucide-react";
import { PageHeader } from "@/components/common/states";
import { SalesChart } from "@/components/admin/sales-chart";
import { StatusBadge } from "@/components/shop/order-card";
import { LOW_STOCK, getDashboard } from "@/lib/data/admin";
import { formatDate, formatPrice } from "@/lib/format";

export const metadata = { title: "Dashboard" };

export default async function AdminDashboard() {
  const d = await getDashboard();
  const stats = [
    { label: "Выручка (без отменённых)", value: formatPrice(d.revenue), icon: Banknote },
    { label: `Заказов всего (новых: ${d.newOrders})`, value: d.orderCount, icon: Package },
    { label: "Средний чек", value: formatPrice(d.avgCheck), icon: Receipt },
    { label: "Клиентов", value: d.customers, icon: Users },
    { label: "Активных товаров", value: d.products, icon: ShoppingBag },
    { label: `Позиций с остатком ≤ ${LOW_STOCK}`, value: d.lowStock.length >= 8 ? "8+" : d.lowStock.length, icon: AlertTriangle },
  ];
  const card = "rounded-2xl border bg-background p-5";
  return (
    <>
      <PageHeader title="Dashboard" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {stats.map(({ label, value, icon: Icon }) => (
          <div key={label} className={card}>
            <Icon className="size-5 text-muted-foreground" />
            <p className="mt-4 font-heading text-4xl font-semibold">{value}</p>
            <p className="text-sm text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>

      <section className={`${card} mt-6`}>
        <h2 className="mb-4 text-2xl font-semibold">Продажи за 30 дней</h2>
        <SalesChart data={d.sales} />
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className={card}>
          <h2 className="mb-4 text-2xl font-semibold">Популярные товары</h2>
          {d.top.length ? (
            <ol className="divide-y text-sm">
              {d.top.map((p, i) => (
                <li key={p.product_id ?? p.name} className="flex items-center gap-3 py-3">
                  <span className="grid size-7 place-items-center rounded-full bg-muted text-xs font-semibold">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                  <span className="text-muted-foreground">{p.units} шт.</span>
                  <span className="w-24 text-right font-semibold">{formatPrice(p.revenue)}</span>
                </li>
              ))}
            </ol>
          ) : <p className="py-6 text-center text-sm text-muted-foreground">Продаж пока нет</p>}
        </section>

        <section className={card}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-2xl font-semibold">Низкий остаток</h2>
            <Link href="/admin/inventory?filter=low" className="text-sm font-medium underline">Склад</Link>
          </div>
          {d.lowStock.length ? (
            <ul className="divide-y text-sm">
              {d.lowStock.map((r) => (
                <li key={r.variant_id} className="flex items-center justify-between gap-3 py-3">
                  <span className="min-w-0 truncate">{r.variant.products.name} <span className="text-muted-foreground">· {r.variant.color}, {r.variant.size}</span></span>
                  <span className={r.quantity === 0 ? "font-semibold text-destructive" : "font-semibold"}>{r.quantity === 0 ? "нет" : `${r.quantity} шт.`}</span>
                </li>
              ))}
            </ul>
          ) : <p className="py-6 text-center text-sm text-muted-foreground">Все позиции в достаточном количестве</p>}
        </section>
      </div>

      <section className={`${card} mt-6`}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-2xl font-semibold">Последние заказы</h2>
          <Link href="/admin/orders" className="text-sm font-medium underline">Все заказы</Link>
        </div>
        {d.recent.length ? (
          <ul className="divide-y text-sm">
            {d.recent.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <span className="font-medium">№{o.number} · {o.contact_name}</span>
                <span className="text-muted-foreground">{formatDate(o.created_at)}</span>
                <StatusBadge status={o.status} />
                <span className="font-semibold">{formatPrice(o.total)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="py-6 text-center text-sm text-muted-foreground">Заказов пока нет</p>}
      </section>
    </>
  );
}
