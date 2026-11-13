import { ActionForm } from "@/components/common/form";
import { PageHeader } from "@/components/common/states";
import { CategoryImage, CategoryOrder } from "@/components/admin/catalog-controls";
import { DeleteCategoryButton } from "@/components/admin/controls";
import { saveCategory } from "@/lib/actions/admin";
import { listAdminCategories } from "@/lib/data/admin";

export const metadata = { title: "Категории" };
const field = "h-10 w-full rounded-lg border bg-background px-3 text-sm";

export default async function AdminCategories() {
  const categories = await listAdminCategories();
  return (
    <>
      <PageHeader title="Категории" text="Порядок стрелками — так категории идут на сайте. Нажмите на категорию, чтобы изменить её." />
      <div className="space-y-3">
        {categories.map((c, i) => (
          <div key={c.id} className="flex items-start gap-3 rounded-2xl border bg-background p-4">
            <CategoryOrder id={c.id} first={i === 0} last={i === categories.length - 1} />
            <details className="min-w-0 flex-1">
              <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-medium">{c.name} <span className="font-normal text-muted-foreground">/{c.slug}</span></span>
                <span className="text-muted-foreground">{c.product_count} тов. · {c.is_active ? "активна" : "скрыта"}</span>
              </summary>
              <div className="mt-4 space-y-6 border-t pt-4">
                <CategoryImage id={c.id} url={c.image_url} name={c.name} />
                <ActionForm action={saveCategory} submit="Сохранить">
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="sort_order" value={c.sort_order} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input name="name" required defaultValue={c.name} aria-label="Название" className={field} />
                    <input name="slug" defaultValue={c.slug} aria-label="Slug" pattern="[a-z0-9\-]*" className={field} />
                    <input name="description" defaultValue={c.description} aria-label="Описание" className={`${field} sm:col-span-2`} />
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={c.is_active} className="size-4 accent-black" /> Показывать на сайте</label>
                  </div>
                </ActionForm>
                <DeleteCategoryButton id={c.id} />
              </div>
            </details>
          </div>
        ))}
      </div>

      <section className="mt-10 rounded-2xl border bg-background p-6">
        <h2 className="mb-1 text-2xl font-semibold">Новая категория</h2>
        <p className="mb-4 text-sm text-muted-foreground">Изображение можно добавить после создания.</p>
        <ActionForm action={saveCategory} submit="Создать" resetOnSuccess>
          <input type="hidden" name="sort_order" value={categories.length} />
          <div className="grid gap-3 sm:grid-cols-2">
            <input name="name" required placeholder="Название" aria-label="Название" className={field} />
            <input name="slug" placeholder="slug (необязательно)" aria-label="Slug" pattern="[a-z0-9\-]*" className={field} />
            <input name="description" placeholder="Описание" aria-label="Описание" className={`${field} sm:col-span-2`} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked className="size-4 accent-black" /> Показывать на сайте</label>
          </div>
        </ActionForm>
      </section>
    </>
  );
}
