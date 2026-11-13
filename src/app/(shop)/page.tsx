import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Leaf, RefreshCcw, ShieldCheck, Truck } from "lucide-react";
import { ProductGrid } from "@/components/shop/product-card";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/common/states";
import { getCategories, getHomeProducts } from "@/lib/data/catalog";
import { getFavoriteIds } from "@/lib/data/user";
import { cn } from "@/lib/utils";

const HERO = "https://images.unsplash.com/photo-1523381210434-271e8be1f52b?auto=format&fit=crop&w=2000&q=80";

const BENEFITS = [
  { icon: Truck, title: "Бесплатная доставка", text: "При заказе от 15 000 ₽ по всей стране." },
  { icon: RefreshCcw, title: "Отмена заказа", text: "Отмена возвращает товар на склад и сумму в заказ." },
  { icon: ShieldCheck, title: "Честные цены", text: "Цена в карточке равна цене в заказе — её считает сервер." },
  { icon: Leaf, title: "Качественные материалы", text: "Хлопок, лён, шерсть и натуральная кожа." },
];

function Section({ title, href, children }: { title: string; href?: string; children: React.ReactNode }) {
  return (
    <section className="mx-auto max-w-7xl px-4 pt-20 sm:px-6">
      <div className="mb-8 flex items-end justify-between gap-4">
        <h2 className="text-4xl font-semibold sm:text-5xl">{title}</h2>
        {href && (
          <Link href={href} className="group flex items-center gap-1 text-sm font-medium">
            Смотреть все <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

export default async function HomePage() {
  const [categories, { featured, fresh, sale }, favorites] = await Promise.all([getCategories(), getHomeProducts(), getFavoriteIds()]);

  return (
    <>
      <section className="relative isolate overflow-hidden bg-primary text-primary-foreground">
        <Image src={HERO} alt="" fill priority sizes="100vw" className="-z-10 object-cover opacity-55" />
        <div className="mx-auto flex min-h-[78vh] max-w-7xl flex-col justify-end px-4 pb-16 pt-32 sm:px-6 sm:pb-24">
          <p className="animate-rise text-xs font-semibold uppercase tracking-[0.3em] text-primary-foreground/70">Новая коллекция</p>
          <h1 className="animate-rise mt-4 max-w-3xl text-6xl font-semibold leading-[0.95] sm:text-8xl [animation-delay:80ms]">
            Одежда, которую носят годами
          </h1>
          <p className="animate-rise mt-6 max-w-lg text-base text-primary-foreground/75 [animation-delay:160ms]">
            Спокойные силуэты, плотные ткани и цвета, которые сочетаются между собой.
          </p>
          <div className="animate-rise mt-8 flex flex-wrap gap-3 [animation-delay:240ms]">
            <Link href="/catalog" className={cn(buttonVariants({ size: "lg" }), "bg-background text-foreground hover:bg-background/85")}>В каталог</Link>
            <Link href="/catalog?sort=new" className={cn(buttonVariants({ size: "lg", variant: "outline" }), "border-white/40 bg-transparent text-white hover:bg-white/10 hover:text-white")}>Новинки</Link>
          </div>
        </div>
      </section>

      <Section title="Популярные категории">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {categories.map((c) => (
            <Link key={c.id} href={`/catalog?category=${c.slug}`} className="group relative aspect-[4/3] overflow-hidden rounded-3xl bg-muted">
              {c.image_url && <Image src={c.image_url} alt="" fill sizes="(min-width: 768px) 33vw, 50vw" className="object-cover transition duration-700 group-hover:scale-105" />}
              <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between p-5 text-white">
                <h3 className="text-2xl font-semibold sm:text-3xl">{c.name}</h3>
                <ArrowRight className="size-5 transition-transform group-hover:translate-x-1" />
              </div>
            </Link>
          ))}
        </div>
      </Section>

      <Section title="Рекомендуем" href="/catalog">
        {featured.length ? <ProductGrid products={featured} favorites={favorites} /> : <EmptyState title="Пока нет рекомендаций" />}
      </Section>

      <Section title="Новинки" href="/catalog?sort=new">
        {fresh.length ? <ProductGrid products={fresh} favorites={favorites} /> : <EmptyState title="Новинок пока нет" />}
      </Section>

      <Section title="Специальные предложения">
        <div className="mb-8 flex flex-col gap-3 rounded-3xl bg-muted p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <div>
            <h3 className="text-3xl font-semibold">Скидка 10% на первый заказ</h3>
            <p className="mt-1 text-sm text-muted-foreground">Введите промокод WELCOME10 в корзине. Действует от 3 000 ₽.</p>
          </div>
          <Link href="/cart" className={buttonVariants({ size: "lg" })}>Перейти в корзину</Link>
        </div>
        {sale.length ? <ProductGrid products={sale} favorites={favorites} /> : <EmptyState title="Товаров со скидкой пока нет" />}
      </Section>

      <section className="mx-auto mt-24 grid max-w-7xl gap-8 border-y px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        {BENEFITS.map(({ icon: Icon, title, text }) => (
          <div key={title}>
            <Icon className="size-6" />
            <h3 className="mt-4 font-sans text-sm font-semibold">{title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{text}</p>
          </div>
        ))}
      </section>
    </>
  );
}
