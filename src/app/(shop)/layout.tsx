import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { GuestCartSync } from "@/components/shop/guest-cart";
import { SetupNotice } from "@/components/common/states";
import { getProfile } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getCategories } from "@/lib/data/catalog";
import { getCartCount } from "@/lib/data/user";

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured) return <main className="flex-1"><SetupNotice /></main>;
  const profile = await getProfile();
  const [categories, cartCount] = await Promise.all([getCategories(), profile ? getCartCount() : 0]);
  return (
    <>
      {profile && <GuestCartSync />}
      <Header profile={profile} cartCount={cartCount} categories={categories} />
      <main className="flex-1">{children}</main>
      <Footer categories={categories} />
    </>
  );
}
