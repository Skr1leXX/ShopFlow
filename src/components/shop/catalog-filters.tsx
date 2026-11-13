"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Category } from "@/lib/data/types";

type Facets = { brands: string[]; sizes: string[]; colors: { name: string; hex: string }[]; min: number; max: number };

/** Все фильтры живут в URL: ссылку можно сохранить, а страница рендерится на сервере. */
export function CatalogFilters({ facets, categories }: { facets: Facets; categories: Category[] }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const [min, setMin] = useState(sp.get("min") ?? "");
  const [max, setMax] = useState(sp.get("max") ?? "");

  const push = (mutate: (p: URLSearchParams) => void) => {
    const p = new URLSearchParams(sp.toString());
    mutate(p);
    p.delete("page");
    start(() => router.push(`${path}${p.size ? `?${p}` : ""}`, { scroll: false }));
  };
  const has = (key: string, v: string) => sp.getAll(key).includes(v);
  const toggle = (key: string, v: string) =>
    push((p) => {
      const cur = p.getAll(key);
      p.delete(key);
      (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]).forEach((x) => p.append(key, x));
    });
  const applyPrice = () =>
    push((p) => {
      if (min) p.set("min", min);
      else p.delete("min");
      if (max) p.set("max", max);
      else p.delete("max");
    });
  const active = ["brand", "size", "color", "min", "max", "category"].some((k) => sp.has(k));
  const reset = () => { setMin(""); setMax(""); start(() => router.push(sp.get("q") ? `${path}?q=${encodeURIComponent(sp.get("q")!)}` : path)); };

  const group = "border-b py-5 first:pt-0";
  const title = "mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground";

  const body = (
    <div className={cn("transition-opacity", pending && "opacity-60")}>
      <div className={group}>
        <h3 className={title}>Категория</h3>
        <div className="flex flex-col items-start gap-1">
          {[{ slug: "", name: "Все товары" }, ...categories].map((c) => (
            <button key={c.slug} type="button" onClick={() => push((p) => (c.slug ? p.set("category", c.slug) : p.delete("category")))}
              className={cn("rounded-full px-3 py-1.5 text-sm transition-colors hover:bg-accent", (sp.get("category") ?? "") === c.slug && "bg-primary text-primary-foreground hover:bg-primary")}>
              {c.name}
            </button>
          ))}
        </div>
      </div>

      <div className={group}>
        <h3 className={title}>Цена, ₽</h3>
        <form onSubmit={(e) => { e.preventDefault(); applyPrice(); }} className="flex items-center gap-2">
          <input type="number" inputMode="numeric" min={0} placeholder={String(facets.min)} value={min} onChange={(e) => setMin(e.target.value)}
            aria-label="Цена от" className="h-10 w-full rounded-lg border px-3 text-sm" />
          <span className="text-muted-foreground">—</span>
          <input type="number" inputMode="numeric" min={0} placeholder={String(facets.max)} value={max} onChange={(e) => setMax(e.target.value)}
            aria-label="Цена до" className="h-10 w-full rounded-lg border px-3 text-sm" />
          <Button type="submit" size="icon" variant="secondary" aria-label="Применить цену"><Check /></Button>
        </form>
      </div>

      <div className={group}>
        <h3 className={title}>Размер</h3>
        <div className="flex flex-wrap gap-2">
          {facets.sizes.map((s) => (
            <button key={s} type="button" aria-pressed={has("size", s)} onClick={() => toggle("size", s)}
              className={cn("h-9 min-w-10 rounded-lg border px-2.5 text-sm transition-colors hover:border-foreground", has("size", s) && "border-primary bg-primary text-primary-foreground hover:border-primary")}>
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className={group}>
        <h3 className={title}>Цвет</h3>
        <div className="flex flex-wrap gap-2.5">
          {facets.colors.map((c) => (
            <button key={c.name} type="button" title={c.name} aria-label={c.name} aria-pressed={has("color", c.name)} onClick={() => toggle("color", c.name)}
              className={cn("size-8 rounded-full border-2 border-border ring-offset-2 transition", has("color", c.name) && "ring-2 ring-foreground")}
              style={{ backgroundColor: c.hex }} />
          ))}
        </div>
      </div>

      <div className={cn(group, "border-b-0")}>
        <h3 className={title}>Бренд</h3>
        <div className="space-y-2">
          {facets.brands.map((b) => (
            <label key={b} className="flex cursor-pointer items-center gap-2.5 text-sm">
              <input type="checkbox" checked={has("brand", b)} onChange={() => toggle("brand", b)} className="size-4 accent-black" />
              {b}
            </label>
          ))}
        </div>
      </div>

      {active && <Button variant="outline" className="mt-2 w-full" onClick={reset}>Сбросить фильтры</Button>}
    </div>
  );

  return (
    <>
      <details className="rounded-2xl border p-4 lg:hidden">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium"><SlidersHorizontal className="size-4" /> Фильтры</summary>
        <div className="mt-4">{body}</div>
      </details>
      <aside className="hidden lg:block" aria-label="Фильтры">{body}</aside>
    </>
  );
}

export function SortSelect({ options }: { options: Record<string, string> }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">Сортировка</span>
      <select
        value={sp.get("sort") ?? "popular"}
        onChange={(e) => {
          const p = new URLSearchParams(sp.toString());
          p.set("sort", e.target.value);
          p.delete("page");
          router.push(`${path}?${p}`, { scroll: false });
        }}
        className="h-10 rounded-full border bg-background px-4 text-sm"
      >
        {Object.entries(options).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
    </label>
  );
}
