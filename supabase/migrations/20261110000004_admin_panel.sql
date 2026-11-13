-- Админ-панель: журнал движения склада, безопасные переходы статусов заказа, аналитика для Dashboard.

-- ───────── журнал движения склада ─────────
create table public.inventory_movements (
  id         uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.product_variants (id) on delete cascade,
  delta      int not null check (delta <> 0),
  balance    int not null check (balance >= 0),          -- остаток после операции
  reason     text not null check (reason in ('receipt', 'writeoff', 'adjustment', 'sale', 'return')),
  note       text not null default '',
  order_id   uuid references public.orders (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index inventory_movements_variant_idx on public.inventory_movements (variant_id, created_at desc);
create index inventory_movements_created_idx on public.inventory_movements (created_at desc);
alter table public.inventory_movements enable row level security;
create policy movements_admin_read on public.inventory_movements for select to authenticated using (public.is_admin());
-- INSERT/UPDATE/DELETE политик нет: журнал пишет только триггер, подделать его нельзя.

-- Любое изменение остатка (продажа, возврат, приход, правка) попадает в журнал.
create function public.log_inventory_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_delta int := new.quantity - coalesce(old.quantity, 0);
  v_reason text := coalesce(nullif(current_setting('app.stock_reason', true), ''), 'adjustment');
begin
  if v_delta = 0 then return new; end if;
  insert into public.inventory_movements (variant_id, delta, balance, reason, note, order_id, created_by)
  values (new.variant_id, v_delta, new.quantity, v_reason,
          coalesce(current_setting('app.stock_note', true), ''),
          nullif(current_setting('app.stock_order', true), '')::uuid,
          (select auth.uid()));
  return new;
end $$;
revoke all on function public.log_inventory_change() from public, anon, authenticated;
create trigger inventory_log after insert or update of quantity on public.inventory
  for each row execute function public.log_inventory_change();

-- Приход / списание / корректировка одной атомарной операцией. Остаток не уходит в минус.
create function public.adjust_stock(p_variant uuid, p_delta int, p_reason text, p_note text default '')
returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_new int;
begin
  if not public.is_admin() then raise exception 'Доступ запрещён' using errcode = '42501'; end if;
  if p_reason not in ('receipt', 'writeoff', 'adjustment') then raise exception 'Неверная причина операции'; end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 100000 then raise exception 'Количество должно быть ненулевым, до 100000'; end if;
  if p_reason = 'receipt' and p_delta < 0 then raise exception 'Приход должен быть положительным'; end if;
  if p_reason = 'writeoff' and p_delta > 0 then raise exception 'Списание должно быть отрицательным'; end if;
  if not exists (select 1 from public.product_variants where id = p_variant) then raise exception 'Вариант не найден'; end if;

  insert into public.inventory (variant_id, quantity) values (p_variant, 0) on conflict do nothing;
  perform set_config('app.stock_reason', p_reason, true);
  perform set_config('app.stock_note', left(coalesce(p_note, ''), 200), true);
  update public.inventory set quantity = quantity + p_delta where variant_id = p_variant and quantity + p_delta >= 0
    returning quantity into v_new;
  perform set_config('app.stock_reason', '', true);
  perform set_config('app.stock_note', '', true);
  if v_new is null then raise exception 'Недостаточно товара на складе для списания'; end if;
  return v_new;
end $$;
revoke all on function public.adjust_stock(uuid, int, text, text) from public, anon;
grant execute on function public.adjust_stock(uuid, int, text, text) to authenticated;

-- ───────── статусы заказа ─────────
-- «Отменён» и «доставлен» — конечные статусы. Это защищает склад от двойного возврата.
create function public.guard_order_status() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = old.status then return new; end if;
  if old.status in ('cancelled', 'delivered') then
    raise exception 'Заказ в этом статусе изменить нельзя';
  end if;
  if new.status = 'cancelled' and old.status = 'shipped' then
    raise exception 'Отправленный заказ нельзя отменить';
  end if;
  return new;
end $$;
create trigger orders_status_guard before update of status on public.orders
  for each row execute function public.guard_order_status();

-- Отмена: товар возвращается на склад (с записью в журнал), использование промокода уменьшается.
create or replace function public.restock_on_cancel() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    perform set_config('app.stock_reason', 'return', true);
    perform set_config('app.stock_order', new.id::text, true);
    update public.inventory i set quantity = i.quantity + oi.quantity
      from public.order_items oi where oi.order_id = new.id and oi.variant_id = i.variant_id;
    perform set_config('app.stock_reason', '', true);
    perform set_config('app.stock_order', '', true);
    if new.promo_code_id is not null then
      update public.promo_codes set used_count = greatest(used_count - 1, 0) where id = new.promo_code_id;
    end if;
  end if;
  return new;
end $$;

-- place_order: как в миграции 3, плюс причина «продажа» для журнала склада.
drop function public.place_order(text, text, text, public.delivery_method, public.payment_method, jsonb, text, text, uuid);
create function public.place_order(
  p_name text, p_email text, p_phone text,
  p_delivery public.delivery_method, p_payment public.payment_method,
  p_address jsonb, p_comment text default '', p_promo text default null,
  p_key uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_cart uuid;
  v_sub numeric;
  v_promo uuid;
  v_disc numeric;
  v_ship numeric;
  v_order uuid;
  v_rows int;
  r record;
begin
  if v_uid is null then raise exception 'Требуется вход' using errcode = '28000'; end if;

  -- Заказы одного пользователя оформляются строго по очереди: параллельный повтор ждёт и увидит результат первого.
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));
  if p_key is not null then
    select id into v_order from public.orders where user_id = v_uid and idempotency_key = p_key;
    if found then return v_order; end if;
  end if;

  if coalesce(btrim(p_name), '') = '' or coalesce(btrim(p_phone), '') = '' or coalesce(btrim(p_email), '') = '' then
    raise exception 'Заполните контактные данные';
  end if;
  if p_delivery <> 'pickup' and (p_address is null or coalesce(p_address ->> 'city', '') = ''
                                 or coalesce(p_address ->> 'street', '') = '') then
    raise exception 'Укажите адрес доставки';
  end if;

  select id into v_cart from public.carts where user_id = v_uid;
  if v_cart is null then raise exception 'Корзина пуста'; end if;

  -- Блокируем остатки позиций корзины: два разных пользователя не купят один и тот же последний товар.
  perform 1 from public.inventory i
    join public.cart_items ci on ci.variant_id = i.variant_id and ci.cart_id = v_cart
    for update of i;

  select coalesce(sum(p.price * ci.quantity), 0) into v_sub
    from public.cart_items ci
    join public.product_variants pv on pv.id = ci.variant_id and pv.is_active
    join public.products p on p.id = pv.product_id and p.is_active
    where ci.cart_id = v_cart;
  if v_sub = 0 then raise exception 'Корзина пуста'; end if;

  -- Неактивные варианты и скрытые товары заказать нельзя, даже если они остались в корзине.
  if exists (
    select 1 from public.cart_items ci
    join public.product_variants pv on pv.id = ci.variant_id
    join public.products p on p.id = pv.product_id
    where ci.cart_id = v_cart and not (pv.is_active and p.is_active)
  ) then raise exception 'В корзине есть товары, недоступные для заказа. Удалите их и повторите.'; end if;

  for r in
    select ci.quantity, coalesce(i.quantity, 0) as stock, p.name, pv.size, pv.color
    from public.cart_items ci
    join public.product_variants pv on pv.id = ci.variant_id
    join public.products p on p.id = pv.product_id
    left join public.inventory i on i.variant_id = pv.id
    where ci.cart_id = v_cart
  loop
    if r.stock < r.quantity then
      raise exception 'Недостаточно товара на складе: % (%, %), доступно %', r.name, r.size, r.color, r.stock;
    end if;
  end loop;

  select a.promo_id, a.discount into v_promo, v_disc from public.apply_promo(p_promo, v_sub) a;
  v_ship := public.shipping_cost(p_delivery, v_sub - v_disc);

  insert into public.orders (user_id, subtotal, discount, shipping, total, promo_code_id,
                             contact_name, contact_email, contact_phone, delivery_method, payment_method,
                             shipping_address, comment, idempotency_key)
  values (v_uid, v_sub, v_disc, v_ship, v_sub - v_disc + v_ship, v_promo,
          left(btrim(p_name), 120), left(btrim(p_email), 160), left(btrim(p_phone), 24),
          p_delivery, p_payment, coalesce(p_address, '{}'::jsonb), left(coalesce(p_comment, ''), 500), p_key)
  returning id into v_order;

  insert into public.order_items (order_id, variant_id, product_id, product_name, size, color, image_url, unit_price, quantity)
  select v_order, pv.id, p.id, p.name, pv.size, pv.color,
         (select pi.url from public.product_images pi where pi.product_id = p.id order by pi.sort_order limit 1),
         p.price, ci.quantity
  from public.cart_items ci
  join public.product_variants pv on pv.id = ci.variant_id
  join public.products p on p.id = pv.product_id
  where ci.cart_id = v_cart;

  perform set_config('app.stock_reason', 'sale', true);
  perform set_config('app.stock_order', v_order::text, true);
  -- Условие quantity >= ... в update страхует от списания в минус даже при обходе проверки выше (check >= 0 тоже).
  update public.inventory i set quantity = i.quantity - ci.quantity
    from public.cart_items ci
    where ci.cart_id = v_cart and i.variant_id = ci.variant_id and i.quantity >= ci.quantity;
  get diagnostics v_rows = row_count;
  if v_rows <> (select count(*) from public.cart_items where cart_id = v_cart) then
    raise exception 'Не удалось зарезервировать товар, повторите попытку';
  end if;

  perform set_config('app.stock_reason', '', true);
  perform set_config('app.stock_order', '', true);

  if v_promo is not null then
    update public.promo_codes set used_count = used_count + 1 where id = v_promo;
  end if;

  -- Корзина очищается в той же транзакции: при любой ошибке выше она остаётся нетронутой.
  delete from public.cart_items where cart_id = v_cart;
  return v_order;
end $$;
revoke all on function public.place_order(text, text, text, public.delivery_method, public.payment_method, jsonb, text, text, uuid) from public, anon;
grant execute on function public.place_order(text, text, text, public.delivery_method, public.payment_method, jsonb, text, text, uuid) to authenticated;

-- ───────── аналитика Dashboard (только админ) ─────────
create function public.admin_sales_by_day(p_days int default 30)
returns table (day date, orders bigint, revenue numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Доступ запрещён' using errcode = '42501'; end if;
  return query
  select d::date, count(o.id), coalesce(sum(o.total), 0)
  from generate_series(current_date - (least(greatest(p_days, 1), 365) - 1), current_date, interval '1 day') d
  left join public.orders o on o.created_at::date = d::date and o.status <> 'cancelled'
  group by d order by d;
end $$;
revoke all on function public.admin_sales_by_day(int) from public, anon;
grant execute on function public.admin_sales_by_day(int) to authenticated;

create function public.admin_top_products(p_limit int default 5)
returns table (product_id uuid, name text, units bigint, revenue numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Доступ запрещён' using errcode = '42501'; end if;
  return query
  select oi.product_id, max(oi.product_name), sum(oi.quantity)::bigint, sum(oi.unit_price * oi.quantity)
  from public.order_items oi join public.orders o on o.id = oi.order_id and o.status <> 'cancelled'
  group by oi.product_id order by 3 desc, 4 desc limit least(greatest(p_limit, 1), 50);
end $$;
revoke all on function public.admin_top_products(int) from public, anon;
grant execute on function public.admin_top_products(int) to authenticated;
