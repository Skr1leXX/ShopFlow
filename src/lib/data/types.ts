export type Role = "customer" | "admin";

export type Category = { id: string; slug: string; name: string; description: string; image_url: string | null; sort_order: number; is_active: boolean };
export type ProductImage = { id: string; url: string; storage_path: string | null; alt: string; sort_order: number };
export type Variant = { id: string; sku: string; size: string; color: string; color_hex: string; is_active: boolean; inventory: { quantity: number } | null };

export type Product = {
  id: string; slug: string; name: string; brand: string; description: string;
  details: Record<string, string>; category_id: string; price: number; old_price: number | null;
  is_featured: boolean; is_new: boolean; is_active: boolean; created_at: string;
  product_images: ProductImage[];
  categories?: { name: string; slug: string } | null;
  stock?: { is_active: boolean; inventory: { quantity: number } | null }[];
};

/** Есть ли у товара хотя бы один доступный вариант. Без данных о складе считаем, что есть. */
export const isInStock = (p: Product) => !p.stock || p.stock.some((v) => v.is_active && (v.inventory?.quantity ?? 0) > 0);
export type ProductFull = Product & { product_variants: Variant[] };

export type Profile = { id: string; email: string; full_name: string; phone: string | null; role: Role; created_at: string };
export type Address = { id: string; label: string; recipient: string; phone: string; city: string; street: string; postal_code: string; is_default: boolean };

export type OrderItem = { id: string; product_id: string | null; product_name: string; size: string; color: string; image_url: string | null; unit_price: number; quantity: number };
export type Order = {
  id: string; number: number; status: string; subtotal: number; discount: number; shipping: number; total: number;
  contact_name: string; contact_email: string; contact_phone: string; delivery_method: string; payment_method: string;
  shipping_address: Record<string, string>; created_at: string; order_items?: OrderItem[];
};
export type PromoCode = { id: string; code: string; description: string; discount_percent: number | null; discount_amount: number | null; min_order_total: number; max_uses: number | null; used_count: number; expires_at: string | null; is_active: boolean };
export type CartLine = { id: string; quantity: number; variant: Variant & { products: Product } };
