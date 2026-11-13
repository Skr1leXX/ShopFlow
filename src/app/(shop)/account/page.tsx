import type { Metadata } from "next";
import { PageHeader } from "@/components/common/states";
import { ActionForm } from "@/components/common/form";
import { requireUser } from "@/lib/auth";
import { updateProfile } from "@/lib/actions/shop";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Профиль" };
const field = "h-11 w-full rounded-xl border bg-background px-4 text-sm";

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const [profile, { denied }] = await Promise.all([requireUser(), searchParams]);
  return (
    <>
      <PageHeader title="Профиль" text={`Аккаунт создан ${formatDate(profile.created_at)}`} />
      {denied && <p role="alert" className="mb-6 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">У вас нет доступа к админ-панели.</p>}
      <ActionForm action={updateProfile} submit="Сохранить" className="max-w-lg">
        <label className="block space-y-1.5 text-sm">
          <span className="text-muted-foreground">Email</span>
          <input value={profile.email} disabled className={`${field} bg-muted`} />
        </label>
        <label className="block space-y-1.5 text-sm">
          <span className="text-muted-foreground">Имя и фамилия</span>
          <input name="full_name" required defaultValue={profile.full_name} className={field} />
        </label>
        <label className="block space-y-1.5 text-sm">
          <span className="text-muted-foreground">Телефон</span>
          <input name="phone" type="tel" defaultValue={profile.phone ?? ""} className={field} />
        </label>
      </ActionForm>
    </>
  );
}
