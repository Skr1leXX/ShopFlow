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
