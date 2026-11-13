-- Защита оформления заказа от повторных запросов (двойной клик, повтор после обрыва сети).
-- Клиент генерирует ключ один раз на форму; повтор с тем же ключом возвращает уже созданный заказ.

alter table public.orders add column idempotency_key uuid;
create unique index orders_idempotency_idx on public.orders (user_id, idempotency_key) where idempotency_key is not null;

drop function public.place_order(text, text, text, public.delivery_method, public.payment_method, jsonb, text, text);

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

  -- Условие quantity >= ... в update страхует от списания в минус даже при обходе проверки выше (check >= 0 тоже).
  update public.inventory i set quantity = i.quantity - ci.quantity
    from public.cart_items ci
    where ci.cart_id = v_cart and i.variant_id = ci.variant_id and i.quantity >= ci.quantity;
  get diagnostics v_rows = row_count;
  if v_rows <> (select count(*) from public.cart_items where cart_id = v_cart) then
    raise exception 'Не удалось зарезервировать товар, повторите попытку';
  end if;

  if v_promo is not null then
    update public.promo_codes set used_count = used_count + 1 where id = v_promo;
  end if;

  -- Корзина очищается в той же транзакции: при любой ошибке выше она остаётся нетронутой.
  delete from public.cart_items where cart_id = v_cart;
  return v_order;
end $$;
revoke all on function public.place_order(text, text, text, public.delivery_method, public.payment_method, jsonb, text, text, uuid) from public, anon;
grant execute on function public.place_order(text, text, text, public.delivery_method, public.payment_method, jsonb, text, text, uuid) to authenticated;
