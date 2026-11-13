"use client";

import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { useServerAction } from "@/components/common/form";
import { deleteAddress } from "@/lib/actions/shop";

export function DeleteAddress({ id }: { id: string }) {
  const router = useRouter();
  const { pending, run } = useServerAction();
  return (
    <button
      type="button" disabled={pending} aria-label="Удалить адрес"
      onClick={() => run(() => deleteAddress(id), () => router.refresh())}
      className="text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
    >
      <Trash2 className="size-4" />
    </button>
  );
}
