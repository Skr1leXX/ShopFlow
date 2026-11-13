import { ActionForm } from "@/components/common/form";
import { saveProduct } from "@/lib/actions/admin";
import type { Category, ProductFull } from "@/lib/data/types";

const field = "h-11 w-full rounded-xl border bg-background px-4 text-sm";
const label = "block space-y-1.5 text-sm [&>span]:text-muted-foreground";

export function ProductForm({ categories, product }: { categories: Category[]; product?: ProductFull }) {
  const details = product ? Object.entries(product.details).map(([k, v]) => `${k}: ${v}`).join("\n") : "";
  return (
    <ActionForm action={saveProduct} submit={product ? "Сохранить товар" : "Создать товар"} className="max-w-2xl">
      {product && <input type="hidden" name="id" value={product.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={`${label} sm:col-span-2`}><span>Название</span><input name="name" required defaultValue={product?.name} className={field} /></label>
        <label className={label}><span>Бренд</span><input name="brand" required defaultValue={product?.brand} className={field} /></label>
        <label className={label}><span>Категория</span>
          <select name="category_id" required defaultValue={product?.category_id ?? ""} className={field}>
            <option value="" disabled>Выберите…</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className={label}><span>Цена, ₽</span><input name="price" type="number" min={0} step="1" required defaultValue={product?.price} className={field} /></label>
        <label className={label}><span>Старая цена, ₽ (если есть скидка)</span><input name="old_price" type="number" min={0} step="1" defaultValue={product?.old_price ?? ""} className={field} /></label>
        <label className={`${label} sm:col-span-2`}><span>Slug (адрес страницы; пусто — из названия)</span><input name="slug" defaultValue={product?.slug} pattern="[a-z0-9\-]*" className={field} /></label>
        <label className={`${label} sm:col-span-2`}><span>Описание</span><textarea name="description" rows={4} defaultValue={product?.description} className="w-full rounded-xl border bg-background px-4 py-3 text-sm" /></label>
        <label className={`${label} sm:col-span-2`}><span>Характеристики (по одной в строке: «Материал: хлопок»)</span><textarea name="details" rows={4} defaultValue={details} className="w-full rounded-xl border bg-background px-4 py-3 text-sm" /></label>
      </div>
      <div className="flex flex-wrap gap-6 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" name="is_active" defaultChecked={product?.is_active ?? true} className="size-4 accent-black" /> Показывать в каталоге</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="is_new" defaultChecked={product?.is_new} className="size-4 accent-black" /> Новинка</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="is_featured" defaultChecked={product?.is_featured} className="size-4 accent-black" /> Рекомендуемый</label>
      </div>
    </ActionForm>
  );
}
