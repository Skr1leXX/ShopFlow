-- ShopFlow: роли, RLS, триггеры и RPC оформления заказа.
-- Принцип: клиент (anon/authenticated) не может писать в orders/order_items/promo_codes напрямую.
-- Заказ создаётся только функцией place_order(), цены берутся из БД, а не от клиента.

-- ───────── роль администратора ─────────
-- security definer + пустой search_path: функция читает profiles в обход RLS (иначе рекурсия политик).
create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'
  );
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- Новый пользователь из auth.users -> профиль customer + пустая корзина.
-- Роль берётся только по умолчанию: raw_user_meta_data из регистрации игнорируется.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, coalesce(new.email, ''), left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 120));
  insert into public.carts (user_id) values (new.id);
  return new;
end $$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Запрет самоповышения: менять role может только админ или серверный контекст (миграции, service_role).
create function public.guard_profile_update() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.role is distinct from old.role
     and current_user in ('authenticated', 'anon')
     and not public.is_admin() then
    raise exception 'Изменение роли запрещено' using errcode = '42501';
  end if;
  if new.id <> old.id then
    raise exception 'Изменение id запрещено' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

-- ───────── включаем RLS на всех таблицах ─────────
alter table public.profiles         enable row level security;
alter table public.categories       enable row level security;
alter table public.products         enable row level security;
alter table public.product_images   enable row level security;
alter table public.product_variants enable row level security;
alter table public.inventory        enable row level security;
alter table public.addresses        enable row level security;
alter table public.carts            enable row level security;
alter table public.cart_items       enable row level security;
alter table public.favorites        enable row level security;
alter table public.promo_codes      enable row level security;
alter table public.orders           enable row level security;
alter table public.order_items      enable row level security;

-- profiles: видишь и правишь свой, админ — все. Вставка — только триггером, удаление — каскадом из auth.users.
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.is_admin());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy profiles_update_admin on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- каталог: публичное чтение активного, запись — только админ
create policy categories_read on public.categories for select to anon, authenticated
  using (is_active or public.is_admin());
create policy categories_admin on public.categories for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy products_read on public.products for select to anon, authenticated
  using (is_active or public.is_admin());
create policy products_admin on public.products for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy product_images_read on public.product_images for select to anon, authenticated
  using (exists (select 1 from public.products p where p.id = product_id and (p.is_active or public.is_admin())));
create policy product_images_admin on public.product_images for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy variants_read on public.product_variants for select to anon, authenticated
  using (exists (select 1 from public.products p where p.id = product_id and (p.is_active or public.is_admin())));
create policy variants_admin on public.product_variants for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy inventory_read on public.inventory for select to anon, authenticated using (true);
create policy inventory_admin on public.inventory for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- адреса, избранное: только владелец (админ видит адреса для обработки заказов)
create policy addresses_own on public.addresses for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy addresses_admin_read on public.addresses for select to authenticated
  using (public.is_admin());

create policy favorites_own on public.favorites for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- корзины: только владелец
create policy carts_own on public.carts for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy cart_items_own on public.cart_items for all to authenticated
  using (exists (select 1 from public.carts c where c.id = cart_id and c.user_id = (select auth.uid())))
  with check (exists (select 1 from public.carts c where c.id = cart_id and c.user_id = (select auth.uid())));

-- промокоды: прямой доступ только админу (покупатель проверяет код через quote_order)
create policy promo_admin on public.promo_codes for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- заказы: покупатель читает свои; менять статус может только админ; INSERT/DELETE политик нет => запрещено
create policy orders_select on public.orders for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());
create policy orders_update_admin on public.orders for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy order_items_select on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o
                 where o.id = order_id and (o.user_id = (select auth.uid()) or public.is_admin())));

-- ───────── расчёт заказа ─────────
-- Единственное место, где считаются доставка и скидка. Фронт показывает то, что вернула эта функция.
create function public.shipping_cost(p_method public.delivery_method, p_subtotal numeric) returns numeric
language sql immutable set search_path = '' as $$
  select case
    when p_method = 'pickup' then 0
    when p_subtotal >= 15000 then 0
    when p_method = 'courier' then 490
    else 290
  end::numeric;
$$;

-- Скидка по промокоду; бросает исключение с понятным текстом, если код не подходит.
create function public.apply_promo(p_code text, p_subtotal numeric,
                                   out promo_id uuid, out discount numeric)
language plpgsql security definer set search_path = '' as $$
declare
  v public.promo_codes;
begin
  if p_code is null or btrim(p_code) = '' then
    promo_id := null; discount := 0; return;
  end if;
  select * into v from public.promo_codes where code = upper(btrim(p_code))
    for update of promo_codes;
  if not found or not v.is_active then raise exception 'Промокод не найден'; end if;
  if v.expires_at is not null and v.expires_at < now() then raise exception 'Срок действия промокода истёк'; end if;
  if v.max_uses is not null and v.used_count >= v.max_uses then raise exception 'Промокод уже исчерпан'; end if;
  if p_subtotal < v.min_order_total then
    raise exception 'Минимальная сумма заказа для промокода — % ₽', v.min_order_total;
  end if;
  promo_id := v.id;
  discount := least(p_subtotal,
    case when v.discount_percent is not null then round(p_subtotal * v.discount_percent / 100.0, 2)
         else v.discount_amount end);
