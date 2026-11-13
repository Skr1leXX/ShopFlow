-- ShopFlow: полная установка (миграции + демо-каталог). GENERATED: npm run db:bundle. Не править вручную.
-- Выполняйте на ПУСТОМ проекте Supabase один раз.

-- ===== migrations/20261108000001_schema.sql =====
-- ShopFlow: схема данных. Деньги хранятся в numeric(12,2), валюта — рубли.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create type public.user_role as enum ('customer', 'admin');
create type public.order_status as enum ('pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled');
create type public.delivery_method as enum ('courier', 'pickup', 'post');
create type public.payment_method as enum ('card', 'cash', 'invoice');

create function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ───────── profiles ─────────
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text not null default '',
  phone       text,
  role        public.user_role not null default 'customer',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint profiles_phone_len check (phone is null or char_length(phone) between 5 and 24)
);
create trigger profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

-- ───────── каталог ─────────
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name        text not null check (char_length(name) between 1 and 80),
  description text not null default '',
  image_url   text,
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.products (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name        text not null check (char_length(name) between 1 and 160),
  brand       text not null check (char_length(brand) between 1 and 80),
  description text not null default '',
  details     jsonb not null default '{}'::jsonb,       -- характеристики: материал, состав, уход
  category_id uuid not null references public.categories (id) on delete restrict,
  price       numeric(12,2) not null check (price >= 0),
  old_price   numeric(12,2) check (old_price is null or old_price > price),
  is_featured boolean not null default false,
  is_new      boolean not null default false,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger products_updated before update on public.products
  for each row execute function public.set_updated_at();
create index products_category_idx on public.products (category_id) where is_active;
create index products_brand_idx on public.products (brand);
create index products_price_idx on public.products (price);
create index products_created_idx on public.products (created_at desc);
create index products_name_trgm_idx on public.products using gin (name gin_trgm_ops);

create table public.product_images (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references public.products (id) on delete cascade,
  url          text not null,
  storage_path text,                       -- заполнено, если файл лежит в Storage (bucket product-images)
  alt          text not null default '',
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);
create index product_images_product_idx on public.product_images (product_id, sort_order);

create table public.product_variants (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  sku        text not null unique,
  size       text not null,
  color      text not null,
  color_hex  text not null check (color_hex ~ '^#[0-9a-fA-F]{6}$'),
  is_active  boolean not null default true,
  unique (product_id, size, color)
);
create index product_variants_product_idx on public.product_variants (product_id);

create table public.inventory (
  variant_id uuid primary key references public.product_variants (id) on delete cascade,
  quantity   int not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now()
);
create trigger inventory_updated before update on public.inventory
  for each row execute function public.set_updated_at();

-- ───────── пользовательские данные ─────────
create table public.addresses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  label       text not null default 'Дом',
  recipient   text not null,
  phone       text not null,
  city        text not null,
  street      text not null,
  postal_code text not null,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now()
);
create index addresses_user_idx on public.addresses (user_id);
create unique index addresses_one_default on public.addresses (user_id) where is_default;

create table public.carts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null unique references public.profiles (id) on delete cascade,
  updated_at timestamptz not null default now()
);

create table public.cart_items (
  id         uuid primary key default gen_random_uuid(),
  cart_id    uuid not null references public.carts (id) on delete cascade,
  variant_id uuid not null references public.product_variants (id) on delete cascade,
  quantity   int not null check (quantity between 1 and 99),
  unique (cart_id, variant_id)
);

create table public.favorites (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);
create index favorites_product_idx on public.favorites (product_id);

-- ───────── промокоды и заказы ─────────
create table public.promo_codes (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique check (code = upper(code) and char_length(code) between 3 and 32),
  description      text not null default '',
  discount_percent int check (discount_percent between 1 and 90),
  discount_amount  numeric(12,2) check (discount_amount > 0),
  min_order_total  numeric(12,2) not null default 0 check (min_order_total >= 0),
  max_uses         int check (max_uses > 0),
  used_count       int not null default 0 check (used_count >= 0),
  expires_at       timestamptz,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  constraint promo_one_kind check ((discount_percent is null) <> (discount_amount is null))
);

create sequence public.order_number_seq start 10001;

create table public.orders (
  id               uuid primary key default gen_random_uuid(),
  number           bigint not null unique default nextval('public.order_number_seq'),
  user_id          uuid not null references public.profiles (id) on delete restrict,
  status           public.order_status not null default 'pending',
  subtotal         numeric(12,2) not null check (subtotal >= 0),
  discount         numeric(12,2) not null default 0 check (discount >= 0),
  shipping         numeric(12,2) not null default 0 check (shipping >= 0),
  total            numeric(12,2) not null check (total >= 0),
  promo_code_id    uuid references public.promo_codes (id) on delete set null,
  contact_name     text not null,
  contact_email    text not null,
  contact_phone    text not null,
  delivery_method  public.delivery_method not null,
  payment_method   public.payment_method not null,
  shipping_address jsonb not null,           -- снимок адреса на момент заказа
  comment          text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger orders_updated before update on public.orders
  for each row execute function public.set_updated_at();
create index orders_user_idx on public.orders (user_id, created_at desc);
create index orders_status_idx on public.orders (status);

create table public.order_items (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders (id) on delete cascade,
  variant_id   uuid references public.product_variants (id) on delete set null,
  product_id   uuid references public.products (id) on delete set null,
  product_name text not null,                 -- снимок: товар могут переименовать или удалить
  size         text not null,
  color        text not null,
  image_url    text,
  unit_price   numeric(12,2) not null check (unit_price >= 0),
  quantity     int not null check (quantity > 0)
);
create index order_items_order_idx on public.order_items (order_id);

-- ===== migrations/20261108000002_rls_and_functions.sql =====
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

-- ===== migrations/20261109000003_order_idempotency.sql =====
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

-- ===== migrations/20261110000004_admin_panel.sql =====
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

-- ===== migrations/20261113000005_catalog_facets.sql =====
-- Фасеты каталога одним запросом: раньше приложение выгружало все варианты и цены и считало в JS.
-- security invoker: действует RLS, анонимный пользователь видит только активные товары.
create function public.catalog_facets() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'brands', coalesce((select jsonb_agg(b order by b) from (select distinct brand b from public.products where is_active) x), '[]'),
    'sizes', coalesce((select jsonb_agg(s) from (
        select distinct v.size s from public.product_variants v join public.products p on p.id = v.product_id
        where v.is_active and p.is_active) x), '[]'),
    'colors', coalesce((select jsonb_agg(jsonb_build_object('name', c, 'hex', h) order by c) from (
        select distinct v.color c, v.color_hex h from public.product_variants v join public.products p on p.id = v.product_id
        where v.is_active and p.is_active) x), '[]'),
    'min', coalesce((select floor(min(price)) from public.products where is_active), 0),
    'max', coalesce((select ceil(max(price)) from public.products where is_active), 0)
  );
$$;
revoke all on function public.catalog_facets() from public;
grant execute on function public.catalog_facets() to anon, authenticated;

-- ===== seed.sql =====
-- GENERATED by scripts/gen-seed.mjs. Не править вручную. Повторный запуск безопасен (on conflict do nothing).

