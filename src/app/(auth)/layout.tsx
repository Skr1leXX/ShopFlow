import { Logo } from "@/components/layout/header";
import { SetupNotice } from "@/components/common/states";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid flex-1 place-items-center bg-muted/50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center"><Logo /></div>
        <div className="rounded-3xl border bg-background p-6 shadow-sm sm:p-8">
          {isSupabaseConfigured ? children : <SetupNotice />}
        </div>
      </div>
    </main>
  );
}
