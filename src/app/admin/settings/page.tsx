import { PageHeader } from "@/components/common/states";
import { requireAdmin } from "@/lib/auth";

export const metadata = { title: "Настройки" };

// Только то, что реально есть: данные текущего администратора и состояние подключения.
export default async function AdminSettings() {
  const admin = await requireAdmin();
  const rows = [
    ["Администратор", admin.full_name || "—"],
    ["Email", admin.email],
    ["Роль", "admin"],
    ["База данных", (process.env.TURSO_DATABASE_URL ?? "не задана").replace(/^(libsql|https?):\/\//, "")],
    ["Загрузка фото", process.env.BLOB_READ_WRITE_TOKEN ? "Vercel Blob подключён" : "не настроена (только ссылки на фото)"],
    ["Доставка", "Курьер 490 ₽, почта 290 ₽, самовывоз бесплатно; бесплатно от 15 000 ₽"],
  ];
  return (
    <>
      <PageHeader title="Настройки" text="Параметры магазина пока задаются в коде (shippingCost в src/lib/core/orders.ts). Редактирование из интерфейса не реализовано." />
      <dl className="max-w-2xl divide-y rounded-2xl border bg-background text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 px-5 py-3.5"><dt className="text-muted-foreground">{k}</dt><dd className="break-all text-right font-medium">{v}</dd></div>
        ))}
      </dl>
    </>
  );
}
