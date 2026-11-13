import Link from "next/link";
import { BarChart3, Boxes, FolderTree, Package, Settings, ShoppingBag, Tag, Users, ArrowLeft } from "lucide-react";
import { Logo } from "@/components/layout/header";
import { SetupNotice } from "@/components/common/states";
import { requireAdmin } from "@/lib/auth";
import { isDbConfigured } from "@/lib/env";

export const metadata = { title: { default: "Админ-панель", template: "%s · Админ ShopFlow" }, robots: { index: false } };

const NAV = [
  { href: "/admin", label: "Dashboard", icon: BarChart3 },
  { href: "/admin/products", label: "Товары", icon: ShoppingBag },
  { href: "/admin/categories", label: "Категории", icon: FolderTree },
  { href: "/admin/orders", label: "Заказы", icon: Package },
  { href: "/admin/customers", label: "Клиенты", icon: Users },
  { href: "/admin/inventory", label: "Склад", icon: Boxes },
  { href: "/admin/promos", label: "Промокоды", icon: Tag },
  { href: "/admin/settings", label: "Настройки", icon: Settings },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!isDbConfigured) return <SetupNotice />;
  // Роль проверяется на сервере по данным БД; без неё страница не отрисовывается.
  const admin = await requireAdmin();
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="shrink-0 bg-primary text-primary-foreground md:w-60">
        <div className="flex items-center justify-between px-5 py-4 md:block md:py-6">
          <Logo />
          <p className="text-xs text-primary-foreground/50 md:mt-1">Администратор</p>
        </div>
        <nav aria-label="Разделы админ-панели" className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:pb-0">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className="flex items-center gap-3 whitespace-nowrap rounded-full px-4 py-2.5 text-sm text-primary-foreground/75 transition-colors hover:bg-white/10 hover:text-primary-foreground">
              <Icon className="size-4" /> {label}
            </Link>
          ))}
          <Link href="/" className="flex items-center gap-3 whitespace-nowrap rounded-full px-4 py-2.5 text-sm text-primary-foreground/50 hover:text-primary-foreground md:mt-6">
            <ArrowLeft className="size-4" /> В магазин
          </Link>
        </nav>
        <p className="hidden truncate px-5 py-4 text-xs text-primary-foreground/40 md:block">{admin.email}</p>
      </aside>
      <main className="min-w-0 flex-1 bg-muted/40 p-4 sm:p-8">{children}</main>
    </div>
  );
}
