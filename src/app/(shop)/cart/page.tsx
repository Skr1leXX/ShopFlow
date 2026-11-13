import type { Metadata } from "next";
import { ShoppingBag } from "lucide-react";
import { CartView } from "@/components/shop/cart-view";
import { EmptyState, PageHeader } from "@/components/common/states";
import { GuestCart } from "@/components/shop/guest-cart";
import { getProfile } from "@/lib/auth";
import { getCart } from "@/lib/data/user";

export const metadata: Metadata = { title: "Корзина" };

export default async function CartPage() {
  const profile = await getProfile();
  if (!profile)
    return (
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <PageHeader title="Корзина" />
        <GuestCart />
      </div>
    );
  const lines = await getCart();
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <PageHeader title="Корзина" text={lines.length ? undefined : "Здесь появятся выбранные товары"} />
      {lines.length ? (
        <CartView lines={lines} />
      ) : (
        <EmptyState icon={ShoppingBag} title="Корзина пуста" text="Добавьте товары из каталога." href="/catalog" action="Перейти в каталог" />
      )}
    </div>
  );
}
