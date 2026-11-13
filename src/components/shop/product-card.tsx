import Image from "next/image";
import Link from "next/link";
import { formatPrice } from "@/lib/format";
import { isInStock, type Product } from "@/lib/data/types";
import { FavoriteButton } from "./favorite-button";

export function ProductCard({ product, favorite = false, priority = false }: { product: Product; favorite?: boolean; priority?: boolean }) {
  const [main, hover] = product.product_images;
  const available = isInStock(product);
  const discount = product.old_price ? Math.round((1 - product.price / product.old_price) * 100) : 0;
  return (
    <article className="group relative">
      <Link href={`/product/${product.slug}`} className="block" aria-label={product.name}>
        <div className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-muted">
          {main ? (
            <>
              <Image
                src={main.url} alt={main.alt || product.name} fill priority={priority}
                sizes="(min-width: 1024px) 25vw, 50vw"
                className={`object-cover transition duration-700 ${hover ? "group-hover:opacity-0" : "group-hover:scale-105"}`}
              />
              {hover && (
                <Image src={hover.url} alt="" fill sizes="(min-width: 1024px) 25vw, 50vw"
                  className="object-cover opacity-0 transition duration-700 group-hover:opacity-100" />
              )}
            </>
          ) : (
            <div className="grid h-full place-items-center text-sm text-muted-foreground">Нет фото</div>
          )}
          {!available && <div className="absolute inset-0 grid place-items-end bg-background/40"><span className="m-3 rounded-full bg-background px-3 py-1 text-xs font-medium">Нет в наличии</span></div>}
          <div className="absolute left-3 top-3 flex flex-col gap-1.5">
            {product.is_new && <span className="rounded-full bg-background px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide">Новинка</span>}
            {discount > 0 && <span className="rounded-full bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground">−{discount}%</span>}
          </div>
        </div>
        <div className="mt-3 space-y-0.5">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">{product.brand}</p>
          <h3 className="font-sans text-sm font-medium leading-snug">{product.name}</h3>
          <p className="flex items-baseline gap-2 text-sm">
            <span className="font-semibold">{formatPrice(product.price)}</span>
            {product.old_price && <span className="text-muted-foreground line-through">{formatPrice(product.old_price)}</span>}
          </p>
        </div>
      </Link>
      <FavoriteButton productId={product.id} initial={favorite} className="absolute right-3 top-3" />
    </article>
  );
}

export function ProductGrid({ products, favorites }: { products: Product[]; favorites: Set<string> }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-10 lg:grid-cols-4">
      {products.map((p, i) => (
        <ProductCard key={p.id} product={p} favorite={favorites.has(p.id)} priority={i < 4} />
      ))}
    </div>
  );
}
