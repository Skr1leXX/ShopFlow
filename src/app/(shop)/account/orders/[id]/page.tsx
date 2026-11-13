import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { StatusBadge } from "@/components/shop/order-card";
import { DELIVERY, PAYMENT, formatDate, formatPrice } from "@/lib/format";
import { getOrder } from "@/lib/data/user";

export const metadata: Metadata = { title: "Заказ" };

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ placed?: string }> }) {
  const [{ id }, { placed }] = await Promise.all([params, searchParams]);
  // Невалидный uuid или чужой заказ: RLS вернёт пусто, оба случая — 404.
  const order = /^[0-9a-f-]{36}$/i.test(id) ? await getOrder(id) : null;
  if (!order) notFound();
  const addr = order.shipping_address;

  return (
    <>
      {placed && (
        <div role="status" className="mb-8 flex items-start gap-3 rounded-2xl bg-success/10 p-5 text-success">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="font-semibold">Заказ оформлен</p>
            <p className="text-sm">Мы получили заказ №{order.number}. Статус можно отслеживать на этой странице.</p>
          </div>
        </div>
      )}
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-4xl font-semibold">Заказ №{order.number}</h1>
          <p className="text-muted-foreground">от {formatDate(order.created_at)}</p>
        </div>
        <StatusBadge status={order.status} />
      </div>

      <ul className="divide-y rounded-2xl border">
        {(order.order_items ?? []).map((i) => (
          <li key={i.id} className="flex gap-4 p-4">
            <div className="relative aspect-[4/5] w-16 shrink-0 overflow-hidden rounded-lg bg-muted">
              {i.image_url && <Image src={i.image_url} alt="" fill sizes="64px" className="object-cover" />}
            </div>
            <div className="flex-1 text-sm">
              <p className="font-medium">{i.product_name}</p>
              <p className="text-muted-foreground">{i.color} · {i.size} · {i.quantity} × {formatPrice(i.unit_price)}</p>
            </div>
            <p className="font-medium">{formatPrice(i.unit_price * i.quantity)}</p>
          </li>
        ))}
      </ul>

      <div className="mt-8 grid gap-8 sm:grid-cols-2">
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between"><dt className="text-muted-foreground">Товары</dt><dd>{formatPrice(order.subtotal)}</dd></div>
          {order.discount > 0 && <div className="flex justify-between text-success"><dt>Скидка</dt><dd>−{formatPrice(order.discount)}</dd></div>}
          <div className="flex justify-between"><dt className="text-muted-foreground">Доставка</dt><dd>{order.shipping ? formatPrice(order.shipping) : "Бесплатно"}</dd></div>
          <div className="flex justify-between border-t pt-3 text-base font-semibold"><dt>Итого</dt><dd>{formatPrice(order.total)}</dd></div>
        </dl>
        <div className="space-y-1 text-sm">
          <p><span className="text-muted-foreground">Получатель:</span> {order.contact_name}, {order.contact_phone}</p>
          <p><span className="text-muted-foreground">Доставка:</span> {DELIVERY[order.delivery_method]}{addr?.city && `, ${addr.city}, ${addr.street}, ${addr.postal_code}`}</p>
          <p><span className="text-muted-foreground">Оплата:</span> {PAYMENT[order.payment_method]}</p>
        </div>
      </div>
    </>
  );
}
