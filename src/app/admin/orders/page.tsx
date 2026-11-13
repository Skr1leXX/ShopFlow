import Link from "next/link";
import { Download, Package } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/common/states";
import { OrderStatusSelect } from "@/components/admin/controls";
import { StatusBadge } from "@/components/shop/order-card";
import { buttonVariants } from "@/components/ui/button";
import { listAdminOrders } from "@/lib/data/admin";
import { DELIVERY, ORDER_STATUS, PAYMENT, formatDate, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata = { title: "Заказы" };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const sel = "h-10 rounded-full border bg-background px-4 text-sm";

export default async function AdminOrders({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const f = { q: one(sp.q), status: one(sp.status) || "all" };
  const orders = await listAdminOrders(f);
  const filtered = Boolean(f.q || f.status !== "all");
  const exportQs = new URLSearchParams(Object.entries(f).filter(([, v]) => v && v !== "all"));

  return (
    <>
      <PageHeader title="Заказы" text={`Найдено: ${orders.length}`}>
        <a href={`/admin/export/orders${exportQs.size ? `?${exportQs}` : ""}`} className={buttonVariants({ variant: "outline" })}><Download /> CSV</a>
      </PageHeader>

      <form className="mb-6 flex flex-wrap gap-2" role="search">
        <input name="q" defaultValue={f.q} type="search" placeholder="№ заказа, имя, email, телефон" aria-label="Поиск" className={cn(sel, "min-w-64 flex-1")} />
        <select name="status" defaultValue={f.status} aria-label="Статус" className={sel}>
          <option value="all">Все статусы</option>
          {Object.entries(ORDER_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className={buttonVariants()}>Применить</button>
        {filtered && <Link href="/admin/orders" className={buttonVariants({ variant: "ghost" })}>Сбросить</Link>}
      </form>

      {orders.length ? (
        <div className="space-y-3">
          {orders.map((o) => (
            <details key={o.id} className="rounded-2xl border bg-background p-4">
              <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 text-sm">
                <span className="font-semibold">№{o.number}</span>
                <span>{o.contact_name}</span>
                <span className="text-muted-foreground">{formatDate(o.created_at)}</span>
                <StatusBadge status={o.status} />
                <span className="font-semibold">{formatPrice(o.total)}</span>
              </summary>
              <div className="mt-4 grid gap-6 border-t pt-4 text-sm lg:grid-cols-[1fr_auto]">
                <div className="space-y-4">
                  <ul className="space-y-1">
                    {(o.order_items ?? []).map((i) => (
                      <li key={i.id} className="flex justify-between gap-4">
                        <span>{i.product_name} <span className="text-muted-foreground">· {i.color}, {i.size} × {i.quantity}</span></span>
                        <span>{formatPrice(i.unit_price * i.quantity)}</span>
                      </li>
                    ))}
                  </ul>
                  <dl className="space-y-1 border-t pt-3">
                    <div className="flex justify-between"><dt className="text-muted-foreground">Товары</dt><dd>{formatPrice(o.subtotal)}</dd></div>
                    <div className="flex justify-between"><dt className="text-muted-foreground">Скидка</dt><dd>−{formatPrice(o.discount)}</dd></div>
                    <div className="flex justify-between"><dt className="text-muted-foreground">Доставка</dt><dd>{formatPrice(o.shipping)}</dd></div>
                    <div className="flex justify-between text-base font-semibold"><dt>Итого</dt><dd>{formatPrice(o.total)}</dd></div>
                  </dl>
                  <div className="rounded-xl bg-muted/60 p-3">
                    <p className="font-medium">Покупатель</p>
                    <p>{o.contact_name} · {o.contact_email} · {o.contact_phone}</p>
                    <p className="text-muted-foreground">
                      {DELIVERY[o.delivery_method]}
                      {o.shipping_address?.city && `: ${o.shipping_address.postal_code}, ${o.shipping_address.city}, ${o.shipping_address.street}`} · {PAYMENT[o.payment_method]} (демо-оплата)
                    </p>
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Статус</p>
                  <OrderStatusSelect id={o.id} status={o.status} />
                  <p className="mt-2 max-w-52 text-xs text-muted-foreground">Отмена возвращает товар на склад. Отменённый, доставленный заказ изменить нельзя; отправленный отменить нельзя.</p>
                </div>
              </div>
            </details>
          ))}
        </div>
      ) : <EmptyState icon={Package} title={filtered ? "Ничего не найдено" : "Заказов пока нет"} text={filtered ? "Измените условия поиска." : undefined} href={filtered ? "/admin/orders" : undefined} action={filtered ? "Сбросить фильтры" : undefined} />}
    </>
  );
}
