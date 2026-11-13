import type { Metadata } from "next";
import { MapPin } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/common/states";
import { ActionForm } from "@/components/common/form";
import { DeleteAddress } from "@/components/shop/delete-address";
import { addAddress } from "@/lib/actions/shop";
import { getAddresses } from "@/lib/data/user";

export const metadata: Metadata = { title: "Адреса доставки" };
const field = "h-11 w-full rounded-xl border bg-background px-4 text-sm";

export default async function AddressesPage() {
  const addresses = await getAddresses();
  return (
    <>
      <PageHeader title="Адреса доставки" />
      <div className="grid gap-10 xl:grid-cols-2">
        <div className="space-y-3">
          {addresses.length ? addresses.map((a) => (
            <div key={a.id} className="flex items-start justify-between gap-4 rounded-2xl border p-5 text-sm">
              <div>
                <p className="font-semibold">{a.label}{a.is_default && <span className="ml-2 rounded-full bg-accent px-2 py-0.5 text-xs font-normal">по умолчанию</span>}</p>
                <p className="mt-1">{a.recipient}, {a.phone}</p>
                <p className="text-muted-foreground">{a.postal_code}, {a.city}, {a.street}</p>
              </div>
              <DeleteAddress id={a.id} />
            </div>
          )) : <EmptyState icon={MapPin} title="Адресов нет" text="Добавьте адрес, чтобы быстрее оформлять заказы." />}
        </div>
        <div>
          <h2 className="mb-4 text-3xl font-semibold">Новый адрес</h2>
          <ActionForm action={addAddress} submit="Добавить адрес" resetOnSuccess>
            <div className="grid gap-3 sm:grid-cols-2">
              <input name="label" required defaultValue="Дом" placeholder="Название" aria-label="Название" className={field} />
              <input name="recipient" required placeholder="Получатель" aria-label="Получатель" className={field} />
              <input name="phone" type="tel" required placeholder="Телефон" aria-label="Телефон" className={field} />
              <input name="postal_code" required placeholder="Индекс" aria-label="Индекс" className={field} />
              <input name="city" required placeholder="Город" aria-label="Город" className={field} />
              <input name="street" required placeholder="Улица, дом, квартира" aria-label="Улица, дом, квартира" className={field} />
            </div>
          </ActionForm>
        </div>
      </div>
    </>
  );
}
