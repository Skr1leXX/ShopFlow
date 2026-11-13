import { PageHeader } from "@/components/common/states";
import { ProductForm } from "@/components/admin/product-form";
import { listAdminCategories } from "@/lib/data/admin";

export const metadata = { title: "Новый товар" };

export default async function NewProduct() {
  const categories = await listAdminCategories();
  return (
    <>
      <PageHeader title="Новый товар" text="Фото и варианты (размер, цвет, остаток) добавляются после создания." />
      <ProductForm categories={categories} />
    </>
  );
}
