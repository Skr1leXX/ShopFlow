import { notFound } from "next/navigation";
import { PageHeader } from "@/components/common/states";
import { ProductForm } from "@/components/admin/product-form";
import { VariantsEditor } from "@/components/admin/variants-editor";
import { DeleteProductButton, ProductImages } from "@/components/admin/controls";
import { getAdminProduct, listAdminCategories } from "@/lib/data/admin";

export const metadata = { title: "Редактирование товара" };

export default async function EditProduct({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = /^[0-9a-f-]{36}$/i.test(id) ? await getAdminProduct(id) : null;
  if (!product) notFound();
  const categories = await listAdminCategories();
  return (
    <>
      <PageHeader title={product.name}>
        <DeleteProductButton id={product.id} />
      </PageHeader>
      <div className="space-y-10">
        <section className="rounded-2xl border bg-background p-6"><ProductForm categories={categories} product={product} /></section>
        <section className="rounded-2xl border bg-background p-6">
          <h2 className="mb-4 text-2xl font-semibold">Фотографии</h2>
          <ProductImages productId={product.id} images={product.product_images} />
        </section>
        <section className="rounded-2xl border bg-background p-6">
          <h2 className="mb-4 text-2xl font-semibold">Размеры, цвета и остатки</h2>
          <VariantsEditor productId={product.id} variants={product.product_variants} />
        </section>
      </div>
    </>
  );
}
