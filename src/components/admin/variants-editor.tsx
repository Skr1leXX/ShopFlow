import { ActionForm } from "@/components/common/form";
import { DeleteVariantButton, StockInput } from "@/components/admin/controls";
import { VariantActiveToggle } from "@/components/admin/catalog-controls";
import { addVariant } from "@/lib/actions/admin";
import type { Variant } from "@/lib/data/types";

const field = "h-10 w-full rounded-lg border bg-background px-3 text-sm";

export function VariantsEditor({ productId, variants }: { productId: string; variants: Variant[] }) {
  return (
    <div className="space-y-6">
      {variants.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead className="border-b text-xs uppercase tracking-wider text-muted-foreground">
              <tr><th className="py-2">Размер</th><th>Цвет</th><th>SKU</th><th>Остаток</th><th>Витрина</th><th /></tr>
            </thead>
            <tbody className="divide-y">
              {variants.map((v) => (
                <tr key={v.id}>
                  <td className="py-2">{v.size}</td>
                  <td><span className="inline-flex items-center gap-2"><span className="size-4 rounded-full border" style={{ backgroundColor: v.color_hex }} />{v.color}</span></td>
                  <td className="text-xs text-muted-foreground">{v.sku}</td>
                  <td><StockInput variantId={v.id} quantity={v.inventory?.quantity ?? 0} /></td>
                  <td><VariantActiveToggle id={v.id} active={v.is_active} /></td>
                  <td><DeleteVariantButton id={v.id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="text-sm text-muted-foreground">Вариантов пока нет — товар нельзя будет добавить в корзину.</p>}

      <ActionForm action={addVariant} submit="Добавить вариант" resetOnSuccess>
        <input type="hidden" name="product_id" value={productId} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <input name="size" required placeholder="Размер (M, 42…)" aria-label="Размер" className={field} />
          <input name="color" required placeholder="Цвет (Чёрный)" aria-label="Название цвета" className={field} />
          <label className="flex h-10 items-center gap-2 rounded-lg border px-3 text-sm text-muted-foreground">
            Оттенок <input name="color_hex" type="color" defaultValue="#1c1c1e" className="h-6 w-8 cursor-pointer border-0 bg-transparent p-0" />
          </label>
          <input name="quantity" type="number" min={0} required defaultValue={0} placeholder="Остаток" aria-label="Остаток" className={field} />
        </div>
      </ActionForm>
    </div>
  );
}
