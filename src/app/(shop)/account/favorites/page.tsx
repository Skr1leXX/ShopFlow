import type { Metadata } from "next";
import { Heart } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/common/states";
import { ProductGrid } from "@/components/shop/product-card";
import { getFavoriteProducts } from "@/lib/data/user";

export const metadata: Metadata = { title: "Избранное" };

export default async function FavoritesPage() {
  const products = await getFavoriteProducts();
  return (
    <>
      <PageHeader title="Избранное" />
      {products.length ? (
        <ProductGrid products={products} favorites={new Set(products.map((p) => p.id))} />
      ) : (
        <EmptyState icon={Heart} title="В избранном пусто" text="Нажмите на сердечко у товара, чтобы сохранить его." href="/catalog" action="Перейти в каталог" />
      )}
    </>
  );
}