insert into public.categories (slug, name, description, image_url, sort_order) values
  ('tshirts', 'Футболки и рубашки', 'Базовые вещи из плотного хлопка и льна.', 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=1200&q=80', 0),
  ('outerwear', 'Верхняя одежда', 'Куртки, пальто и пиджаки на каждый сезон.', 'https://images.unsplash.com/photo-1551028719-00167b16eac5?auto=format&fit=crop&w=1200&q=80', 1),
  ('knitwear', 'Трикотаж', 'Свитеры, худи и кардиганы из мягких материалов.', 'https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?auto=format&fit=crop&w=1200&q=80', 2),
  ('trousers', 'Брюки и джинсы', 'Прямые, зауженные и свободные силуэты.', 'https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?auto=format&fit=crop&w=1200&q=80', 3),
  ('shoes', 'Обувь', 'Кроссовки, ботинки и лоферы.', 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=1200&q=80', 4),
  ('accessories', 'Аксессуары', 'Сумки, часы, очки и мелочи, которые завершают образ.', 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=1200&q=80', 5)
on conflict (slug) do nothing;

insert into public.products (slug, name, brand, description, details, category_id, price, old_price, is_new, is_featured, created_at) values
  ('basic-tee-heavy', 'Футболка Heavy Cotton', 'Northline', 'Плотная футболка свободного кроя из 100% хлопка 220 г/м².', '{"Материал":"100% хлопок","Уход":"Стирка 30°C","Артикул":"SF-001"}'::jsonb, (select id from public.categories where slug = 'tshirts'), 2490, null, false, true, now() - interval '0 days'),
  ('essential-tee-slim', 'Футболка Essential Slim', 'Northline', 'Приталенная футболка из пимы-хлопка с мягкой фактурой.', '{"Материал":"Пима-хлопок","Уход":"Стирка 30°C","Артикул":"SF-002"}'::jsonb, (select id from public.categories where slug = 'tshirts'), 1890, null, true, false, now() - interval '2 days'),
  ('linen-shirt', 'Рубашка Linen Day', 'Atelier 21', 'Лёгкая льняная рубашка прямого кроя для тёплого сезона.', '{"Материал":"100% лён","Уход":"Деликатная стирка","Артикул":"SF-003"}'::jsonb, (select id from public.categories where slug = 'tshirts'), 5290, 6490, false, true, now() - interval '4 days'),
  ('oxford-shirt', 'Рубашка Oxford Classic', 'Atelier 21', 'Классическая оксфордская рубашка с воротником button-down.', '{"Материал":"Хлопок оксфорд","Уход":"Стирка 40°C","Артикул":"SF-004"}'::jsonb, (select id from public.categories where slug = 'tshirts'), 4590, null, false, false, now() - interval '6 days'),
  ('polo-knit', 'Поло Piqué', 'Northline', 'Поло из хлопкового пике с аккуратным воротником.', '{"Материал":"Хлопок пике","Уход":"Стирка 30°C","Артикул":"SF-005"}'::jsonb, (select id from public.categories where slug = 'tshirts'), 3290, null, true, false, now() - interval '8 days'),
  ('long-sleeve', 'Лонгслив Raw', 'Mono Studio', 'Лонгслив с мягкой резинкой на манжетах и чуть удлинённой спинкой.', '{"Материал":"Хлопок с эластаном","Уход":"Стирка 30°C","Артикул":"SF-006"}'::jsonb, (select id from public.categories where slug = 'tshirts'), 2790, 3490, false, false, now() - interval '10 days'),
  ('bomber-core', 'Бомбер Core', 'Northline', 'Лёгкий бомбер с трикотажными манжетами и скрытой молнией.', '{"Материал":"Нейлон, подкладка полиэстер","Уход":"Деликатная стирка","Артикул":"SF-007"}'::jsonb, (select id from public.categories where slug = 'outerwear'), 11900, 14900, false, true, now() - interval '12 days'),
  ('trench-city', 'Тренч City', 'Atelier 21', 'Классический тренч с поясом и водоотталкивающей пропиткой.', '{"Материал":"Хлопок габардин","Уход":"Химчистка","Артикул":"SF-008"}'::jsonb, (select id from public.categories where slug = 'outerwear'), 17900, null, true, true, now() - interval '14 days'),
  ('blazer-soft', 'Пиджак Soft Tailoring', 'Atelier 21', 'Неструктурированный пиджак с мягким плечом.', '{"Материал":"Шерсть 40%, полиэстер 60%","Уход":"Химчистка","Артикул":"SF-009"}'::jsonb, (select id from public.categories where slug = 'outerwear'), 13900, null, false, true, now() - interval '16 days'),
  ('puffer-light', 'Пуховик Light', 'Northline', 'Стёганая куртка с лёгким утеплителем для межсезонья.', '{"Материал":"Нейлон, утеплитель 100 г","Уход":"Деликатная стирка","Артикул":"SF-010"}'::jsonb, (select id from public.categories where slug = 'outerwear'), 15900, 19900, false, false, now() - interval '18 days'),
  ('denim-jacket', 'Джинсовая куртка Rinse', 'Mono Studio', 'Джинсовая куртка прямого кроя из плотного денима.', '{"Материал":"100% хлопок","Уход":"Стирка 30°C","Артикул":"SF-011"}'::jsonb, (select id from public.categories where slug = 'outerwear'), 8900, null, false, false, now() - interval '20 days'),
  ('coat-wool', 'Пальто Wool Long', 'Atelier 21', 'Длинное пальто из шерстяной ткани с потайными пуговицами.', '{"Материал":"Шерсть 70%, кашемир 10%","Уход":"Химчистка","Артикул":"SF-012"}'::jsonb, (select id from public.categories where slug = 'outerwear'), 24900, 29900, false, true, now() - interval '22 days'),
  ('knit-crew', 'Свитер Merino Crew', 'Mono Studio', 'Свитер из мериносовой шерсти тонкой вязки.', '{"Материал":"Мериносовая шерсть","Уход":"Ручная стирка","Артикул":"SF-013"}'::jsonb, (select id from public.categories where slug = 'knitwear'), 6900, null, true, true, now() - interval '24 days'),
  ('hoodie-oversize', 'Худи Oversize', 'Northline', 'Худи свободного кроя из футера с начёсом.', '{"Материал":"Хлопок 80%, полиэстер 20%","Уход":"Стирка 30°C","Артикул":"SF-014"}'::jsonb, (select id from public.categories where slug = 'knitwear'), 5490, 6990, false, true, now() - interval '26 days'),
  ('cardigan-rib', 'Кардиган Rib', 'Mono Studio', 'Кардиган в резинку на крупных пуговицах.', '{"Материал":"Шерсть 50%, акрил 50%","Уход":"Ручная стирка","Артикул":"SF-015"}'::jsonb, (select id from public.categories where slug = 'knitwear'), 7400, null, false, false, now() - interval '28 days'),
  ('turtleneck', 'Водолазка Fine Knit', 'Atelier 21', 'Тонкая водолазка, хорошо носится под пиджак.', '{"Материал":"Вискоза, нейлон","Уход":"Деликатная стирка","Артикул":"SF-016"}'::jsonb, (select id from public.categories where slug = 'knitwear'), 4900, null, true, false, now() - interval '30 days'),
  ('sweatshirt-zip', 'Свитшот на молнии', 'Northline', 'Свитшот с воротником-стойкой и молнией до груди.', '{"Материал":"Хлопок 90%, эластан 10%","Уход":"Стирка 30°C","Артикул":"SF-017"}'::jsonb, (select id from public.categories where slug = 'knitwear'), 5900, null, false, false, now() - interval '32 days'),
  ('jeans-straight', 'Джинсы Straight 01', 'Mono Studio', 'Прямые джинсы средней посадки из плотного денима.', '{"Материал":"100% хлопок","Уход":"Стирка 30°C","Артикул":"SF-018"}'::jsonb, (select id from public.categories where slug = 'trousers'), 6400, null, false, true, now() - interval '34 days'),
  ('chino-slim', 'Чиносы Slim', 'Northline', 'Зауженные чиносы из хлопка с добавлением эластана.', '{"Материал":"Хлопок 97%, эластан 3%","Уход":"Стирка 30°C","Артикул":"SF-019"}'::jsonb, (select id from public.categories where slug = 'trousers'), 4900, 5900, false, false, now() - interval '36 days'),
  ('trousers-pleated', 'Брюки со складками', 'Atelier 21', 'Свободные брюки со складками и высокой посадкой.', '{"Материал":"Шерсть 35%, полиэстер 65%","Уход":"Химчистка","Артикул":"SF-020"}'::jsonb, (select id from public.categories where slug = 'trousers'), 7900, null, true, true, now() - interval '38 days'),
  ('cargo-relaxed', 'Карго Relaxed', 'Mono Studio', 'Свободные карго с боковыми накладными карманами.', '{"Материал":"Хлопок рипстоп","Уход":"Стирка 30°C","Артикул":"SF-021"}'::jsonb, (select id from public.categories where slug = 'trousers'), 5900, null, false, false, now() - interval '40 days'),
  ('joggers-knit', 'Джоггеры Knit', 'Northline', 'Мягкие джоггеры из футера с манжетами.', '{"Материал":"Хлопок 85%, полиэстер 15%","Уход":"Стирка 30°C","Артикул":"SF-022"}'::jsonb, (select id from public.categories where slug = 'trousers'), 4200, 5200, false, false, now() - interval '42 days'),
  ('sneakers-court', 'Кроссовки Court', 'Stride', 'Минималистичные кожаные кроссовки на вулканизированной подошве.', '{"Материал":"Натуральная кожа","Уход":"Протирать влажной тканью","Артикул":"SF-023"}'::jsonb, (select id from public.categories where slug = 'shoes'), 9900, null, true, true, now() - interval '44 days'),
  ('sneakers-runner', 'Кроссовки Runner', 'Stride', 'Лёгкие беговые кроссовки с амортизирующей подошвой.', '{"Материал":"Текстиль, EVA","Уход":"Ручная чистка","Артикул":"SF-024"}'::jsonb, (select id from public.categories where slug = 'shoes'), 8400, 10900, false, true, now() - interval '46 days'),
  ('boots-chelsea', 'Ботинки Chelsea', 'Stride', 'Классические челси из гладкой кожи с эластичными вставками.', '{"Материал":"Натуральная кожа","Уход":"Крем для кожи","Артикул":"SF-025"}'::jsonb, (select id from public.categories where slug = 'shoes'), 14900, null, false, false, now() - interval '48 days'),
  ('loafers-leather', 'Лоферы Leather', 'Atelier 21', 'Лоферы из мягкой кожи на сплошной подошве.', '{"Материал":"Натуральная кожа","Уход":"Крем для кожи","Артикул":"SF-026"}'::jsonb, (select id from public.categories where slug = 'shoes'), 12900, 15900, false, false, now() - interval '50 days'),
  ('sneakers-high', 'Высокие кеды Hi', 'Stride', 'Высокие кеды из плотного канваса.', '{"Материал":"Хлопок, резина","Уход":"Стирка 30°C","Артикул":"SF-027"}'::jsonb, (select id from public.categories where slug = 'shoes'), 6900, null, true, false, now() - interval '52 days'),
  ('backpack-daily', 'Рюкзак Daily', 'Northline', 'Городской рюкзак на 18 литров с отделением для ноутбука.', '{"Материал":"Нейлон 600D","Уход":"Протирать влажной тканью","Артикул":"SF-028"}'::jsonb, (select id from public.categories where slug = 'accessories'), 6500, null, false, true, now() - interval '54 days'),
  ('tote-canvas', 'Тоут Canvas', 'Mono Studio', 'Вместительная сумка-шоппер из плотного хлопка.', '{"Материал":"Хлопок 12 oz","Уход":"Стирка 30°C","Артикул":"SF-029"}'::jsonb, (select id from public.categories where slug = 'accessories'), 2900, null, true, false, now() - interval '56 days'),
  ('watch-minimal', 'Часы Minimal 38', 'Orbit', 'Кварцевые часы с циферблатом 38 мм и кожаным ремешком.', '{"Материал":"Сталь, сапфировое стекло","Уход":"Влагозащита 5 ATM","Артикул":"SF-030"}'::jsonb, (select id from public.categories where slug = 'accessories'), 11900, 13900, false, true, now() - interval '58 days'),
  ('sunglasses-round', 'Очки Round', 'Orbit', 'Круглые солнцезащитные очки с UV400-линзами.', '{"Материал":"Ацетат","Уход":"Чехол в комплекте","Артикул":"SF-031"}'::jsonb, (select id from public.categories where slug = 'accessories'), 4800, null, false, false, now() - interval '60 days'),
  ('belt-leather', 'Ремень Leather', 'Atelier 21', 'Ремень из натуральной кожи с матовой пряжкой.', '{"Материал":"Натуральная кожа","Уход":"Крем для кожи","Артикул":"SF-032"}'::jsonb, (select id from public.categories where slug = 'accessories'), 3400, null, false, false, now() - interval '62 days'),
  ('scarf-wool', 'Шарф Wool', 'Mono Studio', 'Шерстяной шарф крупной вязки.', '{"Материал":"Шерсть 100%","Уход":"Ручная стирка","Артикул":"SF-033"}'::jsonb, (select id from public.categories where slug = 'accessories'), 3900, 4900, false, false, now() - interval '64 days'),
  ('cap-classic', 'Кепка Classic', 'Northline', 'Шестипанельная кепка из хлопкового твилла.', '{"Материал":"Хлопок твилл","Уход":"Стирка 30°C","Артикул":"SF-034"}'::jsonb, (select id from public.categories where slug = 'accessories'), 2200, null, true, false, now() - interval '66 days')
on conflict (slug) do nothing;

insert into public.product_images (product_id, url, alt, sort_order)
select p.id, v.url, v.alt, v.ord from (values
  ('basic-tee-heavy', 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=1200&q=80', 'Футболка Heavy Cotton', 0),
  ('basic-tee-heavy', 'https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?auto=format&fit=crop&w=1200&q=80', 'Футболка Heavy Cotton', 1),
  ('essential-tee-slim', 'https://images.unsplash.com/photo-1576566588028-4147f3842f27?auto=format&fit=crop&w=1200&q=80', 'Футболка Essential Slim', 0),
  ('essential-tee-slim', 'https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?auto=format&fit=crop&w=1200&q=80', 'Футболка Essential Slim', 1),
  ('linen-shirt', 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?auto=format&fit=crop&w=1200&q=80', 'Рубашка Linen Day', 0),
  ('linen-shirt', 'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?auto=format&fit=crop&w=1200&q=80', 'Рубашка Linen Day', 1),
  ('oxford-shirt', 'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?auto=format&fit=crop&w=1200&q=80', 'Рубашка Oxford Classic', 0),
  ('oxford-shirt', 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?auto=format&fit=crop&w=1200&q=80', 'Рубашка Oxford Classic', 1),
  ('polo-knit', 'https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?auto=format&fit=crop&w=1200&q=80', 'Поло Piqué', 0),
  ('polo-knit', 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=1200&q=80', 'Поло Piqué', 1),
  ('long-sleeve', 'https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?auto=format&fit=crop&w=1200&q=80', 'Лонгслив Raw', 0),
  ('long-sleeve', 'https://images.unsplash.com/photo-1576566588028-4147f3842f27?auto=format&fit=crop&w=1200&q=80', 'Лонгслив Raw', 1),
  ('bomber-core', 'https://images.unsplash.com/photo-1551028719-00167b16eac5?auto=format&fit=crop&w=1200&q=80', 'Бомбер Core', 0),
  ('bomber-core', 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=1200&q=80', 'Бомбер Core', 1),
  ('trench-city', 'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&w=1200&q=80', 'Тренч City', 0),
  ('trench-city', 'https://images.unsplash.com/photo-1529374255404-311a2a4f1fd9?auto=format&fit=crop&w=1200&q=80', 'Тренч City', 1),
  ('blazer-soft', 'https://images.unsplash.com/photo-1594938298603-c8148c4dae35?auto=format&fit=crop&w=1200&q=80', 'Пиджак Soft Tailoring', 0),
  ('blazer-soft', 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=1200&q=80', 'Пиджак Soft Tailoring', 1),
  ('puffer-light', 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=1200&q=80', 'Пуховик Light', 0),
  ('puffer-light', 'https://images.unsplash.com/photo-1551028719-00167b16eac5?auto=format&fit=crop&w=1200&q=80', 'Пуховик Light', 1),
  ('denim-jacket', 'https://images.unsplash.com/photo-1529374255404-311a2a4f1fd9?auto=format&fit=crop&w=1200&q=80', 'Джинсовая куртка Rinse', 0),
  ('denim-jacket', 'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&w=1200&q=80', 'Джинсовая куртка Rinse', 1),
  ('coat-wool', 'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&w=1200&q=80', 'Пальто Wool Long', 0),
  ('coat-wool', 'https://images.unsplash.com/photo-1594938298603-c8148c4dae35?auto=format&fit=crop&w=1200&q=80', 'Пальто Wool Long', 1),
  ('knit-crew', 'https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?auto=format&fit=crop&w=1200&q=80', 'Свитер Merino Crew', 0),
  ('knit-crew', 'https://images.unsplash.com/photo-1434389677669-e08b4cac3105?auto=format&fit=crop&w=1200&q=80', 'Свитер Merino Crew', 1),
  ('hoodie-oversize', 'https://images.unsplash.com/photo-1489987707025-afc232f7ea0f?auto=format&fit=crop&w=1200&q=80', 'Худи Oversize', 0),
  ('hoodie-oversize', 'https://images.unsplash.com/photo-1485462537746-965f33f7f6a7?auto=format&fit=crop&w=1200&q=80', 'Худи Oversize', 1),
  ('cardigan-rib', 'https://images.unsplash.com/photo-1434389677669-e08b4cac3105?auto=format&fit=crop&w=1200&q=80', 'Кардиган Rib', 0),
  ('cardigan-rib', 'https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?auto=format&fit=crop&w=1200&q=80', 'Кардиган Rib', 1),
  ('turtleneck', 'https://images.unsplash.com/photo-1485462537746-965f33f7f6a7?auto=format&fit=crop&w=1200&q=80', 'Водолазка Fine Knit', 0),
  ('turtleneck', 'https://images.unsplash.com/photo-1489987707025-afc232f7ea0f?auto=format&fit=crop&w=1200&q=80', 'Водолазка Fine Knit', 1),
  ('sweatshirt-zip', 'https://images.unsplash.com/photo-1489987707025-afc232f7ea0f?auto=format&fit=crop&w=1200&q=80', 'Свитшот на молнии', 0),
  ('sweatshirt-zip', 'https://images.unsplash.com/photo-1434389677669-e08b4cac3105?auto=format&fit=crop&w=1200&q=80', 'Свитшот на молнии', 1),
  ('jeans-straight', 'https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?auto=format&fit=crop&w=1200&q=80', 'Джинсы Straight 01', 0),
  ('jeans-straight', 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=1200&q=80', 'Джинсы Straight 01', 1),
  ('chino-slim', 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=1200&q=80', 'Чиносы Slim', 0),
  ('chino-slim', 'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?auto=format&fit=crop&w=1200&q=80', 'Чиносы Slim', 1),
  ('trousers-pleated', 'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?auto=format&fit=crop&w=1200&q=80', 'Брюки со складками', 0),
  ('trousers-pleated', 'https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?auto=format&fit=crop&w=1200&q=80', 'Брюки со складками', 1),
  ('cargo-relaxed', 'https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?auto=format&fit=crop&w=1200&q=80', 'Карго Relaxed', 0),
  ('cargo-relaxed', 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=1200&q=80', 'Карго Relaxed', 1),
  ('joggers-knit', 'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?auto=format&fit=crop&w=1200&q=80', 'Джоггеры Knit', 0),
  ('joggers-knit', 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=1200&q=80', 'Джоггеры Knit', 1),
  ('sneakers-court', 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=1200&q=80', 'Кроссовки Court', 0),
  ('sneakers-court', 'https://images.unsplash.com/photo-1549298916-b41d501d3772?auto=format&fit=crop&w=1200&q=80', 'Кроссовки Court', 1),
  ('sneakers-runner', 'https://images.unsplash.com/photo-1491553895911-0055eca6402d?auto=format&fit=crop&w=1200&q=80', 'Кроссовки Runner', 0),
  ('sneakers-runner', 'https://images.unsplash.com/photo-1460353581641-37baddab0fa2?auto=format&fit=crop&w=1200&q=80', 'Кроссовки Runner', 1),
  ('boots-chelsea', 'https://images.unsplash.com/photo-1549298916-b41d501d3772?auto=format&fit=crop&w=1200&q=80', 'Ботинки Chelsea', 0),
  ('boots-chelsea', 'https://images.unsplash.com/photo-1606760227091-3dd870d97f1d?auto=format&fit=crop&w=1200&q=80', 'Ботинки Chelsea', 1),
  ('loafers-leather', 'https://images.unsplash.com/photo-1606760227091-3dd870d97f1d?auto=format&fit=crop&w=1200&q=80', 'Лоферы Leather', 0),
  ('loafers-leather', 'https://images.unsplash.com/photo-1608231387042-66d1773070a5?auto=format&fit=crop&w=1200&q=80', 'Лоферы Leather', 1),
  ('sneakers-high', 'https://images.unsplash.com/photo-1460353581641-37baddab0fa2?auto=format&fit=crop&w=1200&q=80', 'Высокие кеды Hi', 0),
  ('sneakers-high', 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=1200&q=80', 'Высокие кеды Hi', 1),
  ('backpack-daily', 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=1200&q=80', 'Рюкзак Daily', 0),
  ('backpack-daily', 'https://images.unsplash.com/photo-1548036328-c9fa89d128fa?auto=format&fit=crop&w=1200&q=80', 'Рюкзак Daily', 1),
  ('tote-canvas', 'https://images.unsplash.com/photo-1548036328-c9fa89d128fa?auto=format&fit=crop&w=1200&q=80', 'Тоут Canvas', 0),
  ('tote-canvas', 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=1200&q=80', 'Тоут Canvas', 1),
  ('watch-minimal', 'https://images.unsplash.com/photo-1523170335258-f5ed11844a49?auto=format&fit=crop&w=1200&q=80', 'Часы Minimal 38', 0),
  ('watch-minimal', 'https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=1200&q=80', 'Часы Minimal 38', 1),
  ('sunglasses-round', 'https://images.unsplash.com/photo-1572635196237-14b3f281503f?auto=format&fit=crop&w=1200&q=80', 'Очки Round', 0),
  ('sunglasses-round', 'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=1200&q=80', 'Очки Round', 1),
  ('belt-leather', 'https://images.unsplash.com/photo-1611591437281-460bfbe1220a?auto=format&fit=crop&w=1200&q=80', 'Ремень Leather', 0),
  ('belt-leather', 'https://images.unsplash.com/photo-1627123424574-724758594e93?auto=format&fit=crop&w=1200&q=80', 'Ремень Leather', 1),
  ('scarf-wool', 'https://images.unsplash.com/photo-1627123424574-724758594e93?auto=format&fit=crop&w=1200&q=80', 'Шарф Wool', 0),
  ('scarf-wool', 'https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=1200&q=80', 'Шарф Wool', 1),
  ('cap-classic', 'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=1200&q=80', 'Кепка Classic', 0),
  ('cap-classic', 'https://images.unsplash.com/photo-1572635196237-14b3f281503f?auto=format&fit=crop&w=1200&q=80', 'Кепка Classic', 1)
) as v(slug, url, alt, ord) join public.products p on p.slug = v.slug
where not exists (select 1 from public.product_images i where i.product_id = p.id);

insert into public.product_variants (product_id, sku, size, color, color_hex)
select p.id, v.sku, v.size, v.color, v.hex from (values
  ('basic-tee-heavy', 'BASIC-TEE-HEAVY-XS-WHITE', 'XS', 'Белый', '#f5f5f3'),
  ('basic-tee-heavy', 'BASIC-TEE-HEAVY-XS-BLACK', 'XS', 'Чёрный', '#1c1c1e'),
  ('basic-tee-heavy', 'BASIC-TEE-HEAVY-XS-GREY', 'XS', 'Серый', '#9a9a9e'),
  ('basic-tee-heavy', 'BASIC-TEE-HEAVY-S-WHITE', 'S', 'Белый', '#f5f5f3'),
  ('basic-tee-heavy', 'BASIC-TEE-HEAVY-S-BLACK', 'S', 'Чёрный', '#1c1c1e'),
  ('basic-tee-heavy', 'BASIC-TEE-HEAVY-S-GREY', 'S', 'Серый', '#9a9a9e'),
  ('basic-tee-heavy', 'BASIC-TEE-HEAVY-M-WHITE', 'M', 'Белый', '#f5f5f3'),
  ('basic-tee-heavy', 'BASIC-TEE-HEAVY-M-BLACK', 'M', 'Чёрный', '#1c1c1e'),
  ('basic-tee-heavy', 'BASIC-TEE-HEAVY-M-GREY', 'M', 'Серый', '#9a9a9e'),
  ('basic-tee-heavy', 'BASIC-TEE-HEAVY-L-WHITE', 'L', 'Белый', '#f5f5f3'),
  ('basic-tee-heavy', 'BASIC-TEE-HEAVY-L-BLACK', 'L', 'Чёрный', '#1c1c1e'),
  ('basic-tee-heavy', 'BASIC-TEE-HEAVY-L-GREY', 'L', 'Серый', '#9a9a9e'),
  ('basic-tee-heavy', 'BASIC-TEE-HEAVY-XL-WHITE', 'XL', 'Белый', '#f5f5f3'),
  ('basic-tee-heavy', 'BASIC-TEE-HEAVY-XL-BLACK', 'XL', 'Чёрный', '#1c1c1e'),
  ('basic-tee-heavy', 'BASIC-TEE-HEAVY-XL-GREY', 'XL', 'Серый', '#9a9a9e'),
  ('essential-tee-slim', 'ESSENTIAL-TEE-SLIM-XS-BLACK', 'XS', 'Чёрный', '#1c1c1e'),
  ('essential-tee-slim', 'ESSENTIAL-TEE-SLIM-XS-NAVY', 'XS', 'Тёмно-синий', '#1f2a44'),
  ('essential-tee-slim', 'ESSENTIAL-TEE-SLIM-XS-OLIVE', 'XS', 'Оливковый', '#5b6140'),
  ('essential-tee-slim', 'ESSENTIAL-TEE-SLIM-S-BLACK', 'S', 'Чёрный', '#1c1c1e'),
  ('essential-tee-slim', 'ESSENTIAL-TEE-SLIM-S-NAVY', 'S', 'Тёмно-синий', '#1f2a44'),
  ('essential-tee-slim', 'ESSENTIAL-TEE-SLIM-S-OLIVE', 'S', 'Оливковый', '#5b6140'),
  ('essential-tee-slim', 'ESSENTIAL-TEE-SLIM-M-BLACK', 'M', 'Чёрный', '#1c1c1e'),
  ('essential-tee-slim', 'ESSENTIAL-TEE-SLIM-M-NAVY', 'M', 'Тёмно-синий', '#1f2a44'),
  ('essential-tee-slim', 'ESSENTIAL-TEE-SLIM-M-OLIVE', 'M', 'Оливковый', '#5b6140'),
  ('essential-tee-slim', 'ESSENTIAL-TEE-SLIM-L-BLACK', 'L', 'Чёрный', '#1c1c1e'),
  ('essential-tee-slim', 'ESSENTIAL-TEE-SLIM-L-NAVY', 'L', 'Тёмно-синий', '#1f2a44'),
  ('essential-tee-slim', 'ESSENTIAL-TEE-SLIM-L-OLIVE', 'L', 'Оливковый', '#5b6140'),
  ('essential-tee-slim', 'ESSENTIAL-TEE-SLIM-XL-BLACK', 'XL', 'Чёрный', '#1c1c1e'),
  ('essential-tee-slim', 'ESSENTIAL-TEE-SLIM-XL-NAVY', 'XL', 'Тёмно-синий', '#1f2a44'),
  ('essential-tee-slim', 'ESSENTIAL-TEE-SLIM-XL-OLIVE', 'XL', 'Оливковый', '#5b6140'),
  ('linen-shirt', 'LINEN-SHIRT-XS-WHITE', 'XS', 'Белый', '#f5f5f3'),
  ('linen-shirt', 'LINEN-SHIRT-XS-BLUE', 'XS', 'Голубой', '#4a6fa5'),
  ('linen-shirt', 'LINEN-SHIRT-XS-BEIGE', 'XS', 'Бежевый', '#d8c9b0'),
  ('linen-shirt', 'LINEN-SHIRT-S-WHITE', 'S', 'Белый', '#f5f5f3'),
  ('linen-shirt', 'LINEN-SHIRT-S-BLUE', 'S', 'Голубой', '#4a6fa5'),
  ('linen-shirt', 'LINEN-SHIRT-S-BEIGE', 'S', 'Бежевый', '#d8c9b0'),
  ('linen-shirt', 'LINEN-SHIRT-M-WHITE', 'M', 'Белый', '#f5f5f3'),
  ('linen-shirt', 'LINEN-SHIRT-M-BLUE', 'M', 'Голубой', '#4a6fa5'),
  ('linen-shirt', 'LINEN-SHIRT-M-BEIGE', 'M', 'Бежевый', '#d8c9b0'),
  ('linen-shirt', 'LINEN-SHIRT-L-WHITE', 'L', 'Белый', '#f5f5f3'),
  ('linen-shirt', 'LINEN-SHIRT-L-BLUE', 'L', 'Голубой', '#4a6fa5'),
  ('linen-shirt', 'LINEN-SHIRT-L-BEIGE', 'L', 'Бежевый', '#d8c9b0'),
  ('linen-shirt', 'LINEN-SHIRT-XL-WHITE', 'XL', 'Белый', '#f5f5f3'),
  ('linen-shirt', 'LINEN-SHIRT-XL-BLUE', 'XL', 'Голубой', '#4a6fa5'),
  ('linen-shirt', 'LINEN-SHIRT-XL-BEIGE', 'XL', 'Бежевый', '#d8c9b0'),
  ('oxford-shirt', 'OXFORD-SHIRT-XS-WHITE', 'XS', 'Белый', '#f5f5f3'),
  ('oxford-shirt', 'OXFORD-SHIRT-XS-BLUE', 'XS', 'Голубой', '#4a6fa5'),
  ('oxford-shirt', 'OXFORD-SHIRT-S-WHITE', 'S', 'Белый', '#f5f5f3'),
  ('oxford-shirt', 'OXFORD-SHIRT-S-BLUE', 'S', 'Голубой', '#4a6fa5'),
  ('oxford-shirt', 'OXFORD-SHIRT-M-WHITE', 'M', 'Белый', '#f5f5f3'),
  ('oxford-shirt', 'OXFORD-SHIRT-M-BLUE', 'M', 'Голубой', '#4a6fa5'),
  ('oxford-shirt', 'OXFORD-SHIRT-L-WHITE', 'L', 'Белый', '#f5f5f3'),
  ('oxford-shirt', 'OXFORD-SHIRT-L-BLUE', 'L', 'Голубой', '#4a6fa5'),
  ('oxford-shirt', 'OXFORD-SHIRT-XL-WHITE', 'XL', 'Белый', '#f5f5f3'),
  ('oxford-shirt', 'OXFORD-SHIRT-XL-BLUE', 'XL', 'Голубой', '#4a6fa5'),
  ('polo-knit', 'POLO-KNIT-XS-NAVY', 'XS', 'Тёмно-синий', '#1f2a44'),
  ('polo-knit', 'POLO-KNIT-XS-WHITE', 'XS', 'Белый', '#f5f5f3'),
  ('polo-knit', 'POLO-KNIT-XS-OLIVE', 'XS', 'Оливковый', '#5b6140'),
  ('polo-knit', 'POLO-KNIT-S-NAVY', 'S', 'Тёмно-синий', '#1f2a44'),
  ('polo-knit', 'POLO-KNIT-S-WHITE', 'S', 'Белый', '#f5f5f3'),
  ('polo-knit', 'POLO-KNIT-S-OLIVE', 'S', 'Оливковый', '#5b6140'),
  ('polo-knit', 'POLO-KNIT-M-NAVY', 'M', 'Тёмно-синий', '#1f2a44'),
  ('polo-knit', 'POLO-KNIT-M-WHITE', 'M', 'Белый', '#f5f5f3'),
  ('polo-knit', 'POLO-KNIT-M-OLIVE', 'M', 'Оливковый', '#5b6140'),
  ('polo-knit', 'POLO-KNIT-L-NAVY', 'L', 'Тёмно-синий', '#1f2a44'),
  ('polo-knit', 'POLO-KNIT-L-WHITE', 'L', 'Белый', '#f5f5f3'),
  ('polo-knit', 'POLO-KNIT-L-OLIVE', 'L', 'Оливковый', '#5b6140'),
  ('polo-knit', 'POLO-KNIT-XL-NAVY', 'XL', 'Тёмно-синий', '#1f2a44'),
  ('polo-knit', 'POLO-KNIT-XL-WHITE', 'XL', 'Белый', '#f5f5f3'),
  ('polo-knit', 'POLO-KNIT-XL-OLIVE', 'XL', 'Оливковый', '#5b6140'),
  ('long-sleeve', 'LONG-SLEEVE-XS-GREY', 'XS', 'Серый', '#9a9a9e'),
  ('long-sleeve', 'LONG-SLEEVE-XS-BLACK', 'XS', 'Чёрный', '#1c1c1e'),
  ('long-sleeve', 'LONG-SLEEVE-S-GREY', 'S', 'Серый', '#9a9a9e'),
  ('long-sleeve', 'LONG-SLEEVE-S-BLACK', 'S', 'Чёрный', '#1c1c1e'),
  ('long-sleeve', 'LONG-SLEEVE-M-GREY', 'M', 'Серый', '#9a9a9e'),
  ('long-sleeve', 'LONG-SLEEVE-M-BLACK', 'M', 'Чёрный', '#1c1c1e'),
  ('long-sleeve', 'LONG-SLEEVE-L-GREY', 'L', 'Серый', '#9a9a9e'),
  ('long-sleeve', 'LONG-SLEEVE-L-BLACK', 'L', 'Чёрный', '#1c1c1e'),
  ('long-sleeve', 'LONG-SLEEVE-XL-GREY', 'XL', 'Серый', '#9a9a9e'),
  ('long-sleeve', 'LONG-SLEEVE-XL-BLACK', 'XL', 'Чёрный', '#1c1c1e'),
  ('bomber-core', 'BOMBER-CORE-XS-BLACK', 'XS', 'Чёрный', '#1c1c1e'),
  ('bomber-core', 'BOMBER-CORE-XS-OLIVE', 'XS', 'Оливковый', '#5b6140'),
  ('bomber-core', 'BOMBER-CORE-S-BLACK', 'S', 'Чёрный', '#1c1c1e'),
  ('bomber-core', 'BOMBER-CORE-S-OLIVE', 'S', 'Оливковый', '#5b6140'),
  ('bomber-core', 'BOMBER-CORE-M-BLACK', 'M', 'Чёрный', '#1c1c1e'),
  ('bomber-core', 'BOMBER-CORE-M-OLIVE', 'M', 'Оливковый', '#5b6140'),
  ('bomber-core', 'BOMBER-CORE-L-BLACK', 'L', 'Чёрный', '#1c1c1e'),
  ('bomber-core', 'BOMBER-CORE-L-OLIVE', 'L', 'Оливковый', '#5b6140'),
  ('bomber-core', 'BOMBER-CORE-XL-BLACK', 'XL', 'Чёрный', '#1c1c1e'),
  ('bomber-core', 'BOMBER-CORE-XL-OLIVE', 'XL', 'Оливковый', '#5b6140'),
  ('trench-city', 'TRENCH-CITY-XS-BEIGE', 'XS', 'Бежевый', '#d8c9b0'),
  ('trench-city', 'TRENCH-CITY-XS-NAVY', 'XS', 'Тёмно-синий', '#1f2a44'),
  ('trench-city', 'TRENCH-CITY-S-BEIGE', 'S', 'Бежевый', '#d8c9b0'),
  ('trench-city', 'TRENCH-CITY-S-NAVY', 'S', 'Тёмно-синий', '#1f2a44'),
  ('trench-city', 'TRENCH-CITY-M-BEIGE', 'M', 'Бежевый', '#d8c9b0'),
  ('trench-city', 'TRENCH-CITY-M-NAVY', 'M', 'Тёмно-синий', '#1f2a44'),
  ('trench-city', 'TRENCH-CITY-L-BEIGE', 'L', 'Бежевый', '#d8c9b0'),
  ('trench-city', 'TRENCH-CITY-L-NAVY', 'L', 'Тёмно-синий', '#1f2a44'),
  ('trench-city', 'TRENCH-CITY-XL-BEIGE', 'XL', 'Бежевый', '#d8c9b0'),
  ('trench-city', 'TRENCH-CITY-XL-NAVY', 'XL', 'Тёмно-синий', '#1f2a44'),
  ('blazer-soft', 'BLAZER-SOFT-XS-GRAPHITE', 'XS', 'Графитовый', '#3a3a3d'),
  ('blazer-soft', 'BLAZER-SOFT-XS-NAVY', 'XS', 'Тёмно-синий', '#1f2a44'),
  ('blazer-soft', 'BLAZER-SOFT-S-GRAPHITE', 'S', 'Графитовый', '#3a3a3d'),
  ('blazer-soft', 'BLAZER-SOFT-S-NAVY', 'S', 'Тёмно-синий', '#1f2a44'),
  ('blazer-soft', 'BLAZER-SOFT-M-GRAPHITE', 'M', 'Графитовый', '#3a3a3d'),
  ('blazer-soft', 'BLAZER-SOFT-M-NAVY', 'M', 'Тёмно-синий', '#1f2a44'),
  ('blazer-soft', 'BLAZER-SOFT-L-GRAPHITE', 'L', 'Графитовый', '#3a3a3d'),
  ('blazer-soft', 'BLAZER-SOFT-L-NAVY', 'L', 'Тёмно-синий', '#1f2a44'),
  ('blazer-soft', 'BLAZER-SOFT-XL-GRAPHITE', 'XL', 'Графитовый', '#3a3a3d'),
  ('blazer-soft', 'BLAZER-SOFT-XL-NAVY', 'XL', 'Тёмно-синий', '#1f2a44'),
  ('puffer-light', 'PUFFER-LIGHT-XS-BLACK', 'XS', 'Чёрный', '#1c1c1e'),
  ('puffer-light', 'PUFFER-LIGHT-XS-GREY', 'XS', 'Серый', '#9a9a9e'),
  ('puffer-light', 'PUFFER-LIGHT-XS-OLIVE', 'XS', 'Оливковый', '#5b6140'),
  ('puffer-light', 'PUFFER-LIGHT-S-BLACK', 'S', 'Чёрный', '#1c1c1e'),
  ('puffer-light', 'PUFFER-LIGHT-S-GREY', 'S', 'Серый', '#9a9a9e'),
  ('puffer-light', 'PUFFER-LIGHT-S-OLIVE', 'S', 'Оливковый', '#5b6140'),
  ('puffer-light', 'PUFFER-LIGHT-M-BLACK', 'M', 'Чёрный', '#1c1c1e'),
  ('puffer-light', 'PUFFER-LIGHT-M-GREY', 'M', 'Серый', '#9a9a9e'),
  ('puffer-light', 'PUFFER-LIGHT-M-OLIVE', 'M', 'Оливковый', '#5b6140'),
  ('puffer-light', 'PUFFER-LIGHT-L-BLACK', 'L', 'Чёрный', '#1c1c1e'),
  ('puffer-light', 'PUFFER-LIGHT-L-GREY', 'L', 'Серый', '#9a9a9e'),
  ('puffer-light', 'PUFFER-LIGHT-L-OLIVE', 'L', 'Оливковый', '#5b6140'),
  ('puffer-light', 'PUFFER-LIGHT-XL-BLACK', 'XL', 'Чёрный', '#1c1c1e'),
  ('puffer-light', 'PUFFER-LIGHT-XL-GREY', 'XL', 'Серый', '#9a9a9e'),
  ('puffer-light', 'PUFFER-LIGHT-XL-OLIVE', 'XL', 'Оливковый', '#5b6140'),
  ('denim-jacket', 'DENIM-JACKET-XS-BLUE', 'XS', 'Голубой', '#4a6fa5'),
  ('denim-jacket', 'DENIM-JACKET-XS-BLACK', 'XS', 'Чёрный', '#1c1c1e'),
  ('denim-jacket', 'DENIM-JACKET-S-BLUE', 'S', 'Голубой', '#4a6fa5'),
  ('denim-jacket', 'DENIM-JACKET-S-BLACK', 'S', 'Чёрный', '#1c1c1e'),
  ('denim-jacket', 'DENIM-JACKET-M-BLUE', 'M', 'Голубой', '#4a6fa5'),
  ('denim-jacket', 'DENIM-JACKET-M-BLACK', 'M', 'Чёрный', '#1c1c1e'),
  ('denim-jacket', 'DENIM-JACKET-L-BLUE', 'L', 'Голубой', '#4a6fa5'),
  ('denim-jacket', 'DENIM-JACKET-L-BLACK', 'L', 'Чёрный', '#1c1c1e'),
  ('denim-jacket', 'DENIM-JACKET-XL-BLUE', 'XL', 'Голубой', '#4a6fa5'),
  ('denim-jacket', 'DENIM-JACKET-XL-BLACK', 'XL', 'Чёрный', '#1c1c1e'),
  ('coat-wool', 'COAT-WOOL-XS-GRAPHITE', 'XS', 'Графитовый', '#3a3a3d'),
  ('coat-wool', 'COAT-WOOL-XS-BEIGE', 'XS', 'Бежевый', '#d8c9b0'),
  ('coat-wool', 'COAT-WOOL-S-GRAPHITE', 'S', 'Графитовый', '#3a3a3d'),
  ('coat-wool', 'COAT-WOOL-S-BEIGE', 'S', 'Бежевый', '#d8c9b0'),
  ('coat-wool', 'COAT-WOOL-M-GRAPHITE', 'M', 'Графитовый', '#3a3a3d'),
  ('coat-wool', 'COAT-WOOL-M-BEIGE', 'M', 'Бежевый', '#d8c9b0'),
  ('coat-wool', 'COAT-WOOL-L-GRAPHITE', 'L', 'Графитовый', '#3a3a3d'),
  ('coat-wool', 'COAT-WOOL-L-BEIGE', 'L', 'Бежевый', '#d8c9b0'),
  ('coat-wool', 'COAT-WOOL-XL-GRAPHITE', 'XL', 'Графитовый', '#3a3a3d'),
  ('coat-wool', 'COAT-WOOL-XL-BEIGE', 'XL', 'Бежевый', '#d8c9b0'),
  ('knit-crew', 'KNIT-CREW-XS-GREY', 'XS', 'Серый', '#9a9a9e'),
  ('knit-crew', 'KNIT-CREW-XS-NAVY', 'XS', 'Тёмно-синий', '#1f2a44'),
  ('knit-crew', 'KNIT-CREW-XS-BEIGE', 'XS', 'Бежевый', '#d8c9b0'),
  ('knit-crew', 'KNIT-CREW-S-GREY', 'S', 'Серый', '#9a9a9e'),
  ('knit-crew', 'KNIT-CREW-S-NAVY', 'S', 'Тёмно-синий', '#1f2a44'),
  ('knit-crew', 'KNIT-CREW-S-BEIGE', 'S', 'Бежевый', '#d8c9b0'),
  ('knit-crew', 'KNIT-CREW-M-GREY', 'M', 'Серый', '#9a9a9e'),
  ('knit-crew', 'KNIT-CREW-M-NAVY', 'M', 'Тёмно-синий', '#1f2a44'),
  ('knit-crew', 'KNIT-CREW-M-BEIGE', 'M', 'Бежевый', '#d8c9b0'),
  ('knit-crew', 'KNIT-CREW-L-GREY', 'L', 'Серый', '#9a9a9e'),
  ('knit-crew', 'KNIT-CREW-L-NAVY', 'L', 'Тёмно-синий', '#1f2a44'),
  ('knit-crew', 'KNIT-CREW-L-BEIGE', 'L', 'Бежевый', '#d8c9b0'),
  ('knit-crew', 'KNIT-CREW-XL-GREY', 'XL', 'Серый', '#9a9a9e'),
  ('knit-crew', 'KNIT-CREW-XL-NAVY', 'XL', 'Тёмно-синий', '#1f2a44'),
  ('knit-crew', 'KNIT-CREW-XL-BEIGE', 'XL', 'Бежевый', '#d8c9b0'),
  ('hoodie-oversize', 'HOODIE-OVERSIZE-XS-BLACK', 'XS', 'Чёрный', '#1c1c1e'),
  ('hoodie-oversize', 'HOODIE-OVERSIZE-XS-GREY', 'XS', 'Серый', '#9a9a9e'),
  ('hoodie-oversize', 'HOODIE-OVERSIZE-XS-OLIVE', 'XS', 'Оливковый', '#5b6140'),
  ('hoodie-oversize', 'HOODIE-OVERSIZE-S-BLACK', 'S', 'Чёрный', '#1c1c1e'),
  ('hoodie-oversize', 'HOODIE-OVERSIZE-S-GREY', 'S', 'Серый', '#9a9a9e'),
  ('hoodie-oversize', 'HOODIE-OVERSIZE-S-OLIVE', 'S', 'Оливковый', '#5b6140'),
  ('hoodie-oversize', 'HOODIE-OVERSIZE-M-BLACK', 'M', 'Чёрный', '#1c1c1e'),
  ('hoodie-oversize', 'HOODIE-OVERSIZE-M-GREY', 'M', 'Серый', '#9a9a9e'),
  ('hoodie-oversize', 'HOODIE-OVERSIZE-M-OLIVE', 'M', 'Оливковый', '#5b6140'),
  ('hoodie-oversize', 'HOODIE-OVERSIZE-L-BLACK', 'L', 'Чёрный', '#1c1c1e'),
  ('hoodie-oversize', 'HOODIE-OVERSIZE-L-GREY', 'L', 'Серый', '#9a9a9e'),
  ('hoodie-oversize', 'HOODIE-OVERSIZE-L-OLIVE', 'L', 'Оливковый', '#5b6140'),
  ('hoodie-oversize', 'HOODIE-OVERSIZE-XL-BLACK', 'XL', 'Чёрный', '#1c1c1e'),
  ('hoodie-oversize', 'HOODIE-OVERSIZE-XL-GREY', 'XL', 'Серый', '#9a9a9e'),
  ('hoodie-oversize', 'HOODIE-OVERSIZE-XL-OLIVE', 'XL', 'Оливковый', '#5b6140'),
  ('cardigan-rib', 'CARDIGAN-RIB-XS-BEIGE', 'XS', 'Бежевый', '#d8c9b0'),
  ('cardigan-rib', 'CARDIGAN-RIB-XS-GRAPHITE', 'XS', 'Графитовый', '#3a3a3d'),
  ('cardigan-rib', 'CARDIGAN-RIB-S-BEIGE', 'S', 'Бежевый', '#d8c9b0'),
  ('cardigan-rib', 'CARDIGAN-RIB-S-GRAPHITE', 'S', 'Графитовый', '#3a3a3d'),
  ('cardigan-rib', 'CARDIGAN-RIB-M-BEIGE', 'M', 'Бежевый', '#d8c9b0'),
  ('cardigan-rib', 'CARDIGAN-RIB-M-GRAPHITE', 'M', 'Графитовый', '#3a3a3d'),
  ('cardigan-rib', 'CARDIGAN-RIB-L-BEIGE', 'L', 'Бежевый', '#d8c9b0'),
  ('cardigan-rib', 'CARDIGAN-RIB-L-GRAPHITE', 'L', 'Графитовый', '#3a3a3d'),
  ('cardigan-rib', 'CARDIGAN-RIB-XL-BEIGE', 'XL', 'Бежевый', '#d8c9b0'),
  ('cardigan-rib', 'CARDIGAN-RIB-XL-GRAPHITE', 'XL', 'Графитовый', '#3a3a3d'),
  ('turtleneck', 'TURTLENECK-XS-BLACK', 'XS', 'Чёрный', '#1c1c1e'),
  ('turtleneck', 'TURTLENECK-XS-WHITE', 'XS', 'Белый', '#f5f5f3'),
  ('turtleneck', 'TURTLENECK-S-BLACK', 'S', 'Чёрный', '#1c1c1e'),
  ('turtleneck', 'TURTLENECK-S-WHITE', 'S', 'Белый', '#f5f5f3'),
  ('turtleneck', 'TURTLENECK-M-BLACK', 'M', 'Чёрный', '#1c1c1e'),
  ('turtleneck', 'TURTLENECK-M-WHITE', 'M', 'Белый', '#f5f5f3'),
  ('turtleneck', 'TURTLENECK-L-BLACK', 'L', 'Чёрный', '#1c1c1e'),
  ('turtleneck', 'TURTLENECK-L-WHITE', 'L', 'Белый', '#f5f5f3'),
  ('turtleneck', 'TURTLENECK-XL-BLACK', 'XL', 'Чёрный', '#1c1c1e'),
  ('turtleneck', 'TURTLENECK-XL-WHITE', 'XL', 'Белый', '#f5f5f3'),
  ('sweatshirt-zip', 'SWEATSHIRT-ZIP-XS-GREY', 'XS', 'Серый', '#9a9a9e'),
  ('sweatshirt-zip', 'SWEATSHIRT-ZIP-XS-NAVY', 'XS', 'Тёмно-синий', '#1f2a44'),
  ('sweatshirt-zip', 'SWEATSHIRT-ZIP-S-GREY', 'S', 'Серый', '#9a9a9e'),
  ('sweatshirt-zip', 'SWEATSHIRT-ZIP-S-NAVY', 'S', 'Тёмно-синий', '#1f2a44'),
  ('sweatshirt-zip', 'SWEATSHIRT-ZIP-M-GREY', 'M', 'Серый', '#9a9a9e'),
  ('sweatshirt-zip', 'SWEATSHIRT-ZIP-M-NAVY', 'M', 'Тёмно-синий', '#1f2a44'),
  ('sweatshirt-zip', 'SWEATSHIRT-ZIP-L-GREY', 'L', 'Серый', '#9a9a9e'),
  ('sweatshirt-zip', 'SWEATSHIRT-ZIP-L-NAVY', 'L', 'Тёмно-синий', '#1f2a44'),
  ('sweatshirt-zip', 'SWEATSHIRT-ZIP-XL-GREY', 'XL', 'Серый', '#9a9a9e'),
  ('sweatshirt-zip', 'SWEATSHIRT-ZIP-XL-NAVY', 'XL', 'Тёмно-синий', '#1f2a44'),
  ('jeans-straight', 'JEANS-STRAIGHT-28-BLUE', '28', 'Голубой', '#4a6fa5'),
  ('jeans-straight', 'JEANS-STRAIGHT-28-BLACK', '28', 'Чёрный', '#1c1c1e'),
  ('jeans-straight', 'JEANS-STRAIGHT-30-BLUE', '30', 'Голубой', '#4a6fa5'),
  ('jeans-straight', 'JEANS-STRAIGHT-30-BLACK', '30', 'Чёрный', '#1c1c1e'),
  ('jeans-straight', 'JEANS-STRAIGHT-32-BLUE', '32', 'Голубой', '#4a6fa5'),
  ('jeans-straight', 'JEANS-STRAIGHT-32-BLACK', '32', 'Чёрный', '#1c1c1e'),
  ('jeans-straight', 'JEANS-STRAIGHT-34-BLUE', '34', 'Голубой', '#4a6fa5'),
  ('jeans-straight', 'JEANS-STRAIGHT-34-BLACK', '34', 'Чёрный', '#1c1c1e'),
  ('jeans-straight', 'JEANS-STRAIGHT-36-BLUE', '36', 'Голубой', '#4a6fa5'),
  ('jeans-straight', 'JEANS-STRAIGHT-36-BLACK', '36', 'Чёрный', '#1c1c1e'),
  ('chino-slim', 'CHINO-SLIM-28-BEIGE', '28', 'Бежевый', '#d8c9b0'),
  ('chino-slim', 'CHINO-SLIM-28-OLIVE', '28', 'Оливковый', '#5b6140'),
  ('chino-slim', 'CHINO-SLIM-28-NAVY', '28', 'Тёмно-синий', '#1f2a44'),
  ('chino-slim', 'CHINO-SLIM-30-BEIGE', '30', 'Бежевый', '#d8c9b0'),
  ('chino-slim', 'CHINO-SLIM-30-OLIVE', '30', 'Оливковый', '#5b6140'),
  ('chino-slim', 'CHINO-SLIM-30-NAVY', '30', 'Тёмно-синий', '#1f2a44'),
  ('chino-slim', 'CHINO-SLIM-32-BEIGE', '32', 'Бежевый', '#d8c9b0'),
  ('chino-slim', 'CHINO-SLIM-32-OLIVE', '32', 'Оливковый', '#5b6140'),
  ('chino-slim', 'CHINO-SLIM-32-NAVY', '32', 'Тёмно-синий', '#1f2a44'),
  ('chino-slim', 'CHINO-SLIM-34-BEIGE', '34', 'Бежевый', '#d8c9b0'),
  ('chino-slim', 'CHINO-SLIM-34-OLIVE', '34', 'Оливковый', '#5b6140'),
  ('chino-slim', 'CHINO-SLIM-34-NAVY', '34', 'Тёмно-синий', '#1f2a44'),
  ('chino-slim', 'CHINO-SLIM-36-BEIGE', '36', 'Бежевый', '#d8c9b0'),
  ('chino-slim', 'CHINO-SLIM-36-OLIVE', '36', 'Оливковый', '#5b6140'),
  ('chino-slim', 'CHINO-SLIM-36-NAVY', '36', 'Тёмно-синий', '#1f2a44'),
  ('trousers-pleated', 'TROUSERS-PLEATED-28-GRAPHITE', '28', 'Графитовый', '#3a3a3d'),
  ('trousers-pleated', 'TROUSERS-PLEATED-28-BEIGE', '28', 'Бежевый', '#d8c9b0'),
  ('trousers-pleated', 'TROUSERS-PLEATED-30-GRAPHITE', '30', 'Графитовый', '#3a3a3d'),
  ('trousers-pleated', 'TROUSERS-PLEATED-30-BEIGE', '30', 'Бежевый', '#d8c9b0'),
  ('trousers-pleated', 'TROUSERS-PLEATED-32-GRAPHITE', '32', 'Графитовый', '#3a3a3d'),
  ('trousers-pleated', 'TROUSERS-PLEATED-32-BEIGE', '32', 'Бежевый', '#d8c9b0'),
  ('trousers-pleated', 'TROUSERS-PLEATED-34-GRAPHITE', '34', 'Графитовый', '#3a3a3d'),
  ('trousers-pleated', 'TROUSERS-PLEATED-34-BEIGE', '34', 'Бежевый', '#d8c9b0'),
  ('trousers-pleated', 'TROUSERS-PLEATED-36-GRAPHITE', '36', 'Графитовый', '#3a3a3d'),
  ('trousers-pleated', 'TROUSERS-PLEATED-36-BEIGE', '36', 'Бежевый', '#d8c9b0'),
  ('cargo-relaxed', 'CARGO-RELAXED-28-OLIVE', '28', 'Оливковый', '#5b6140'),
  ('cargo-relaxed', 'CARGO-RELAXED-28-BLACK', '28', 'Чёрный', '#1c1c1e'),
  ('cargo-relaxed', 'CARGO-RELAXED-30-OLIVE', '30', 'Оливковый', '#5b6140'),
  ('cargo-relaxed', 'CARGO-RELAXED-30-BLACK', '30', 'Чёрный', '#1c1c1e'),
  ('cargo-relaxed', 'CARGO-RELAXED-32-OLIVE', '32', 'Оливковый', '#5b6140'),
  ('cargo-relaxed', 'CARGO-RELAXED-32-BLACK', '32', 'Чёрный', '#1c1c1e'),
  ('cargo-relaxed', 'CARGO-RELAXED-34-OLIVE', '34', 'Оливковый', '#5b6140'),
  ('cargo-relaxed', 'CARGO-RELAXED-34-BLACK', '34', 'Чёрный', '#1c1c1e'),
  ('cargo-relaxed', 'CARGO-RELAXED-36-OLIVE', '36', 'Оливковый', '#5b6140'),
  ('cargo-relaxed', 'CARGO-RELAXED-36-BLACK', '36', 'Чёрный', '#1c1c1e'),
  ('joggers-knit', 'JOGGERS-KNIT-28-GREY', '28', 'Серый', '#9a9a9e'),
  ('joggers-knit', 'JOGGERS-KNIT-28-BLACK', '28', 'Чёрный', '#1c1c1e'),
  ('joggers-knit', 'JOGGERS-KNIT-30-GREY', '30', 'Серый', '#9a9a9e'),
  ('joggers-knit', 'JOGGERS-KNIT-30-BLACK', '30', 'Чёрный', '#1c1c1e'),
  ('joggers-knit', 'JOGGERS-KNIT-32-GREY', '32', 'Серый', '#9a9a9e'),
  ('joggers-knit', 'JOGGERS-KNIT-32-BLACK', '32', 'Чёрный', '#1c1c1e'),
  ('joggers-knit', 'JOGGERS-KNIT-34-GREY', '34', 'Серый', '#9a9a9e'),
  ('joggers-knit', 'JOGGERS-KNIT-34-BLACK', '34', 'Чёрный', '#1c1c1e'),
  ('joggers-knit', 'JOGGERS-KNIT-36-GREY', '36', 'Серый', '#9a9a9e'),
  ('joggers-knit', 'JOGGERS-KNIT-36-BLACK', '36', 'Чёрный', '#1c1c1e'),
  ('sneakers-court', 'SNEAKERS-COURT-40-WHITE', '40', 'Белый', '#f5f5f3'),
  ('sneakers-court', 'SNEAKERS-COURT-40-BLACK', '40', 'Чёрный', '#1c1c1e'),
  ('sneakers-court', 'SNEAKERS-COURT-41-WHITE', '41', 'Белый', '#f5f5f3'),
  ('sneakers-court', 'SNEAKERS-COURT-41-BLACK', '41', 'Чёрный', '#1c1c1e'),
  ('sneakers-court', 'SNEAKERS-COURT-42-WHITE', '42', 'Белый', '#f5f5f3'),
  ('sneakers-court', 'SNEAKERS-COURT-42-BLACK', '42', 'Чёрный', '#1c1c1e'),
  ('sneakers-court', 'SNEAKERS-COURT-43-WHITE', '43', 'Белый', '#f5f5f3'),
  ('sneakers-court', 'SNEAKERS-COURT-43-BLACK', '43', 'Чёрный', '#1c1c1e'),
  ('sneakers-court', 'SNEAKERS-COURT-44-WHITE', '44', 'Белый', '#f5f5f3'),
  ('sneakers-court', 'SNEAKERS-COURT-44-BLACK', '44', 'Чёрный', '#1c1c1e'),
  ('sneakers-court', 'SNEAKERS-COURT-45-WHITE', '45', 'Белый', '#f5f5f3'),
  ('sneakers-court', 'SNEAKERS-COURT-45-BLACK', '45', 'Чёрный', '#1c1c1e'),
  ('sneakers-runner', 'SNEAKERS-RUNNER-40-GREY', '40', 'Серый', '#9a9a9e'),
  ('sneakers-runner', 'SNEAKERS-RUNNER-40-NAVY', '40', 'Тёмно-синий', '#1f2a44'),
  ('sneakers-runner', 'SNEAKERS-RUNNER-41-GREY', '41', 'Серый', '#9a9a9e'),
  ('sneakers-runner', 'SNEAKERS-RUNNER-41-NAVY', '41', 'Тёмно-синий', '#1f2a44'),
  ('sneakers-runner', 'SNEAKERS-RUNNER-42-GREY', '42', 'Серый', '#9a9a9e'),
  ('sneakers-runner', 'SNEAKERS-RUNNER-42-NAVY', '42', 'Тёмно-синий', '#1f2a44'),
  ('sneakers-runner', 'SNEAKERS-RUNNER-43-GREY', '43', 'Серый', '#9a9a9e'),
  ('sneakers-runner', 'SNEAKERS-RUNNER-43-NAVY', '43', 'Тёмно-синий', '#1f2a44'),
  ('sneakers-runner', 'SNEAKERS-RUNNER-44-GREY', '44', 'Серый', '#9a9a9e'),
  ('sneakers-runner', 'SNEAKERS-RUNNER-44-NAVY', '44', 'Тёмно-синий', '#1f2a44'),
  ('sneakers-runner', 'SNEAKERS-RUNNER-45-GREY', '45', 'Серый', '#9a9a9e'),
  ('sneakers-runner', 'SNEAKERS-RUNNER-45-NAVY', '45', 'Тёмно-синий', '#1f2a44'),
  ('boots-chelsea', 'BOOTS-CHELSEA-40-BLACK', '40', 'Чёрный', '#1c1c1e'),
  ('boots-chelsea', 'BOOTS-CHELSEA-40-BROWN', '40', 'Коричневый', '#6b4a34'),
  ('boots-chelsea', 'BOOTS-CHELSEA-41-BLACK', '41', 'Чёрный', '#1c1c1e'),
  ('boots-chelsea', 'BOOTS-CHELSEA-41-BROWN', '41', 'Коричневый', '#6b4a34'),
  ('boots-chelsea', 'BOOTS-CHELSEA-42-BLACK', '42', 'Чёрный', '#1c1c1e'),
  ('boots-chelsea', 'BOOTS-CHELSEA-42-BROWN', '42', 'Коричневый', '#6b4a34'),
  ('boots-chelsea', 'BOOTS-CHELSEA-43-BLACK', '43', 'Чёрный', '#1c1c1e'),
  ('boots-chelsea', 'BOOTS-CHELSEA-43-BROWN', '43', 'Коричневый', '#6b4a34'),
  ('boots-chelsea', 'BOOTS-CHELSEA-44-BLACK', '44', 'Чёрный', '#1c1c1e'),
  ('boots-chelsea', 'BOOTS-CHELSEA-44-BROWN', '44', 'Коричневый', '#6b4a34'),
  ('boots-chelsea', 'BOOTS-CHELSEA-45-BLACK', '45', 'Чёрный', '#1c1c1e'),
  ('boots-chelsea', 'BOOTS-CHELSEA-45-BROWN', '45', 'Коричневый', '#6b4a34'),
  ('loafers-leather', 'LOAFERS-LEATHER-40-BROWN', '40', 'Коричневый', '#6b4a34'),
  ('loafers-leather', 'LOAFERS-LEATHER-40-BLACK', '40', 'Чёрный', '#1c1c1e'),
  ('loafers-leather', 'LOAFERS-LEATHER-41-BROWN', '41', 'Коричневый', '#6b4a34'),
  ('loafers-leather', 'LOAFERS-LEATHER-41-BLACK', '41', 'Чёрный', '#1c1c1e'),
  ('loafers-leather', 'LOAFERS-LEATHER-42-BROWN', '42', 'Коричневый', '#6b4a34'),
  ('loafers-leather', 'LOAFERS-LEATHER-42-BLACK', '42', 'Чёрный', '#1c1c1e'),
  ('loafers-leather', 'LOAFERS-LEATHER-43-BROWN', '43', 'Коричневый', '#6b4a34'),
  ('loafers-leather', 'LOAFERS-LEATHER-43-BLACK', '43', 'Чёрный', '#1c1c1e'),
  ('loafers-leather', 'LOAFERS-LEATHER-44-BROWN', '44', 'Коричневый', '#6b4a34'),
  ('loafers-leather', 'LOAFERS-LEATHER-44-BLACK', '44', 'Чёрный', '#1c1c1e'),
  ('loafers-leather', 'LOAFERS-LEATHER-45-BROWN', '45', 'Коричневый', '#6b4a34'),
  ('loafers-leather', 'LOAFERS-LEATHER-45-BLACK', '45', 'Чёрный', '#1c1c1e'),
  ('sneakers-high', 'SNEAKERS-HIGH-40-BLACK', '40', 'Чёрный', '#1c1c1e'),
  ('sneakers-high', 'SNEAKERS-HIGH-40-WHITE', '40', 'Белый', '#f5f5f3'),
  ('sneakers-high', 'SNEAKERS-HIGH-41-BLACK', '41', 'Чёрный', '#1c1c1e'),
  ('sneakers-high', 'SNEAKERS-HIGH-41-WHITE', '41', 'Белый', '#f5f5f3'),
  ('sneakers-high', 'SNEAKERS-HIGH-42-BLACK', '42', 'Чёрный', '#1c1c1e'),
  ('sneakers-high', 'SNEAKERS-HIGH-42-WHITE', '42', 'Белый', '#f5f5f3'),
  ('sneakers-high', 'SNEAKERS-HIGH-43-BLACK', '43', 'Чёрный', '#1c1c1e'),
  ('sneakers-high', 'SNEAKERS-HIGH-43-WHITE', '43', 'Белый', '#f5f5f3'),
  ('sneakers-high', 'SNEAKERS-HIGH-44-BLACK', '44', 'Чёрный', '#1c1c1e'),
  ('sneakers-high', 'SNEAKERS-HIGH-44-WHITE', '44', 'Белый', '#f5f5f3'),
  ('sneakers-high', 'SNEAKERS-HIGH-45-BLACK', '45', 'Чёрный', '#1c1c1e'),
  ('sneakers-high', 'SNEAKERS-HIGH-45-WHITE', '45', 'Белый', '#f5f5f3'),
  ('backpack-daily', 'BACKPACK-DAILY--BLACK', 'Один размер', 'Чёрный', '#1c1c1e'),
  ('backpack-daily', 'BACKPACK-DAILY--OLIVE', 'Один размер', 'Оливковый', '#5b6140'),
  ('tote-canvas', 'TOTE-CANVAS--BEIGE', 'Один размер', 'Бежевый', '#d8c9b0'),
  ('tote-canvas', 'TOTE-CANVAS--BLACK', 'Один размер', 'Чёрный', '#1c1c1e'),
  ('watch-minimal', 'WATCH-MINIMAL--BLACK', 'Один размер', 'Чёрный', '#1c1c1e'),
  ('watch-minimal', 'WATCH-MINIMAL--GREY', 'Один размер', 'Серый', '#9a9a9e'),
  ('sunglasses-round', 'SUNGLASSES-ROUND--BLACK', 'Один размер', 'Чёрный', '#1c1c1e'),
  ('sunglasses-round', 'SUNGLASSES-ROUND--BROWN', 'Один размер', 'Коричневый', '#6b4a34'),
  ('belt-leather', 'BELT-LEATHER--BROWN', 'Один размер', 'Коричневый', '#6b4a34'),
  ('belt-leather', 'BELT-LEATHER--BLACK', 'Один размер', 'Чёрный', '#1c1c1e'),
  ('scarf-wool', 'SCARF-WOOL--GREY', 'Один размер', 'Серый', '#9a9a9e'),
  ('scarf-wool', 'SCARF-WOOL--NAVY', 'Один размер', 'Тёмно-синий', '#1f2a44'),
  ('scarf-wool', 'SCARF-WOOL--BEIGE', 'Один размер', 'Бежевый', '#d8c9b0'),
  ('cap-classic', 'CAP-CLASSIC--BLACK', 'Один размер', 'Чёрный', '#1c1c1e'),
  ('cap-classic', 'CAP-CLASSIC--OLIVE', 'Один размер', 'Оливковый', '#5b6140'),
  ('cap-classic', 'CAP-CLASSIC--BEIGE', 'Один размер', 'Бежевый', '#d8c9b0')
) as v(slug, sku, size, color, hex) join public.products p on p.slug = v.slug
on conflict (sku) do nothing;

insert into public.inventory (variant_id, quantity)
select pv.id, v.qty from (values
  ('BASIC-TEE-HEAVY-XS-WHITE', 17),
  ('BASIC-TEE-HEAVY-XS-BLACK', 6),
  ('BASIC-TEE-HEAVY-XS-GREY', 22),
  ('BASIC-TEE-HEAVY-S-WHITE', 19),
  ('BASIC-TEE-HEAVY-S-BLACK', 8),
  ('BASIC-TEE-HEAVY-S-GREY', 23),
  ('BASIC-TEE-HEAVY-M-WHITE', 25),
  ('BASIC-TEE-HEAVY-M-BLACK', 14),
  ('BASIC-TEE-HEAVY-M-GREY', 17),
  ('BASIC-TEE-HEAVY-L-WHITE', 19),
  ('BASIC-TEE-HEAVY-L-BLACK', 8),
  ('BASIC-TEE-HEAVY-L-GREY', 16),
  ('BASIC-TEE-HEAVY-XL-WHITE', 17),
  ('BASIC-TEE-HEAVY-XL-BLACK', 6),
  ('BASIC-TEE-HEAVY-XL-GREY', 15),
  ('ESSENTIAL-TEE-SLIM-XS-BLACK', 10),
  ('ESSENTIAL-TEE-SLIM-XS-NAVY', 6),
  ('ESSENTIAL-TEE-SLIM-XS-OLIVE', 4),
  ('ESSENTIAL-TEE-SLIM-S-BLACK', 15),
  ('ESSENTIAL-TEE-SLIM-S-NAVY', 21),
  ('ESSENTIAL-TEE-SLIM-S-OLIVE', 0),
  ('ESSENTIAL-TEE-SLIM-M-BLACK', 25),
  ('ESSENTIAL-TEE-SLIM-M-NAVY', 15),
  ('ESSENTIAL-TEE-SLIM-M-OLIVE', 19),
  ('ESSENTIAL-TEE-SLIM-L-BLACK', 15),
  ('ESSENTIAL-TEE-SLIM-L-NAVY', 14),
  ('ESSENTIAL-TEE-SLIM-L-OLIVE', 9),
  ('ESSENTIAL-TEE-SLIM-XL-BLACK', 10),
  ('ESSENTIAL-TEE-SLIM-XL-NAVY', 24),
  ('ESSENTIAL-TEE-SLIM-XL-OLIVE', 0),
  ('LINEN-SHIRT-XS-WHITE', 23),
  ('LINEN-SHIRT-XS-BLUE', 22),
  ('LINEN-SHIRT-XS-BEIGE', 6),
  ('LINEN-SHIRT-S-WHITE', 14),
  ('LINEN-SHIRT-S-BLUE', 4),
  ('LINEN-SHIRT-S-BEIGE', 22),
  ('LINEN-SHIRT-M-WHITE', 24),
  ('LINEN-SHIRT-M-BLUE', 23),
  ('LINEN-SHIRT-M-BEIGE', 7),
  ('LINEN-SHIRT-L-WHITE', 18),
  ('LINEN-SHIRT-L-BLUE', 22),
  ('LINEN-SHIRT-L-BEIGE', 1),
  ('LINEN-SHIRT-XL-WHITE', 0),
  ('LINEN-SHIRT-XL-BLUE', 15),
  ('LINEN-SHIRT-XL-BEIGE', 10),
  ('OXFORD-SHIRT-XS-WHITE', 22),
  ('OXFORD-SHIRT-XS-BLUE', 24),
  ('OXFORD-SHIRT-S-WHITE', 16),
  ('OXFORD-SHIRT-S-BLUE', 3),
  ('OXFORD-SHIRT-M-WHITE', 0),
  ('OXFORD-SHIRT-M-BLUE', 22),
  ('OXFORD-SHIRT-L-WHITE', 20),
  ('OXFORD-SHIRT-L-BLUE', 21),
  ('OXFORD-SHIRT-XL-WHITE', 22),
  ('OXFORD-SHIRT-XL-BLUE', 17),
  ('POLO-KNIT-XS-NAVY', 25),
  ('POLO-KNIT-XS-WHITE', 19),
  ('POLO-KNIT-XS-OLIVE', 2),
  ('POLO-KNIT-S-NAVY', 15),
  ('POLO-KNIT-S-WHITE', 20),
  ('POLO-KNIT-S-OLIVE', 0),
  ('POLO-KNIT-M-NAVY', 9),
  ('POLO-KNIT-M-WHITE', 1),
  ('POLO-KNIT-M-OLIVE', 0),
  ('POLO-KNIT-L-NAVY', 8),
  ('POLO-KNIT-L-WHITE', 20),
  ('POLO-KNIT-L-OLIVE', 3),
  ('POLO-KNIT-XL-NAVY', 18),
  ('POLO-KNIT-XL-WHITE', 19),
  ('POLO-KNIT-XL-OLIVE', 0),
  ('LONG-SLEEVE-XS-GREY', 15),
  ('LONG-SLEEVE-XS-BLACK', 15),
  ('LONG-SLEEVE-S-GREY', 8),
  ('LONG-SLEEVE-S-BLACK', 22),
  ('LONG-SLEEVE-M-GREY', 2),
  ('LONG-SLEEVE-M-BLACK', 7),
  ('LONG-SLEEVE-L-GREY', 1),
  ('LONG-SLEEVE-L-BLACK', 1),
  ('LONG-SLEEVE-XL-GREY', 8),
  ('LONG-SLEEVE-XL-BLACK', 15),
  ('BOMBER-CORE-XS-BLACK', 24),
  ('BOMBER-CORE-XS-OLIVE', 18),
  ('BOMBER-CORE-S-BLACK', 6),
  ('BOMBER-CORE-S-OLIVE', 25),
  ('BOMBER-CORE-M-BLACK', 16),
  ('BOMBER-CORE-M-OLIVE', 10),
  ('BOMBER-CORE-L-BLACK', 10),
  ('BOMBER-CORE-L-OLIVE', 0),
  ('BOMBER-CORE-XL-BLACK', 24),
  ('BOMBER-CORE-XL-OLIVE', 18),
  ('TRENCH-CITY-XS-BEIGE', 17),
  ('TRENCH-CITY-XS-NAVY', 24),
  ('TRENCH-CITY-S-BEIGE', 2),
  ('TRENCH-CITY-S-NAVY', 6),
  ('TRENCH-CITY-M-BEIGE', 8),
  ('TRENCH-CITY-M-NAVY', 25),
  ('TRENCH-CITY-L-BEIGE', 2),
  ('TRENCH-CITY-L-NAVY', 24),
  ('TRENCH-CITY-XL-BEIGE', 17),
  ('TRENCH-CITY-XL-NAVY', 17),
  ('BLAZER-SOFT-XS-GRAPHITE', 1),
  ('BLAZER-SOFT-XS-NAVY', 19),
  ('BLAZER-SOFT-S-GRAPHITE', 5),
  ('BLAZER-SOFT-S-NAVY', 19),
  ('BLAZER-SOFT-M-GRAPHITE', 0),
  ('BLAZER-SOFT-M-NAVY', 13),
  ('BLAZER-SOFT-L-GRAPHITE', 15),
  ('BLAZER-SOFT-L-NAVY', 12),
  ('BLAZER-SOFT-XL-GRAPHITE', 11),
  ('BLAZER-SOFT-XL-NAVY', 12),
  ('PUFFER-LIGHT-XS-BLACK', 11),
  ('PUFFER-LIGHT-XS-GREY', 21),
  ('PUFFER-LIGHT-XS-OLIVE', 0),
  ('PUFFER-LIGHT-S-BLACK', 0),
  ('PUFFER-LIGHT-S-GREY', 6),
  ('PUFFER-LIGHT-S-OLIVE', 1),
  ('PUFFER-LIGHT-M-BLACK', 17),
  ('PUFFER-LIGHT-M-GREY', 25),
  ('PUFFER-LIGHT-M-OLIVE', 11),
  ('PUFFER-LIGHT-L-BLACK', 11),
  ('PUFFER-LIGHT-L-GREY', 24),
  ('PUFFER-LIGHT-L-OLIVE', 5),
  ('PUFFER-LIGHT-XL-BLACK', 15),
  ('PUFFER-LIGHT-XL-GREY', 14),
  ('PUFFER-LIGHT-XL-OLIVE', 9),
  ('DENIM-JACKET-XS-BLUE', 12),
  ('DENIM-JACKET-XS-BLACK', 0),
  ('DENIM-JACKET-S-BLUE', 3),
  ('DENIM-JACKET-S-BLACK', 18),
  ('DENIM-JACKET-M-BLUE', 22),
  ('DENIM-JACKET-M-BLACK', 3),
  ('DENIM-JACKET-L-BLUE', 21),
  ('DENIM-JACKET-L-BLACK', 22),
  ('DENIM-JACKET-XL-BLUE', 5),
  ('DENIM-JACKET-XL-BLACK', 14),
  ('COAT-WOOL-XS-GRAPHITE', 25),
  ('COAT-WOOL-XS-BEIGE', 16),
  ('COAT-WOOL-S-GRAPHITE', 18),
  ('COAT-WOOL-S-BEIGE', 12),
  ('COAT-WOOL-M-GRAPHITE', 23),
  ('COAT-WOOL-M-BEIGE', 22),
  ('COAT-WOOL-L-GRAPHITE', 0),
  ('COAT-WOOL-L-BEIGE', 16),
  ('COAT-WOOL-XL-GRAPHITE', 10),
  ('COAT-WOOL-XL-BEIGE', 20),
  ('KNIT-CREW-XS-GREY', 7),
  ('KNIT-CREW-XS-NAVY', 0),
  ('KNIT-CREW-XS-BEIGE', 19),
  ('KNIT-CREW-S-GREY', 16),
  ('KNIT-CREW-S-NAVY', 18),
  ('KNIT-CREW-S-BEIGE', 12),
  ('KNIT-CREW-M-GREY', 6),
  ('KNIT-CREW-M-NAVY', 8),
  ('KNIT-CREW-M-BEIGE', 18),
  ('KNIT-CREW-L-GREY', 0),
  ('KNIT-CREW-L-NAVY', 7),
  ('KNIT-CREW-L-BEIGE', 0),
  ('KNIT-CREW-XL-GREY', 25),
  ('KNIT-CREW-XL-NAVY', 2),
  ('KNIT-CREW-XL-BEIGE', 23),
  ('HOODIE-OVERSIZE-XS-BLACK', 10),
  ('HOODIE-OVERSIZE-XS-GREY', 0),
  ('HOODIE-OVERSIZE-XS-OLIVE', 0),
  ('HOODIE-OVERSIZE-S-BLACK', 19),
  ('HOODIE-OVERSIZE-S-GREY', 9),
  ('HOODIE-OVERSIZE-S-OLIVE', 13),
  ('HOODIE-OVERSIZE-M-BLACK', 25),
  ('HOODIE-OVERSIZE-M-GREY', 3),
  ('HOODIE-OVERSIZE-M-OLIVE', 19),
  ('HOODIE-OVERSIZE-L-BLACK', 19),
  ('HOODIE-OVERSIZE-L-GREY', 2),
  ('HOODIE-OVERSIZE-L-OLIVE', 13),
  ('HOODIE-OVERSIZE-XL-BLACK', 14),
  ('HOODIE-OVERSIZE-XL-GREY', 1),
  ('HOODIE-OVERSIZE-XL-OLIVE', 8),
  ('CARDIGAN-RIB-XS-BEIGE', 14),
  ('CARDIGAN-RIB-XS-GRAPHITE', 14),
  ('CARDIGAN-RIB-S-BEIGE', 0),
  ('CARDIGAN-RIB-S-GRAPHITE', 5),
  ('CARDIGAN-RIB-M-BEIGE', 16),
  ('CARDIGAN-RIB-M-GRAPHITE', 0),
  ('CARDIGAN-RIB-L-BEIGE', 10),
  ('CARDIGAN-RIB-L-GRAPHITE', 15),
  ('CARDIGAN-RIB-XL-BEIGE', 14),
  ('CARDIGAN-RIB-XL-GRAPHITE', 3),
  ('TURTLENECK-XS-BLACK', 0),
  ('TURTLENECK-XS-WHITE', 20),
  ('TURTLENECK-S-BLACK', 13),
  ('TURTLENECK-S-WHITE', 24),
  ('TURTLENECK-M-BLACK', 23),
  ('TURTLENECK-M-WHITE', 9),
  ('TURTLENECK-L-BLACK', 17),
  ('TURTLENECK-L-WHITE', 3),
  ('TURTLENECK-XL-BLACK', 9),
  ('TURTLENECK-XL-WHITE', 20),
  ('SWEATSHIRT-ZIP-XS-GREY', 9),
  ('SWEATSHIRT-ZIP-XS-NAVY', 11),
  ('SWEATSHIRT-ZIP-S-GREY', 3),
  ('SWEATSHIRT-ZIP-S-NAVY', 0),
  ('SWEATSHIRT-ZIP-M-GREY', 22),
  ('SWEATSHIRT-ZIP-M-NAVY', 24),
  ('SWEATSHIRT-ZIP-L-GREY', 21),
  ('SWEATSHIRT-ZIP-L-NAVY', 23),
  ('SWEATSHIRT-ZIP-XL-GREY', 2),
  ('SWEATSHIRT-ZIP-XL-NAVY', 0),
  ('JEANS-STRAIGHT-28-BLUE', 0),
  ('JEANS-STRAIGHT-28-BLACK', 15),
  ('JEANS-STRAIGHT-30-BLUE', 6),
  ('JEANS-STRAIGHT-30-BLACK', 23),
  ('JEANS-STRAIGHT-32-BLUE', 8),
  ('JEANS-STRAIGHT-32-BLACK', 10),
  ('JEANS-STRAIGHT-34-BLUE', 10),
  ('JEANS-STRAIGHT-34-BLACK', 22),
  ('JEANS-STRAIGHT-36-BLUE', 12),
  ('JEANS-STRAIGHT-36-BLACK', 13),
  ('CHINO-SLIM-28-BEIGE', 18),
  ('CHINO-SLIM-28-OLIVE', 18),
  ('CHINO-SLIM-28-NAVY', 3),
  ('CHINO-SLIM-30-BEIGE', 1),
  ('CHINO-SLIM-30-OLIVE', 0),
  ('CHINO-SLIM-30-NAVY', 1),
  ('CHINO-SLIM-32-BEIGE', 13),
  ('CHINO-SLIM-32-OLIVE', 13),
  ('CHINO-SLIM-32-NAVY', 3),
  ('CHINO-SLIM-34-BEIGE', 25),
  ('CHINO-SLIM-34-OLIVE', 25),
  ('CHINO-SLIM-34-NAVY', 5),
  ('CHINO-SLIM-36-BEIGE', 16),
  ('CHINO-SLIM-36-OLIVE', 16),
  ('CHINO-SLIM-36-NAVY', 7),
  ('TROUSERS-PLEATED-28-GRAPHITE', 12),
  ('TROUSERS-PLEATED-28-BEIGE', 0),
  ('TROUSERS-PLEATED-30-GRAPHITE', 18),
  ('TROUSERS-PLEATED-30-BEIGE', 15),
  ('TROUSERS-PLEATED-32-GRAPHITE', 4),
  ('TROUSERS-PLEATED-32-BEIGE', 2),
  ('TROUSERS-PLEATED-34-GRAPHITE', 19),
  ('TROUSERS-PLEATED-34-BEIGE', 14),
  ('TROUSERS-PLEATED-36-GRAPHITE', 9),
  ('TROUSERS-PLEATED-36-BEIGE', 5),
  ('CARGO-RELAXED-28-OLIVE', 12),
  ('CARGO-RELAXED-28-BLACK', 18),
  ('CARGO-RELAXED-30-OLIVE', 20),
  ('CARGO-RELAXED-30-BLACK', 1),
  ('CARGO-RELAXED-32-OLIVE', 7),
  ('CARGO-RELAXED-32-BLACK', 13),
  ('CARGO-RELAXED-34-OLIVE', 23),
  ('CARGO-RELAXED-34-BLACK', 4),
  ('CARGO-RELAXED-36-OLIVE', 10),
  ('CARGO-RELAXED-36-BLACK', 16),
  ('JOGGERS-KNIT-28-GREY', 4),
  ('JOGGERS-KNIT-28-BLACK', 3),
  ('JOGGERS-KNIT-30-GREY', 2),
  ('JOGGERS-KNIT-30-BLACK', 11),
  ('JOGGERS-KNIT-32-GREY', 4),
  ('JOGGERS-KNIT-32-BLACK', 23),
  ('JOGGERS-KNIT-34-GREY', 6),
  ('JOGGERS-KNIT-34-BLACK', 10),
  ('JOGGERS-KNIT-36-GREY', 8),
  ('JOGGERS-KNIT-36-BLACK', 1),
  ('SNEAKERS-COURT-40-WHITE', 13),
  ('SNEAKERS-COURT-40-BLACK', 2),
  ('SNEAKERS-COURT-41-WHITE', 19),
  ('SNEAKERS-COURT-41-BLACK', 8),
  ('SNEAKERS-COURT-42-WHITE', 4),
  ('SNEAKERS-COURT-42-BLACK', 18),
  ('SNEAKERS-COURT-43-WHITE', 0),
  ('SNEAKERS-COURT-43-BLACK', 24),
  ('SNEAKERS-COURT-44-WHITE', 16),
  ('SNEAKERS-COURT-44-BLACK', 0),
  ('SNEAKERS-COURT-45-WHITE', 22),
  ('SNEAKERS-COURT-45-BLACK', 11),
  ('SNEAKERS-RUNNER-40-GREY', 13),
  ('SNEAKERS-RUNNER-40-NAVY', 15),
  ('SNEAKERS-RUNNER-41-GREY', 14),
  ('SNEAKERS-RUNNER-41-NAVY', 16),
  ('SNEAKERS-RUNNER-42-GREY', 15),
  ('SNEAKERS-RUNNER-42-NAVY', 17),
  ('SNEAKERS-RUNNER-43-GREY', 16),
  ('SNEAKERS-RUNNER-43-NAVY', 18),
  ('SNEAKERS-RUNNER-44-GREY', 17),
  ('SNEAKERS-RUNNER-44-NAVY', 19),
  ('SNEAKERS-RUNNER-45-GREY', 18),
  ('SNEAKERS-RUNNER-45-NAVY', 20),
  ('BOOTS-CHELSEA-40-BLACK', 1),
  ('BOOTS-CHELSEA-40-BROWN', 24),
  ('BOOTS-CHELSEA-41-BLACK', 7),
  ('BOOTS-CHELSEA-41-BROWN', 5),
  ('BOOTS-CHELSEA-42-BLACK', 13),
  ('BOOTS-CHELSEA-42-BROWN', 11),
  ('BOOTS-CHELSEA-43-BLACK', 23),
  ('BOOTS-CHELSEA-43-BROWN', 21),
  ('BOOTS-CHELSEA-44-BLACK', 0),
  ('BOOTS-CHELSEA-44-BROWN', 2),
  ('BOOTS-CHELSEA-45-BLACK', 10),
  ('BOOTS-CHELSEA-45-BROWN', 0),
  ('LOAFERS-LEATHER-40-BROWN', 2),
  ('LOAFERS-LEATHER-40-BLACK', 4),
  ('LOAFERS-LEATHER-41-BROWN', 12),
  ('LOAFERS-LEATHER-41-BLACK', 14),
  ('LOAFERS-LEATHER-42-BROWN', 18),
  ('LOAFERS-LEATHER-42-BLACK', 20),
  ('LOAFERS-LEATHER-43-BROWN', 24),
  ('LOAFERS-LEATHER-43-BLACK', 1),
  ('LOAFERS-LEATHER-44-BROWN', 5),
  ('LOAFERS-LEATHER-44-BLACK', 7),
  ('LOAFERS-LEATHER-45-BROWN', 11),
  ('LOAFERS-LEATHER-45-BLACK', 13),
  ('SNEAKERS-HIGH-40-BLACK', 20),
  ('SNEAKERS-HIGH-40-WHITE', 6),
  ('SNEAKERS-HIGH-41-BLACK', 1),
  ('SNEAKERS-HIGH-41-WHITE', 12),
  ('SNEAKERS-HIGH-42-BLACK', 7),
  ('SNEAKERS-HIGH-42-WHITE', 18),
  ('SNEAKERS-HIGH-43-BLACK', 13),
  ('SNEAKERS-HIGH-43-WHITE', 24),
  ('SNEAKERS-HIGH-44-BLACK', 23),
  ('SNEAKERS-HIGH-44-WHITE', 9),
  ('SNEAKERS-HIGH-45-BLACK', 4),
  ('SNEAKERS-HIGH-45-WHITE', 15),
  ('BACKPACK-DAILY--BLACK', 8),
  ('BACKPACK-DAILY--OLIVE', 2),
  ('TOTE-CANVAS--BEIGE', 21),
  ('TOTE-CANVAS--BLACK', 0),
  ('WATCH-MINIMAL--BLACK', 0),
  ('WATCH-MINIMAL--GREY', 0),
  ('SUNGLASSES-ROUND--BLACK', 16),
  ('SUNGLASSES-ROUND--BROWN', 14),
  ('BELT-LEATHER--BROWN', 10),
  ('BELT-LEATHER--BLACK', 12),
  ('SCARF-WOOL--GREY', 17),
  ('SCARF-WOOL--NAVY', 19),
  ('SCARF-WOOL--BEIGE', 2),
  ('CAP-CLASSIC--BLACK', 13),
  ('CAP-CLASSIC--OLIVE', 7),
  ('CAP-CLASSIC--BEIGE', 7)
) as v(sku, qty) join public.product_variants pv on pv.sku = v.sku
on conflict (variant_id) do nothing;

insert into public.promo_codes (code, description, discount_percent, discount_amount, min_order_total, max_uses, expires_at) values
  ('WELCOME10', 'Скидка 10% на первый заказ от 3 000 ₽', 10, null, 3000, null, null),
  ('SPRING500', 'Скидка 500 ₽ на заказ от 5 000 ₽', null, 500, 5000, 200, null),
  ('VIP20', 'Скидка 20% для постоянных клиентов', 20, null, 8000, 50, null)
on conflict (code) do nothing;
