import Image from "next/image";
import Link from "next/link";
import { Download, Plus } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/common/states";
import { ProductActiveToggle } from "@/components/admin/catalog-controls";
import { buttonVariants } from "@/components/ui/button";
import { listAdminCategories, listAdminProducts } from "@/lib/data/admin";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata = { title: "Товары" };
type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const sel = "h-10 rounded-full border bg-background px-4 text-sm";

export default async function AdminProducts({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const f = { q: one(sp.q), category: one(sp.category), status: one(sp.status), stock: one(sp.stock), sort: one(sp.sort) || "created" };
  const [products, categories] = await Promise.all([listAdminProducts(f), listAdminCategories()]);
  const filtered = Boolean(f.q || f.category || f.status || f.stock);
  const exportQs = new URLSearchParams(Object.entries(f).filter(([k, v]) => v && k !== "sort"));

  return (
    <>
      <PageHeader title="Товары" text={`Найдено: ${products.length}`}>
        <div className="flex gap-2">
          <a href={`/admin/export/products${exportQs.size ? `?${exportQs}` : ""}`} className={buttonVariants({ variant: "outline" })}><Download /> CSV</a>
          <Link href="/admin/products/new" className={buttonVariants()}><Plus /> Новый товар</Link>
        </div>
      </PageHeader>

      <form className="mb-6 flex flex-wrap gap-2" role="search">
        <input name="q" defaultValue={f.q} type="search" placeholder="Название, бренд, slug" aria-label="Поиск" className={cn(sel, "min-w-56 flex-1")} />
        <select name="category" defaultValue={f.category} aria-label="Категория" className={sel}>
          <option value="">Все категории</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select name="status" defaultValue={f.status} aria-label="Статус" className={sel}>
          <option value="">Любой статус</option><option value="active">Активные</option><option value="hidden">Скрытые</option>
        </select>
        <select name="stock" defaultValue={f.stock} aria-label="Наличие" className={sel}>
          <option value="">Любое наличие</option><option value="in">В наличии</option><option value="out">Нет в наличии</option>
        </select>
        <select name="sort" defaultValue={f.sort} aria-label="Сортировка" className={sel}>
          <option value="created">Сначала новые</option><option value="name">По названию</option>
          <option value="price_asc">Цена ↑</option><option value="price_desc">Цена ↓</option><option value="stock">Остаток ↑</option>
        </select>
        <button className={buttonVariants()}>Применить</button>
        {filtered && <Link href="/admin/products" className={buttonVariants({ variant: "ghost" })}>Сбросить</Link>}
      </form>

      {products.length ? (
        <div className="overflow-x-auto rounded-2xl border bg-background">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b text-xs uppercase tracking-wider text-muted-foreground">
              <tr><th className="p-4">Товар</th><th>Категория</th><th>Цена</th><th>Вариантов</th><th>Остаток</th><th>Активен</th></tr>
            </thead>
            <tbody className="divide-y">
              {products.map((p) => (
                <tr key={p.id} className="hover:bg-muted/50">
                  <td className="p-4">
                    <Link href={`/admin/products/${p.id}`} className="flex items-center gap-3 font-medium">
                      <span className="relative size-12 shrink-0 overflow-hidden rounded-lg bg-muted">
                        {p.product_images[0] && <Image src={p.product_images[0].url} alt="" fill sizes="48px" className="object-cover" />}
                      </span>
                      <span>{p.name}<span className="block text-xs font-normal text-muted-foreground">{p.brand}</span></span>
                    </Link>
                  </td>
                  <td>{p.categories?.name}</td>
                  <td>
                    {formatPrice(p.price)}
                    {p.old_price && <span className="block text-xs text-muted-foreground line-through">{formatPrice(p.old_price)}</span>}
                  </td>
                  <td>{p.variant_count}</td>
                  <td className={p.total_stock === 0 ? "font-semibold text-destructive" : undefined}>{p.total_stock === 0 ? "нет" : `${p.total_stock} шт.`}</td>
                  <td><ProductActiveToggle id={p.id} active={p.is_active} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : filtered
        ? <EmptyState title="Ничего не найдено" text="Измените условия поиска." href="/admin/products" action="Сбросить фильтры" />
        : <EmptyState title="Товаров нет" href="/admin/products/new" action="Создать товар" />}
    </>
  );
}
