import { NextResponse, type NextRequest } from "next/server";
import { getProfile } from "@/lib/auth";
import { listAdminOrders, listAdminProducts } from "@/lib/data/admin";
import { toCsv } from "@/lib/csv";
import { DELIVERY, ORDER_STATUS, PAYMENT } from "@/lib/format";

const iso = (s: string) => s.slice(0, 19).replace("T", " ");

/** CSV-экспорт. Роль проверяется здесь же: прямой запрос по ссылке без прав получает 403. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const profile = await getProfile();
  if (!profile) return new NextResponse("Требуется вход", { status: 401 });
  if (profile.role !== "admin") return new NextResponse("Доступ запрещён", { status: 403 });

  const { kind } = await params;
  const sp = request.nextUrl.searchParams;
  let body: string;

  if (kind === "products") {
    const products = await listAdminProducts({
      q: sp.get("q") ?? "", category: sp.get("category") ?? "", status: sp.get("status") ?? "", stock: sp.get("stock") ?? "", sort: sp.get("sort") ?? "",
    });
    body = toCsv(
      ["Название", "Slug", "Бренд", "Категория", "Цена", "Старая цена", "Вариантов", "Остаток", "Активен", "Новинка", "Рекомендуемый", "Создан"],
      products.map((p) => [p.name, p.slug, p.brand, p.categories?.name, p.price, p.old_price, p.variant_count, p.total_stock, p.is_active ? "да" : "нет", p.is_new ? "да" : "нет", p.is_featured ? "да" : "нет", iso(p.created_at)]),
    );
  } else if (kind === "orders") {
    const orders = await listAdminOrders({ q: sp.get("q") ?? "", status: sp.get("status") ?? "all" });
    body = toCsv(
      ["Номер", "Дата", "Статус", "Покупатель", "Email", "Телефон", "Доставка", "Адрес", "Оплата", "Товары", "Скидка", "Доставка, ₽", "Итого", "Состав"],
      orders.map((o) => [
        o.number, iso(o.created_at), ORDER_STATUS[o.status] ?? o.status, o.contact_name, o.contact_email, o.contact_phone,
        DELIVERY[o.delivery_method], o.shipping_address?.city ? `${o.shipping_address.postal_code}, ${o.shipping_address.city}, ${o.shipping_address.street}` : "",
        PAYMENT[o.payment_method], o.subtotal, o.discount, o.shipping, o.total,
        (o.order_items ?? []).map((i) => `${i.product_name} (${i.color}, ${i.size}) × ${i.quantity}`).join(" | "),
      ]),
    );
  } else {
    return new NextResponse("Неизвестный тип экспорта", { status: 404 });
  }

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${kind}-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
