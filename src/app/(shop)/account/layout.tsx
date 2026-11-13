import Link from "next/link";
import { Heart, MapPin, Package, UserRound } from "lucide-react";
import { requireUser } from "@/lib/auth";

const NAV = [
  { href: "/account", label: "Профиль", icon: UserRound },
  { href: "/account/orders", label: "Заказы", icon: Package },
  { href: "/account/favorites", label: "Избранное", icon: Heart },
  { href: "/account/addresses", label: "Адреса", icon: MapPin },
];

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  await requireUser("/account");
  return (
    <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[220px_1fr]">
      <nav aria-label="Личный кабинет" className="flex gap-1 overflow-x-auto md:flex-col md:self-start">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className="flex items-center gap-3 whitespace-nowrap rounded-full px-4 py-2.5 text-sm font-medium transition-colors hover:bg-accent">
            <Icon className="size-4" /> {label}
          </Link>
        ))}
      </nav>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
