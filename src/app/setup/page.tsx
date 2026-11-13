import { SetupNotice } from "@/components/common/states";

export const metadata = { title: "Настройка Supabase", robots: { index: false } };

export default function SetupPage() {
  return (
    <main className="flex-1">
      <SetupNotice />
    </main>
  );
}
