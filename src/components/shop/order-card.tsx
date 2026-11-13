import Image from "next/image";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { ORDER_STATUS, formatDate, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Order } from "@/lib/data/types";

export function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "cancelled" ? "bg-destructive/10 text-destructive" :
    status === "delivered" ? "bg-success/10 text-success" :
    status === "pending" ? "bg-amber-100 text-amber-800" : "bg-accent text-foreground";
  return <span className={cn("rounded-full px-3 py-1 text-xs font-medium", tone)}>{ORDER_STATUS[status] ?? status}</span>;
}

export function OrderCard({ order }: { order: Order }) {
  const items = order.order_items ?? [];
  return (
    <Link href={`/account/orders/${order.id}`} className="block rounded-2xl border p-5 transition-colors hover:bg-muted/50">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold">Заказ №{order.number}</p>
          <p className="text-sm text-muted-foreground">{formatDate(order.created_at)}</p>
        </div>
        <StatusBadge status={order.status} />
      </div>
      <div className="mt-4 flex items-center justify-between gap-4">
        <div className="flex -space-x-3">
          {items.slice(0, 4).map((i) => (
            <div key={i.id} className="relative size-12 overflow-hidden rounded-full border-2 border-background bg-muted">
              {i.image_url && <Image src={i.image_url} alt={i.product_name} fill sizes="48px" className="object-cover" />}
            </div>
          ))}
        </div>
        <p className="flex items-center gap-1 font-semibold">{formatPrice(order.total)} <ChevronRight className="size-4 text-muted-foreground" /></p>
      </div>
    </Link>
  );
}
