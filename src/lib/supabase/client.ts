import { createBrowserClient } from "@supabase/ssr";
import { supabaseAnonKey, supabaseUrl } from "./env";

/** Браузерный клиент: только anon key, доступ ограничен RLS. */
export function createClient() {
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
