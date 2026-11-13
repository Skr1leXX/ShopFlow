import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { SearchX } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon = SearchX, title, text, href, action, className,
}: { icon?: LucideIcon; title: string; text?: string; href?: string; action?: string; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center rounded-3xl border border-dashed py-16 text-center", className)}>
      <span className="mb-4 grid size-14 place-items-center rounded-full bg-muted"><Icon className="size-6 text-muted-foreground" /></span>
      <h3 className="text-2xl font-semibold">{title}</h3>
      {text && <p className="mt-2 max-w-sm text-sm text-muted-foreground">{text}</p>}
      {href && action && (
        <Link href={href} className={cn(buttonVariants(), "mt-6")}>{action}</Link>
      )}
    </div>
  );
}

export function SetupNotice() {
  return (
    <div className="mx-auto my-24 max-w-xl rounded-3xl border bg-muted/50 p-8 text-center">
      <h2 className="text-3xl font-semibold">Подключите Supabase</h2>
      <p className="mt-3 text-sm text-muted-foreground">
        Переменные окружения не заданы. Скопируйте <code>.env.example</code> в <code>.env.local</code>, укажите URL и anon key
        проекта, примените миграции из <code>supabase/migrations</code> и перезапустите сервер.
      </p>
    </div>
  );
}

export function PageHeader({ title, text, children }: { title: string; text?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-4xl font-semibold sm:text-5xl">{title}</h1>
        {text && <p className="mt-2 text-muted-foreground">{text}</p>}
      </div>
      {children}
    </div>
  );
}

export const Skeleton = ({ className }: { className?: string }) => (
  <div className={cn("animate-pulse rounded-xl bg-muted", className)} />
);

export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-8 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>
          <Skeleton className="aspect-[4/5] rounded-2xl" />
          <Skeleton className="mt-3 h-4 w-3/4" />
          <Skeleton className="mt-2 h-4 w-1/3" />
        </div>
      ))}
    </div>
  );
}