end $$;
revoke all on function public.apply_promo(text, numeric) from public, anon, authenticated;

-- Предварительный расчёт корзины текущего пользователя.
create function public.quote_order(p_promo text default null, p_delivery public.delivery_method default 'courier')
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_sub numeric;
  v_promo uuid;
  v_disc numeric;
  v_ship numeric;
begin
  if v_uid is null then raise exception 'Требуется вход' using errcode = '28000'; end if;
  select coalesce(sum(p.price * ci.quantity), 0) into v_sub
    from public.cart_items ci
    join public.carts c on c.id = ci.cart_id and c.user_id = v_uid
    join public.product_variants pv on pv.id = ci.variant_id and pv.is_active
    join public.products p on p.id = pv.product_id and p.is_active;
  select a.promo_id, a.discount into v_promo, v_disc from public.apply_promo(p_promo, v_sub) a;
  v_ship := case when v_sub = 0 then 0 else public.shipping_cost(p_delivery, v_sub - v_disc) end;
  return jsonb_build_object('subtotal', v_sub, 'discount', v_disc, 'shipping', v_ship,
                            'total', v_sub - v_disc + v_ship);
end $$;
revoke all on function public.quote_order(text, public.delivery_method) from public, anon;
grant execute on function public.quote_order(text, public.delivery_method) to authenticated;

-- Оформление заказа: всё в одной транзакции. Цены и остатки берутся из БД.
create function public.place_order(
  p_name text, p_email text, p_phone text,
  p_delivery public.delivery_method, p_payment public.payment_method,
  p_address jsonb, p_comment text default '', p_promo text default null
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
  r record;
begin
  if v_uid is null then raise exception 'Требуется вход' using errcode = '28000'; end if;
  if coalesce(btrim(p_name), '') = '' or coalesce(btrim(p_phone), '') = '' or coalesce(btrim(p_email), '') = '' then
    raise exception 'Заполните контактные данные';
  end if;
  if p_delivery <> 'pickup' and (p_address is null or coalesce(p_address ->> 'city', '') = ''
                                 or coalesce(p_address ->> 'street', '') = '') then
    raise exception 'Укажите адрес доставки';
  end if;

  select id into v_cart from public.carts where user_id = v_uid;
  if v_cart is null then raise exception 'Корзина пуста'; end if;

  -- Блокируем остатки строк корзины, чтобы два заказа не продали один и тот же товар.
  perform 1 from public.inventory i
    join public.cart_items ci on ci.variant_id = i.variant_id and ci.cart_id = v_cart
    for update of i;

  select coalesce(sum(p.price * ci.quantity), 0) into v_sub
    from public.cart_items ci
    join public.product_variants pv on pv.id = ci.variant_id and pv.is_active
    join public.products p on p.id = pv.product_id and p.is_active
    where ci.cart_id = v_cart;
  if v_sub = 0 then raise exception 'Корзина пуста'; end if;

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
                             shipping_address, comment)
  values (v_uid, v_sub, v_disc, v_ship, v_sub - v_disc + v_ship, v_promo,
          left(btrim(p_name), 120), left(btrim(p_email), 160), left(btrim(p_phone), 24),
          p_delivery, p_payment, coalesce(p_address, '{}'::jsonb), left(coalesce(p_comment, ''), 500))
  returning id into v_order;

  insert into public.order_items (order_id, variant_id, product_id, product_name, size, color, image_url, unit_price, quantity)
  select v_order, pv.id, p.id, p.name, pv.size, pv.color,
         (select pi.url from public.product_images pi where pi.product_id = p.id order by pi.sort_order limit 1),
         p.price, ci.quantity
  from public.cart_items ci
  join public.product_variants pv on pv.id = ci.variant_id
  join public.products p on p.id = pv.product_id
  where ci.cart_id = v_cart;

  update public.inventory i set quantity = i.quantity - ci.quantity
    from public.cart_items ci where ci.cart_id = v_cart and i.variant_id = ci.variant_id;

  if v_promo is not null then
    update public.promo_codes set used_count = used_count + 1 where id = v_promo;
  end if;

  delete from public.cart_items where cart_id = v_cart;
  return v_order;
end $$;
revoke all on function public.place_order(text, text, text, public.delivery_method, public.payment_method, jsonb, text, text) from public, anon;
grant execute on function public.place_order(text, text, text, public.delivery_method, public.payment_method, jsonb, text, text) to authenticated;

-- Отмена заказа возвращает товар на склад.
create function public.restock_on_cancel() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    update public.inventory i set quantity = i.quantity + oi.quantity
      from public.order_items oi where oi.order_id = new.id and oi.variant_id = i.variant_id;
  end if;
  return new;
end $$;
revoke all on function public.restock_on_cancel() from public, anon, authenticated;
create trigger orders_restock after update of status on public.orders
  for each row execute function public.restock_on_cancel();

-- ───────── Storage: фото товаров ─────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy product_images_storage_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'product-images');
create policy product_images_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and public.is_admin());
create policy product_images_storage_update on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and public.is_admin())
  with check (bucket_id = 'product-images' and public.is_admin());
create policy product_images_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and public.is_admin());
