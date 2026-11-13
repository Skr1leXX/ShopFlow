import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import fs from "node:fs";
import { PASSWORD, STATE_FILE, type State } from "./env";

// Сервисный ключ используется только в тестовом процессе для подготовки и проверки данных. В приложение он не попадает.
export const admin = (): SupabaseClient =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

export const readState = (): State => JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));

export async function createUser(db: SupabaseClient, email: string, name: string, role: "customer" | "admin" = "customer") {
  const { data, error } = await db.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: name } });
  if (error) throw error;
  if (role === "admin") await db.from("profiles").update({ role }).eq("id", data.user.id).throwOnError();
  return { id: data.user.id, email };
}

/** Остаток варианта напрямую из БД. */
export async function stockOf(variantId: string) {
  const { data } = await admin().from("inventory").select("quantity").eq("variant_id", variantId).single();
  return data!.quantity as number;
}

export async function setStockDirect(variantId: string, quantity: number) {
  await admin().from("inventory").update({ quantity }).eq("variant_id", variantId).throwOnError();
}

export async function ordersOf(userId: string) {
  const { data } = await admin().from("orders").select("id,number,status,total,discount").eq("user_id", userId).order("created_at");
  return data ?? [];
}

export async function resetCustomerData(userId: string) {
  const db = admin();
  await db.from("orders").delete().eq("user_id", userId);
  const { data: cart } = await db.from("carts").select("id").eq("user_id", userId).maybeSingle();
  if (cart) await db.from("cart_items").delete().eq("cart_id", cart.id);
  await db.from("favorites").delete().eq("user_id", userId);
}
