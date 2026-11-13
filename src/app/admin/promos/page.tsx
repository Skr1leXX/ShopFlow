import { ActionForm } from "@/components/common/form";
import { PageHeader } from "@/components/common/states";
import { DeletePromoButton, PromoToggle } from "@/components/admin/controls";
import { savePromo } from "@/lib/actions/admin";
import { listPromos } from "@/lib/data/admin";
import { formatDate, formatPrice } from "@/lib/format";
import type { PromoCode } from "@/lib/data/types";

export const metadata = { title: "Промокоды" };
const field = "h-10 w-full rounded-lg border bg-background px-3 text-sm";
const lbl = "block space-y-1 text-xs text-muted-foreground";

function PromoFields({ p }: { p?: PromoCode }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {p && <input type="hidden" name="id" value={p.id} />}
      <label className={lbl}>Код<input name="code" required defaultValue={p?.code} placeholder="SUMMER10" className={`${field} uppercase`} /></label>
      <label className={lbl}>Тип скидки
        <select name="kind" defaultValue={p?.discount_amount ? "amount" : "percent"} className={field}><option value="percent">Процент, %</option><option value="amount">Сумма, ₽</option></select>
      </label>
      <label className={lbl}>Размер скидки<input name="value" type="number" min={1} step="1" required defaultValue={p?.discount_percent ?? p?.discount_amount ?? ""} className={field} /></label>
      <label className={lbl}>Минимальная сумма заказа, ₽<input name="min_order_total" type="number" min={0} defaultValue={p?.min_order_total ?? 0} className={field} /></label>
      <label className={lbl}>Лимит использований<input name="max_uses" type="number" min={1} defaultValue={p?.max_uses ?? ""} placeholder="без лимита" className={field} /></label>
      <label className={lbl}>Действует до (включительно)<input name="expires_at" type="date" defaultValue={p?.expires_at?.slice(0, 10)} className={field} /></label>
      <label className={`${lbl} sm:col-span-3`}>Описание<input name="description" defaultValue={p?.description} className={field} /></label>
    </div>
  );
}

function status(p: PromoCode) {
  if (!p.is_active) return <span className="text-muted-foreground">Отключён</span>;
  if (p.expires_at && new Date(p.expires_at) < new Date()) return <span className="text-destructive">Истёк</span>;
  if (p.max_uses && p.used_count >= p.max_uses) return <span className="text-destructive">Исчерпан</span>;
  return <span className="text-success">Активен</span>;
}

export default async function AdminPromos() {
  const promos = await listPromos();
  return (
    <>
      <PageHeader title="Промокоды" text="Срок, лимит, минимальная сумма и скидка проверяются и считаются на сервере при оформлении заказа." />
      <div className="space-y-3">
        {promos.map((p) => (
          <details key={p.id} className="rounded-2xl border bg-background p-4">
            <summary className="grid cursor-pointer list-none gap-2 text-sm sm:grid-cols-[1.5fr_1fr_1fr_1fr_1fr] sm:items-center">
              <span><span className="font-semibold">{p.code}</span><span className="block text-xs text-muted-foreground">{p.description}</span></span>
              <span>{p.discount_percent ? `${p.discount_percent}%` : formatPrice(p.discount_amount ?? 0)}{p.min_order_total > 0 && <span className="block text-xs text-muted-foreground">от {formatPrice(p.min_order_total)}</span>}</span>
              <span>{p.used_count}{p.max_uses ? ` / ${p.max_uses}` : ""} исп.</span>
              <span className="text-muted-foreground">{p.expires_at ? `до ${formatDate(p.expires_at)}` : "бессрочно"}</span>
              <span>{status(p)}</span>
            </summary>
            <div className="mt-4 space-y-4 border-t pt-4">
              <ActionForm action={savePromo} submit="Сохранить"><PromoFields p={p} /></ActionForm>
              <div className="flex gap-2"><PromoToggle id={p.id} active={p.is_active} /><DeletePromoButton id={p.id} /></div>
            </div>
          </details>
        ))}
        {!promos.length && <p className="rounded-2xl border border-dashed py-10 text-center text-sm text-muted-foreground">Промокодов пока нет</p>}
      </div>

      <section className="mt-10 rounded-2xl border bg-background p-6">
        <h2 className="mb-4 text-2xl font-semibold">Новый промокод</h2>
        <ActionForm action={savePromo} submit="Создать" resetOnSuccess><PromoFields /></ActionForm>
      </section>
    </>
  );
}
