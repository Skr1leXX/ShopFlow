import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="grid flex-1 place-items-center px-4 py-24 text-center">
      <div>
        <p className="text-sm uppercase tracking-widest text-muted-foreground">404</p>
        <h1 className="mt-2 text-5xl font-semibold">Страница не найдена</h1>
        <p className="mx-auto mt-3 max-w-md text-muted-foreground">Возможно, товар скрыт или ссылка устарела.</p>
        <Link href="/catalog" className={`${buttonVariants({ size: "lg" })} mt-8`}>В каталог</Link>
      </div>
    </main>
  );
}
