import fs from "node:fs";
import { sqlRows, sqlRun } from "./db";
import { STATE_FILE, hasBackend, type State } from "./env";

/** Удаляет всё, что создали тесты: заказы, пользователей (включая зарегистрированных в тесте), товары, категории, промокод. */
export default async function globalTeardown() {
  if (!hasBackend || !fs.existsSync(STATE_FILE)) return;
  const s: State = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  const users = await sqlRows<{ id: string }>("select id from profiles where email like ? or email like ?", [`%-${s.run}@shopflow.test`, `e2e-reg-${s.run}%`]);
  for (const u of users) {
    await sqlRun("delete from orders where user_id = ?", [u.id]);
    for (const t of ["cart_items", "favorites", "addresses", "sessions"]) await sqlRun(`delete from ${t} where user_id = ?`, [u.id]);
    await sqlRun("delete from profiles where id = ?", [u.id]);
  }
  await sqlRun("update orders set promo_code_id = null where promo_code_id in (select id from promo_codes where code like 'E2E%')");
  await sqlRun("delete from promo_codes where code like 'E2E%'");
  const prods = (await sqlRows<{ id: string }>("select id from products where slug like ?", [`%${s.run}`])).map((p) => p.id);
  for (const id of prods) {
    const v = "(select id from product_variants where product_id = ?)";
    for (const sql of [
      `update order_items set variant_id = null where variant_id in ${v}`, `delete from cart_items where variant_id in ${v}`,
      `delete from inventory_movements where variant_id in ${v}`, `delete from inventory where variant_id in ${v}`,
      "delete from product_variants where product_id = ?", "update order_items set product_id = null where product_id = ?",
      "delete from product_images where product_id = ?", "delete from favorites where product_id = ?", "delete from products where id = ?",
    ]) await sqlRun(sql, [id]);
  }
  await sqlRun("delete from categories where slug like ?", [`e2e-%${s.run}%`]);
  fs.rmSync(STATE_FILE);
}
