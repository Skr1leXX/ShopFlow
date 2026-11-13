import Link from "next/link";
import { Heart, Menu, Search, ShoppingBag, User, LogOut, Shield } from "lucide-react";
import { CartBadge } from "@/components/layout/cart-badge";
import { signOut } from "@/lib/actions/auth";
import type { Category, Profile } from "@/lib/data/types";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link href="/" className={`font-heading text-3xl font-bold tracking-tight ${className}`} aria-label="ShopFlow — на главную">
      Shop<span className="font-medium italic">Flow</span>
    </Link>
  );
}

const iconLink = "relative grid size-10 place-items-center rounded-full transition-colors hover:bg-accent";

export function Header({ profile, cartCount, categories }: { profile: Profile | null; cartCount: number; categories: Category[] }) {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6">
        <details className="group relative lg:hidden">
          <summary className={`${iconLink} list-none cursor-pointer`} aria-label="Меню"><Menu className="size-5" /></summary>
          <nav className="absolute left-0 top-12 w-64 rounded-2xl border bg-background p-2 shadow-xl">
            <Link href="/catalog" className="block rounded-xl px-3 py-2.5 text-sm font-medium hover:bg-accent">Весь каталог</Link>
            {categories.map((c) => (
              <Link key={c.id} href={`/catalog?category=${c.slug}`} className="block rounded-xl px-3 py-2.5 text-sm hover:bg-accent">{c.name}</Link>
            ))}
          </nav>
        </details>

        <Logo />

        <nav className="ml-8 hidden items-center gap-1 lg:flex" aria-label="Категории">
          <Link href="/catalog" className="rounded-full px-3 py-2 text-sm font-medium hover:bg-accent">Каталог</Link>
          {categories.slice(0, 4).map((c) => (
            <Link key={c.id} href={`/catalog?category=${c.slug}`} className="rounded-full px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
              {c.name.split(" и ")[0]}
            </Link>
          ))}
        </nav>

        <form action="/catalog" role="search" className="relative ml-auto hidden w-64 md:block">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            name="q" type="search" placeholder="Поиск товаров" aria-label="Поиск товаров"
            className="h-10 w-full rounded-full border bg-muted/60 pl-10 pr-4 text-sm outline-none transition focus:border-foreground/30 focus:bg-background"
          />
        </form>

        <div className="ml-auto flex items-center md:ml-0">
          <Link href="/catalog?focus=search" className={`${iconLink} md:hidden`} aria-label="Поиск"><Search className="size-5" /></Link>
          <Link href="/account/favorites" className={iconLink} aria-label="Избранное"><Heart className="size-5" /></Link>
          <Link href="/cart" className={iconLink}>
            <ShoppingBag className="size-5" />
            <CartBadge serverCount={cartCount} loggedIn={!!profile} />
          </Link>
          {profile ? (
            <details className="relative">
              <summary className={`${iconLink} list-none cursor-pointer`} aria-label="Аккаунт"><User className="size-5" /></summary>
              <div className="absolute right-0 top-12 w-60 rounded-2xl border bg-background p-2 shadow-xl">
                <p className="truncate px-3 py-2 text-xs text-muted-foreground">{profile.full_name || profile.email}</p>
                <Link href="/account" className="block rounded-xl px-3 py-2 text-sm hover:bg-accent">Личный кабинет</Link>
                <Link href="/account/orders" className="block rounded-xl px-3 py-2 text-sm hover:bg-accent">Мои заказы</Link>
                {profile.role === "admin" && (
                  <Link href="/admin" className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-accent"><Shield className="size-4" /> Админ-панель</Link>
                )}
                <form action={signOut}>
                  <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-destructive hover:bg-accent"><LogOut className="size-4" /> Выйти</button>
                </form>
              </div>
            </details>
          ) : (
            <Link href="/login" className="ml-1 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-85">Войти</Link>
          )}
        </div>
      </div>
    </header>
  );
}
