import { BizError, nowIso, one, type Q } from "./db.ts";

export type StockReason = "receipt" | "writeoff" | "adjustment" | "sale" | "return";

/**
 * Единственное место, где меняется остаток. Остаток и запись в журнал пишутся вместе (вызывать внутри транзакции),
 * остаток не уходит в минус: условие в update и check в таблице.
 */
export async function changeStock(
  q: Q, variantId: string, delta: number, reason: StockReason,
  opts: { note?: string; orderId?: string | null; userId?: string | null } = {},
): Promise<number> {
  if (delta === 0) return (await one<{ quantity: number }>(q, "select quantity from inventory where variant_id = ?", [variantId]))?.quantity ?? 0;
  await q.execute({ sql: "insert or ignore into inventory (variant_id, quantity) values (?, 0)", args: [variantId] });
  const res = await q.execute({
    sql: "update inventory set quantity = quantity + ?, updated_at = ? where variant_id = ? and quantity + ? >= 0",
    args: [delta, nowIso(), variantId, delta],
  });
  if (res.rowsAffected === 0) throw new BizError("Недостаточно товара на складе");
  const balance = (await one<{ quantity: number }>(q, "select quantity from inventory where variant_id = ?", [variantId]))!.quantity;
  await q.execute({
    sql: "insert into inventory_movements (id, variant_id, delta, balance, reason, note, order_id, created_by, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    args: [crypto.randomUUID(), variantId, delta, balance, reason, opts.note ?? "", opts.orderId ?? null, opts.userId ?? null, nowIso()],
  });
  return balance;
}
