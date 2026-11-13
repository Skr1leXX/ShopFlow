-- ShopFlow на SQLite (Turso / libSQL). Деньги хранятся числами в рублях, время — строкой ISO 8601 (UTC),
-- логические значения — 0/1. Идентификаторы выдаёт приложение (UUID); значение по умолчанию нужно только для ручных вставок.
-- Прав доступа на уровне строк в SQLite нет: все запросы идут с сервера приложения, который проверяет сессию и роль (src/lib/auth.ts).

create table profiles (
  id            text primary key default (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
  email         text not null unique collate nocase,
  password_hash text not null,                       -- scrypt с солью; пароль в открытом виде не хранится
  full_name     text not null default '',
  phone         text check (phone is null or length(phone) between 5 and 24),
  role          text not null default 'customer' check (role in ('customer', 'admin')),
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Сессии: в БД лежит только sha256 токена, сам токен есть лишь в httpOnly cookie пользователя.
create table sessions (
  token_hash text primary key,
  user_id    text not null references profiles (id) on delete cascade,
  expires_at text not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index sessions_user_idx on sessions (user_id);

create table categories (
  id          text primary key default (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
  slug        text not null unique,
  name        text not null check (length(name) between 1 and 80),
  description text not null default '',
  image_url   text,
  sort_order  integer not null default 0,
  is_active   integer not null default 1 check (is_active in (0, 1)),
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create table products (
  id          text primary key default (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
  slug        text not null unique,
  name        text not null check (length(name) between 1 and 160),
  brand       text not null check (length(brand) between 1 and 80),
  description text not null default '',
  details     text not null default '{}',            -- JSON: материал, уход, артикул
  search      text not null default '',              -- имя + бренд + описание в нижнем регистре (SQLite не понижает регистр кириллицы)
  category_id text not null references categories (id) on delete restrict,
  price       real not null check (price >= 0),
  old_price   real check (old_price is null or old_price > price),
  is_featured integer not null default 0 check (is_featured in (0, 1)),
  is_new      integer not null default 0 check (is_new in (0, 1)),
  is_active   integer not null default 1 check (is_active in (0, 1)),
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index products_category_idx on products (category_id);
create index products_brand_idx on products (brand);
create index products_price_idx on products (price);
create index products_created_idx on products (created_at desc);

create table product_images (
  id           text primary key default (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
  product_id   text not null references products (id) on delete cascade,
  url          text not null,
  storage_path text,                                 -- URL файла в Vercel Blob, если фото загружено через админку (внешние ссылки — null)
  alt          text not null default '',
  sort_order   integer not null default 0,
  created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index product_images_product_idx on product_images (product_id, sort_order);

create table product_variants (
  id         text primary key default (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
  product_id text not null references products (id) on delete cascade,
  sku        text not null unique,
  size       text not null,
  color      text not null,
  color_hex  text not null check (length(color_hex) = 7 and substr(color_hex, 1, 1) = '#'),
  is_active  integer not null default 1 check (is_active in (0, 1)),
  unique (product_id, size, color)
);
create index product_variants_product_idx on product_variants (product_id);

create table inventory (
  variant_id text primary key references product_variants (id) on delete cascade,
  quantity   integer not null default 0 check (quantity >= 0),   -- отрицательный остаток невозможен на уровне БД
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Журнал движения склада: пишется только кодом приложения внутри той же транзакции, что и изменение остатка.
create table inventory_movements (
  id         text primary key default (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
  variant_id text not null references product_variants (id) on delete cascade,
  delta      integer not null check (delta <> 0),
  balance    integer not null check (balance >= 0),
  reason     text not null check (reason in ('receipt', 'writeoff', 'adjustment', 'sale', 'return')),
  note       text not null default '',
  order_id   text,
  created_by text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index inventory_movements_variant_idx on inventory_movements (variant_id, created_at desc);
create index inventory_movements_created_idx on inventory_movements (created_at desc);

create table addresses (
  id          text primary key default (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
  user_id     text not null references profiles (id) on delete cascade,
  label       text not null default 'Дом',
  recipient   text not null,
  phone       text not null,
  city        text not null,
  street      text not null,
  postal_code text not null,
  is_default  integer not null default 0 check (is_default in (0, 1)),
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index addresses_user_idx on addresses (user_id);
create unique index addresses_one_default on addresses (user_id) where is_default = 1;

create table cart_items (
  id         text primary key default (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
  user_id    text not null references profiles (id) on delete cascade,
  variant_id text not null references product_variants (id) on delete cascade,
  quantity   integer not null check (quantity between 1 and 99),
  unique (user_id, variant_id)
);

create table favorites (
  user_id    text not null references profiles (id) on delete cascade,
  product_id text not null references products (id) on delete cascade,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  primary key (user_id, product_id)
);

create table promo_codes (
  id               text primary key default (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
  code             text not null unique check (code = upper(code) and length(code) between 3 and 32),
  description      text not null default '',
  discount_percent integer check (discount_percent between 1 and 90),
  discount_amount  real check (discount_amount > 0),
  min_order_total  real not null default 0 check (min_order_total >= 0),
  max_uses         integer check (max_uses > 0),
  used_count       integer not null default 0 check (used_count >= 0),
  expires_at       text,
  is_active        integer not null default 1 check (is_active in (0, 1)),
  created_at       text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  check ((discount_percent is null) <> (discount_amount is null))
);

create table orders (
  id               text primary key default (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
  number           integer not null unique,
  user_id          text not null references profiles (id) on delete restrict,
  status           text not null default 'pending' check (status in ('pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled')),
  subtotal         real not null check (subtotal >= 0),
  discount         real not null default 0 check (discount >= 0),
  shipping         real not null default 0 check (shipping >= 0),
  total            real not null check (total >= 0),
  promo_code_id    text references promo_codes (id) on delete set null,
  contact_name     text not null,
  contact_email    text not null,
  contact_phone    text not null,
  delivery_method  text not null check (delivery_method in ('courier', 'pickup', 'post')),
  payment_method   text not null check (payment_method in ('card', 'cash', 'invoice')),
  shipping_address text not null default '{}',       -- JSON: снимок адреса на момент заказа
  comment          text not null default '',
  idempotency_key  text,
  created_at       text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index orders_user_idx on orders (user_id, created_at desc);
create index orders_status_idx on orders (status);
-- Повторная отправка той же формы не создаст второй заказ.
create unique index orders_idempotency on orders (user_id, idempotency_key) where idempotency_key is not null;

create table order_items (
  id           text primary key default (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
  order_id     text not null references orders (id) on delete cascade,
  variant_id   text references product_variants (id) on delete set null,
  product_id   text references products (id) on delete set null,
  product_name text not null,
  size         text not null,
  color        text not null,
  image_url    text,
  unit_price   real not null check (unit_price >= 0),
  quantity     integer not null check (quantity > 0)
);
create index order_items_order_idx on order_items (order_id);
