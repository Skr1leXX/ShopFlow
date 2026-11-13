import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { ActionForm } from "@/components/common/form";
import { EmptyState, PageHeader } from "@/components/common/states";
import { StockInput } from "@/components/admin/controls";
import { buttonVariants } from "@/components/ui/button";
import { moveStock } from "@/lib/actions/admin";
import { LOW_STOCK, listMovements, listStock } from "@/lib/data/admin";
import { STOCK_REASON } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata = { title: "Склад" };
const sel = "h-10 rounded-full border bg-background px-4 text-sm";
const field = "h-10 w-full rounded-lg border bg-background px-3 text-sm";
const FILTERS = { "": "Все", in: "В наличии", low: `Мало (≤ ${LOW_STOCK})`, out: "Нет в наличии" };

export default async function AdminInventory({ searchParams }: { searchParams: Promise<{ q?: string; filter?: string }> }) {
  const { q = "", filter = "" } = await searchParams;
  const [rows, all, movements] = await Promise.all([listStock({ q, filter }), listStock(), listMovements()]);
  const low = all.filter((r) => r.quantity > 0 && r.quantity <= LOW_STOCK).length;
  const out = all.filter((r) => r.quantity === 0).length;

  return (
    <>
      <PageHeader title="Склад" text={`Всего позиций: ${all.length}`} />

      {(low > 0 || out > 0) && (
        <div role="status" className="mb-6 flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>
            Заканчиваются: <b>{low}</b> поз. (остаток ≤ {LOW_STOCK}), нет в наличии: <b>{out}</b> поз.{" "}
            <Link href="/admin/inventory?filter=low" className="underline">Показать мало</Link> · <Link href="/admin/inventory?filter=out" className="underline">Показать отсутствующие</Link>
          </p>
        </div>
      )}

      <section className="mb-8 rounded-2xl border bg-background p-6">
        <h2 className="mb-4 text-2xl font-semibold">Приход / списание</h2>
        <ActionForm action={moveStock} submit="Провести операцию" resetOnSuccess>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_2fr]">
            <select name="variant_id" required defaultValue="" aria-label="Товар" className={field}>
              <option value="" disabled>Товар, размер, цвет…</option>
              {all.map((r) => <option key={r.variant_id} value={r.variant_id}>{r.variant.products.name} · {r.variant.color}, {r.variant.size} (сейчас {r.quantity})</option>)}
            </select>
            <select name="reason" required defaultValue="receipt" aria-label="Тип операции" className={field}>
              <option value="receipt">Приход</option><option value="writeoff">Списание</option>
            </select>
            <input name="quantity" type="number" min={1} max={100000} required placeholder="Кол-во" aria-label="Количество" className={field} />
            <input name="note" maxLength={200} placeholder="Комментарий (поставка, брак…)" aria-label="Комментарий" className={field} />
          </div>
        </ActionForm>
      </section>

      <form className="mb-4 flex flex-wrap gap-2" role="search">
        <input name="q" defaultValue={q} type="search" placeholder="Товар, SKU или размер" aria-label="Поиск" className={cn(sel, "min-w-56 flex-1")} />
        <select name="filter" defaultValue={filter} aria-label="Наличие" className={sel}>
          {Object.entries(FILTERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className={buttonVariants()}>Применить</button>
        {(q || filter) && <Link href="/admin/inventory" className={buttonVariants({ variant: "ghost" })}>Сбросить</Link>}
      </form>

      {rows.length ? (
        <div className="overflow-x-auto rounded-2xl border bg-background">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="border-b text-xs uppercase tracking-wider text-muted-foreground">
              <tr><th className="p-4">Товар</th><th>Размер</th><th>Цвет</th><th>SKU</th><th>Остаток (установить)</th></tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.variant_id} className={r.quantity === 0 ? "bg-destructive/5" : r.quantity <= LOW_STOCK ? "bg-amber-50" : undefined}>
                  <td className="p-4 font-medium"><Link href={`/product/${r.variant.products.slug}`} className="hover:underline">{r.variant.products.name}</Link></td>
                  <td>{r.variant.size}</td><td>{r.variant.color}</td>
                  <td className="text-xs text-muted-foreground">{r.variant.sku}</td>
                  <td><StockInput variantId={r.variant_id} quantity={r.quantity} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <EmptyState title="Позиций не найдено" text="Измените условия поиска." href="/admin/inventory" action="Сбросить фильтры" />}

      <section className="mt-10">
        <h2 className="mb-4 text-2xl font-semibold">История движения</h2>
        {movements.length ? (
          <div className="overflow-x-auto rounded-2xl border bg-background">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="border-b text-xs uppercase tracking-wider text-muted-foreground">
                <tr><th className="p-4">Дата</th><th>Товар</th><th>Операция</th><th>Изменение</th><th>Остаток</th><th>Комментарий</th></tr>
              </thead>
              <tbody className="divide-y">
                {movements.map((m) => (
                  <tr key={m.id}>
                    <td className="p-4 whitespace-nowrap text-muted-foreground">{new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(new Date(m.created_at))}</td>
                    <td>{m.variant?.products?.name} <span className="text-muted-foreground">· {m.variant?.color}, {m.variant?.size}</span></td>
                    <td>{STOCK_REASON[m.reason] ?? m.reason}</td>
                    <td className={m.delta > 0 ? "font-semibold text-success" : "font-semibold text-destructive"}>{m.delta > 0 ? `+${m.delta}` : m.delta}</td>
                    <td>{m.balance}</td>
                    <td className="text-muted-foreground">{m.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState title="Движений пока нет" />}
      </section>
    </>
  );
}
