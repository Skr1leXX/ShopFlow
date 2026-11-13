import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Gallery } from "@/components/shop/gallery";
import { FavoriteButton } from "@/components/shop/favorite-button";
import { ProductGrid } from "@/components/shop/product-card";
import { ProductPurchase } from "@/components/shop/product-purchase";
import { getProduct, getRelated } from "@/lib/data/catalog";
import { getProfile } from "@/lib/auth";
import { getFavoriteIds } from "@/lib/data/user";
import { formatPrice } from "@/lib/format";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const product = await getProduct((await params).slug);
  return { title: product?.name ?? "Товар не найден", description: product?.description };
}

export default async function ProductPage({ params }: Props) {
  const product = await getProduct((await params).slug);
  if (!product) notFound();
  const [related, favorites, profile] = await Promise.all([getRelated(product), getFavoriteIds(), getProfile()]);
  const discount = product.old_price ? Math.round((1 - product.price / product.old_price) * 100) : 0;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <nav aria-label="Навигация" className="mb-6 text-sm text-muted-foreground">
        <Link href="/catalog" className="hover:text-foreground">Каталог</Link>
        {product.categories && <> / <Link href={`/catalog?category=${product.categories.slug}`} className="hover:text-foreground">{product.categories.name}</Link></>}
      </nav>

      <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
        <Gallery images={product.product_images} name={product.name} />

        <div className="lg:py-4">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">{product.brand}</p>
          <div className="mt-2 flex items-start justify-between gap-4">
            <h1 className="text-4xl font-semibold leading-tight sm:text-5xl">{product.name}</h1>
            <FavoriteButton productId={product.id} initial={favorites.has(product.id)} className="shrink-0 border" />
          </div>
          <p className="mt-5 flex items-baseline gap-3">
            <span className="text-3xl font-semibold">{formatPrice(product.price)}</span>
            {product.old_price && (
              <>
                <span className="text-lg text-muted-foreground line-through">{formatPrice(product.old_price)}</span>
                <span className="rounded-full bg-primary px-2.5 py-0.5 text-xs font-semibold text-primary-foreground">−{discount}%</span>
              </>
            )}
          </p>
          <p className="mt-5 leading-relaxed text-muted-foreground">{product.description}</p>

          <div className="mt-8 border-t pt-8">
            <ProductPurchase variants={product.product_variants} loggedIn={!!profile} />
          </div>

          {Object.keys(product.details).length > 0 && (
            <dl className="mt-10 divide-y rounded-2xl border text-sm">
              {Object.entries(product.details).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 px-4 py-3">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="text-right font-medium">{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>

      {related.length > 0 && (
        <section className="mt-24">
          <h2 className="mb-8 text-4xl font-semibold">Похожие товары</h2>
          <ProductGrid products={related} favorites={favorites} />
        </section>
      )}
    </div>
  );
}
