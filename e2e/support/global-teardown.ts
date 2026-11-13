import fs from "node:fs";
import { admin } from "./db";
import { STATE_FILE, hasBackend, type State } from "./env";

/** Удаляет всё, что создали тесты: заказы, пользователей (включая зарегистрированных в тесте), товары, категории, промокод. */
export default async function globalTeardown() {
  if (!hasBackend || !fs.existsSync(STATE_FILE)) return;
  const s: State = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  const db = admin();

  const { data: users } = await db.auth.admin.listUsers({ perPage: 1000 });
  const mine = (users?.users ?? []).filter((u) => u.email?.includes(`-${s.run}@shopflow.test`) || u.email?.startsWith(`e2e-reg-${s.run}`));
  for (const u of mine) await db.from("orders").delete().eq("user_id", u.id); // orders.user_id: on delete restrict
  for (const u of mine) await db.auth.admin.deleteUser(u.id);

  await db.from("promo_codes").delete().like("code", `E2E%`);
  const { data: prods } = await db.from("products").select("id").like("slug", `%${s.run}`);
  const ids = (prods ?? []).map((p) => p.id);
  if (ids.length) {
    const { data: imgs } = await db.from("product_images").select("storage_path").in("product_id", ids).not("storage_path", "is", null);
    const paths = (imgs ?? []).map((i) => i.storage_path as string);
    if (paths.length) await db.storage.from("product-images").remove(paths);
    await db.from("order_items").update({ variant_id: null, product_id: null }).in("product_id", ids);
    await db.from("products").delete().in("id", ids);
  }
  await db.from("categories").delete().like("slug", `e2e-%${s.run}%`);
  fs.rmSync(STATE_FILE);
}
