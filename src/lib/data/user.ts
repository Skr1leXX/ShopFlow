import "server-only";
import { createClient } from "@/lib/supabase/server";
import { CARD } from "./catalog";
import type { Address, CartLine, Order, Product } from "./types";

// Все запросы идут от имени пользователя: RLS отдаёт только его корзину, избранное, адреса и заказы.

export async function getCart(): Promise<CartLine[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cart_items")
    .select(`id, quantity, variant:product_variants(id,sku,size,color,color_hex,is_active,inventory(quantity), products(${CARD}))`)
    .order("id");
  if (error) throw new Error(error.message);
  return (data as unknown as CartLine[]).filter((l) => l.variant?.is_active && l.variant.products?.is_active);
}

export async function getCartCount() {
  const supabase = await createClient();
  const { data } = await supabase.from("cart_items").select("quantity");
  return (data ?? []).reduce((s, r) => s + r.quantity, 0);
}

export async function getFavoriteIds(): Promise<Set<string>> {
  const supabase = await createClient();
  const { data } = await supabase.from("favorites").select("product_id");
  return new Set((data ?? []).map((r) => r.product_id));
}

export async function getFavoriteProducts(): Promise<Product[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("favorites")
    .select(`created_at, product:products(${CARD})`)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as unknown as { product: Product | null }[]).map((r) => r.product).filter((p): p is Product => !!p?.is_active);
}

export async function getAddresses(): Promise<Address[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("addresses")
    .select("*")
    .order("is_default", { ascending: false })
    .order("created_at");
  if (error) throw new Error(error.message);
  return data as Address[];
}

export async function getMyOrders(): Promise<Order[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("orders").select("*, order_items(*)").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data as unknown as Order[];
}

export async function getOrder(id: string): Promise<Order | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("orders").select("*, order_items(*)").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data as unknown as Order | null;
}
