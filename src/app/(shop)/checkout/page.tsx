import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CheckoutForm } from "@/components/shop/checkout-form";
import { PageHeader } from "@/components/common/states";
import { requireUser } from "@/lib/auth";
import { getAddresses, getCart } from "@/lib/data/user";

export const metadata: Metadata = { title: "Оформление заказа" };

export default async function CheckoutPage({ searchParams }: { searchParams: Promise<{ promo?: string }> }) {
  const profile = await requireUser("/checkout");
  const [lines, addresses, { promo }] = await Promise.all([getCart(), getAddresses(), searchParams]);
  if (!lines.length) redirect("/cart");
  if (lines.some((l) => (l.variant.inventory?.quantity ?? 0) < l.quantity)) redirect("/cart");

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <PageHeader title="Оформление заказа" />
      <CheckoutForm
        lines={lines}
        addresses={addresses}
        promo={promo?.slice(0, 32) ?? ""}
        defaults={{ name: profile.full_name, email: profile.email, phone: profile.phone ?? "" }}
      />
    </div>
  );
}
