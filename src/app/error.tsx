"use client";

import { Button } from "@/components/ui/button";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="grid flex-1 place-items-center px-4 py-24 text-center">
      <div>
        <h1 className="text-5xl font-semibold">Что-то пошло не так</h1>
        <p className="mx-auto mt-3 max-w-md text-muted-foreground">Не удалось загрузить страницу. Проверьте подключение и попробуйте ещё раз.</p>
        <Button className="mt-8" size="lg" onClick={reset}>Повторить</Button>
      </div>
    </main>
  );
}
