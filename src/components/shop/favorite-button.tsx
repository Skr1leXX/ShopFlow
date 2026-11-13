"use client";

import { useOptimistic, useTransition } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Heart } from "lucide-react";
import { toggleFavorite } from "@/lib/actions/shop";
import { cn } from "@/lib/utils";

export function FavoriteButton({ productId, initial, className }: { productId: string; initial: boolean; className?: string }) {
  const [active, setActive] = useOptimistic(initial, (_, next: boolean) => next);
  const [, start] = useTransition();
  const path = usePathname();
  const qs = useSearchParams().toString();
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={active ? "Убрать из избранного" : "Добавить в избранное"}
      onClick={() => start(async () => {
        setActive(!active);
        // При сбое оптимистичное значение откатится само по завершении перехода.
        await toggleFavorite(productId, qs ? `${path}?${qs}` : path).catch(() => undefined);
      })}
      className={cn("grid size-9 place-items-center rounded-full bg-background/90 shadow-sm backdrop-blur transition hover:scale-110", className)}
    >
      <Heart className={cn("size-[18px] transition-colors", active && "fill-destructive text-destructive")} />
    </button>
  );
}
