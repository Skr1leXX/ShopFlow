import Link from "next/link";
import { Logo } from "./header";
import type { Category } from "@/lib/data/types";

export function Footer({ categories }: { categories: Category[] }) {
  return (
    <footer className="mt-24 bg-primary text-primary-foreground">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 md:grid-cols-4">
        <div className="md:col-span-2">
          <Logo />
          <p className="mt-4 max-w-sm text-sm text-primary-foreground/60">
            Одежда и аксессуары, которые хочется носить каждый день: честные материалы, спокойные цвета, понятные цены.
          </p>
        </div>
        <div>
          <h3 className="mb-4 font-sans text-xs font-semibold uppercase tracking-widest text-primary-foreground/50">Каталог</h3>
          <ul className="space-y-2 text-sm">
            {categories.map((c) => (
              <li key={c.id}><Link className="hover:underline" href={`/catalog?category=${c.slug}`}>{c.name}</Link></li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-4 font-sans text-xs font-semibold uppercase tracking-widest text-primary-foreground/50">Покупателю</h3>
          <ul className="space-y-2 text-sm">
            <li><Link className="hover:underline" href="/account/orders">Мои заказы</Link></li>
            <li><Link className="hover:underline" href="/account/favorites">Избранное</Link></li>
            <li><Link className="hover:underline" href="/cart">Корзина</Link></li>
            <li><Link className="hover:underline" href="/account">Личный кабинет</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-primary-foreground/10 py-6 text-center text-xs text-primary-foreground/50">
        © {new Date().getFullYear()} ShopFlow
      </div>
    </footer>
  );
}
