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
