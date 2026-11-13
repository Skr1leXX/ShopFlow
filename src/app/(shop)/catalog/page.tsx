import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { CatalogFilters, SortSelect } from "@/components/shop/catalog-filters";
import { ProductGrid } from "@/components/shop/product-card";
import { EmptyState, PageHeader } from "@/components/common/states";
import { getCategories, getFacets, getProducts, PAGE_SIZE, SORTS, type SortKey } from "@/lib/data/catalog";
import { getFavoriteIds } from "@/lib/data/user";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Каталог" };

type Search = Record<string, string | string[] | undefined>;
const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []);
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const num = (v: string | string[] | undefined) => {
  const n = Number(one(v));
  return one(v) && Number.isFinite(n) && n >= 0 ? n : undefined;
};

export default async function CatalogPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const sortParam = one(sp.sort);
  const sort: SortKey = sortParam && sortParam in SORTS ? (sortParam as SortKey) : "popular";
  const q = one(sp.q)?.slice(0, 80);
  const category = one(sp.category);
  const page = Math.max(1, Math.floor(num(sp.page) ?? 1));

  const [categories, facets, favorites, { items, total }] = await Promise.all([
    getCategories(),
    getFacets(),
    getFavoriteIds(),
    getProducts({ q, category, brands: list(sp.brand), sizes: list(sp.size), colors: list(sp.color), min: num(sp.min), max: num(sp.max), sort, page }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = categories.find((c) => c.slug === category);

  const href = (p: number) => {
    const params = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => list(v).map((x) => [k, x] as [string, string])));
    params.set("page", String(p));
    return `/catalog?${params}`;
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <PageHeader
        title={q ? `Поиск: «${q}»` : current?.name ?? "Каталог"}
        text={current?.description || `Найдено товаров: ${total}`}
      >
        <SortSelect options={SORTS} />
      </PageHeader>

      <form action="/catalog" role="search" className="mb-8 flex gap-2 md:hidden">
        <input name="q" defaultValue={q} type="search" autoFocus={one(sp.focus) === "search"} placeholder="Поиск товаров" aria-label="Поиск товаров" className="h-11 flex-1 rounded-full border px-5 text-sm" />
        <button className="h-11 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground">Найти</button>
      </form>

      <div className="grid gap-10 lg:grid-cols-[240px_1fr]">
        <CatalogFilters facets={facets} categories={categories} />
        <div>
          {items.length ? (
            <>
              <ProductGrid products={items} favorites={favorites} />
              {pages > 1 && (
                <nav aria-label="Страницы" className="mt-14 flex items-center justify-center gap-1">
                  {page > 1 && <Link href={href(page - 1)} aria-label="Назад" className="grid size-10 place-items-center rounded-full hover:bg-accent"><ChevronLeft className="size-4" /></Link>}
                  {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
                    <Link key={n} href={href(n)} aria-current={n === page ? "page" : undefined}
                      className={cn("grid size-10 place-items-center rounded-full text-sm hover:bg-accent", n === page && "bg-primary text-primary-foreground hover:bg-primary")}>{n}</Link>
                  ))}
                  {page < pages && <Link href={href(page + 1)} aria-label="Вперёд" className="grid size-10 place-items-center rounded-full hover:bg-accent"><ChevronRight className="size-4" /></Link>}
                </nav>
              )}
            </>
          ) : (
            <EmptyState title="Ничего не найдено" text="Попробуйте изменить фильтры или поисковый запрос." href="/catalog" action="Сбросить фильтры" />
          )}
        </div>
      </div>
    </div>
  );
}
