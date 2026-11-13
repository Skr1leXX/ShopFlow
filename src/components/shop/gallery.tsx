"use client";

import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { ProductImage } from "@/lib/data/types";

export function Gallery({ images, name }: { images: ProductImage[]; name: string }) {
  const [i, setI] = useState(0);
  if (!images.length) return <div className="grid aspect-[4/5] place-items-center rounded-3xl bg-muted text-sm text-muted-foreground">Нет фото</div>;
  return (
    <div className="grid gap-3 sm:grid-cols-[84px_1fr]">
      <div className="order-2 flex gap-3 sm:order-1 sm:flex-col">
        {images.map((img, k) => (
          <button key={img.id} type="button" onClick={() => setI(k)} aria-label={`Фото ${k + 1}`} aria-current={k === i}
            className={cn("relative aspect-[4/5] w-20 overflow-hidden rounded-xl bg-muted ring-offset-2 transition sm:w-full", k === i ? "ring-2 ring-foreground" : "opacity-70 hover:opacity-100")}>
            <Image src={img.url} alt="" fill sizes="84px" className="object-cover" />
          </button>
        ))}
      </div>
      <div className="relative order-1 aspect-[4/5] overflow-hidden rounded-3xl bg-muted sm:order-2">
        <Image key={images[i].id} src={images[i].url} alt={images[i].alt || name} fill priority sizes="(min-width: 1024px) 50vw, 100vw" className="animate-in fade-in object-cover duration-500" />
      </div>
    </div>
  );
}
