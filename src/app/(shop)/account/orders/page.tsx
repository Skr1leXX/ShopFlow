import type { Metadata } from "next";
import { Package } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/common/states";
import { OrderCard } from "@/components/shop/order-card";
import { getMyOrders } from "@/lib/data/user";

export const metadata: Metadata = { title: "Мои заказы" };

export default async function OrdersPage() {
  const orders = await getMyOrders();
  return (
    <>
      <PageHeader title="Мои заказы" />
      {orders.length ? (
        <div className="space-y-4">{orders.map((o) => <OrderCard key={o.id} order={o} />)}</div>
      ) : (
        <EmptyState icon={Package} title="Заказов пока нет" text="Оформленные заказы появятся здесь." href="/catalog" action="Перейти в каталог" />
      )}
    </>
  );
}
