import { ProductGridSkeleton, Skeleton } from "@/components/common/states";

export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <Skeleton className="mb-8 h-12 w-64" />
      <ProductGridSkeleton />
    </div>
  );
}
