// Генерирует db/seed.sql (SQLite) из данных ниже: node scripts/gen-seed.mjs
// Демо-пользователи и заказы создаются отдельно (scripts/seed-demo.mjs).
import fs from "node:fs";
import { createHash } from "node:crypto";

const U = (id) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1200&q=80`;
const q = (s) => `'${String(s).replaceAll("'", "''")}'`;

const categories = [
  ["tshirts", "Футболки и рубашки", "Базовые вещи из плотного хлопка и льна.", "1521572163474-6864f9cf17ab"],
  ["outerwear", "Верхняя одежда", "Куртки, пальто и пиджаки на каждый сезон.", "1551028719-00167b16eac5"],
  ["knitwear", "Трикотаж", "Свитеры, худи и кардиганы из мягких материалов.", "1620799140408-edc6dcb6d633"],
  ["trousers", "Брюки и джинсы", "Прямые, зауженные и свободные силуэты.", "1624378439575-d8705ad7ae80"],
  ["shoes", "Обувь", "Кроссовки, ботинки и лоферы.", "1542291026-7eec264c27ff"],
  ["accessories", "Аксессуары", "Сумки, часы, очки и мелочи, которые завершают образ.", "1553062407-98eeb64c6a62"],
];

const COLORS = {
  black: ["Чёрный", "#1c1c1e"], white: ["Белый", "#f5f5f3"], graphite: ["Графитовый", "#3a3a3d"],
  beige: ["Бежевый", "#d8c9b0"], navy: ["Тёмно-синий", "#1f2a44"], olive: ["Оливковый", "#5b6140"],
  grey: ["Серый", "#9a9a9e"], brown: ["Коричневый", "#6b4a34"], blue: ["Голубой", "#4a6fa5"],
};
const SIZES = {
  clothes: ["XS", "S", "M", "L", "XL"],
  pants: ["28", "30", "32", "34", "36"],
  shoes: ["40", "41", "42", "43", "44", "45"],
  one: ["Один размер"],
};

// slug, название, бренд, категория, цена, старая цена, набор размеров, цвета, фото, new, featured, описание, [материал, уход]
const P = [
  ["basic-tee-heavy", "Футболка Heavy Cotton", "Northline", "tshirts", 2490, null, "clothes", ["white", "black", "grey"], ["1521572163474-6864f9cf17ab", "1583743814966-8936f5b7be1a"], 0, 1, "Плотная футболка свободного кроя из 100% хлопка 220 г/м².", ["100% хлопок", "Стирка 30°C"]],
  ["essential-tee-slim", "Футболка Essential Slim", "Northline", "tshirts", 1890, null, "clothes", ["black", "navy", "olive"], ["1576566588028-4147f3842f27", "1503342217505-b0a15ec3261c"], 1, 0, "Приталенная футболка из пимы-хлопка с мягкой фактурой.", ["Пима-хлопок", "Стирка 30°C"]],
  ["linen-shirt", "Рубашка Linen Day", "Atelier 21", "tshirts", 5290, 6490, "clothes", ["white", "blue", "beige"], ["1596755094514-f87e34085b2c", "1556905055-8f358a7a47b2"], 0, 1, "Лёгкая льняная рубашка прямого кроя для тёплого сезона.", ["100% лён", "Деликатная стирка"]],
  ["oxford-shirt", "Рубашка Oxford Classic", "Atelier 21", "tshirts", 4590, null, "clothes", ["white", "blue"], ["1556905055-8f358a7a47b2", "1596755094514-f87e34085b2c"], 0, 0, "Классическая оксфордская рубашка с воротником button-down.", ["Хлопок оксфорд", "Стирка 40°C"]],
  ["polo-knit", "Поло Piqué", "Northline", "tshirts", 3290, null, "clothes", ["navy", "white", "olive"], ["1583743814966-8936f5b7be1a", "1521572163474-6864f9cf17ab"], 1, 0, "Поло из хлопкового пике с аккуратным воротником.", ["Хлопок пике", "Стирка 30°C"]],
  ["long-sleeve", "Лонгслив Raw", "Mono Studio", "tshirts", 2790, 3490, "clothes", ["grey", "black"], ["1503342217505-b0a15ec3261c", "1576566588028-4147f3842f27"], 0, 0, "Лонгслив с мягкой резинкой на манжетах и чуть удлинённой спинкой.", ["Хлопок с эластаном", "Стирка 30°C"]],
  ["bomber-core", "Бомбер Core", "Northline", "outerwear", 11900, 14900, "clothes", ["black", "olive"], ["1551028719-00167b16eac5", "1591047139829-d91aecb6caea"], 0, 1, "Лёгкий бомбер с трикотажными манжетами и скрытой молнией.", ["Нейлон, подкладка полиэстер", "Деликатная стирка"]],
  ["trench-city", "Тренч City", "Atelier 21", "outerwear", 17900, null, "clothes", ["beige", "navy"], ["1539109136881-3be0616acf4b", "1529374255404-311a2a4f1fd9"], 1, 1, "Классический тренч с поясом и водоотталкивающей пропиткой.", ["Хлопок габардин", "Химчистка"]],
  ["blazer-soft", "Пиджак Soft Tailoring", "Atelier 21", "outerwear", 13900, null, "clothes", ["graphite", "navy"], ["1594938298603-c8148c4dae35", "1591047139829-d91aecb6caea"], 0, 1, "Неструктурированный пиджак с мягким плечом.", ["Шерсть 40%, полиэстер 60%", "Химчистка"]],
  ["puffer-light", "Пуховик Light", "Northline", "outerwear", 15900, 19900, "clothes", ["black", "grey", "olive"], ["1591047139829-d91aecb6caea", "1551028719-00167b16eac5"], 0, 0, "Стёганая куртка с лёгким утеплителем для межсезонья.", ["Нейлон, утеплитель 100 г", "Деликатная стирка"]],
  ["denim-jacket", "Джинсовая куртка Rinse", "Mono Studio", "outerwear", 8900, null, "clothes", ["blue", "black"], ["1529374255404-311a2a4f1fd9", "1539109136881-3be0616acf4b"], 0, 0, "Джинсовая куртка прямого кроя из плотного денима.", ["100% хлопок", "Стирка 30°C"]],
  ["coat-wool", "Пальто Wool Long", "Atelier 21", "outerwear", 24900, 29900, "clothes", ["graphite", "beige"], ["1539109136881-3be0616acf4b", "1594938298603-c8148c4dae35"], 0, 1, "Длинное пальто из шерстяной ткани с потайными пуговицами.", ["Шерсть 70%, кашемир 10%", "Химчистка"]],
  ["knit-crew", "Свитер Merino Crew", "Mono Studio", "knitwear", 6900, null, "clothes", ["grey", "navy", "beige"], ["1620799140408-edc6dcb6d633", "1434389677669-e08b4cac3105"], 1, 1, "Свитер из мериносовой шерсти тонкой вязки.", ["Мериносовая шерсть", "Ручная стирка"]],
  ["hoodie-oversize", "Худи Oversize", "Northline", "knitwear", 5490, 6990, "clothes", ["black", "grey", "olive"], ["1489987707025-afc232f7ea0f", "1485462537746-965f33f7f6a7"], 0, 1, "Худи свободного кроя из футера с начёсом.", ["Хлопок 80%, полиэстер 20%", "Стирка 30°C"]],
  ["cardigan-rib", "Кардиган Rib", "Mono Studio", "knitwear", 7400, null, "clothes", ["beige", "graphite"], ["1434389677669-e08b4cac3105", "1620799140408-edc6dcb6d633"], 0, 0, "Кардиган в резинку на крупных пуговицах.", ["Шерсть 50%, акрил 50%", "Ручная стирка"]],
  ["turtleneck", "Водолазка Fine Knit", "Atelier 21", "knitwear", 4900, null, "clothes", ["black", "white"], ["1485462537746-965f33f7f6a7", "1489987707025-afc232f7ea0f"], 1, 0, "Тонкая водолазка, хорошо носится под пиджак.", ["Вискоза, нейлон", "Деликатная стирка"]],
  ["sweatshirt-zip", "Свитшот на молнии", "Northline", "knitwear", 5900, null, "clothes", ["grey", "navy"], ["1489987707025-afc232f7ea0f", "1434389677669-e08b4cac3105"], 0, 0, "Свитшот с воротником-стойкой и молнией до груди.", ["Хлопок 90%, эластан 10%", "Стирка 30°C"]],
  ["jeans-straight", "Джинсы Straight 01", "Mono Studio", "trousers", 6400, null, "pants", ["blue", "black"], ["1624378439575-d8705ad7ae80", "1515886657613-9f3515b0c78f"], 0, 1, "Прямые джинсы средней посадки из плотного денима.", ["100% хлопок", "Стирка 30°C"]],
  ["chino-slim", "Чиносы Slim", "Northline", "trousers", 4900, 5900, "pants", ["beige", "olive", "navy"], ["1515886657613-9f3515b0c78f", "1523381210434-271e8be1f52b"], 0, 0, "Зауженные чиносы из хлопка с добавлением эластана.", ["Хлопок 97%, эластан 3%", "Стирка 30°C"]],
  ["trousers-pleated", "Брюки со складками", "Atelier 21", "trousers", 7900, null, "pants", ["graphite", "beige"], ["1523381210434-271e8be1f52b", "1624378439575-d8705ad7ae80"], 1, 1, "Свободные брюки со складками и высокой посадкой.", ["Шерсть 35%, полиэстер 65%", "Химчистка"]],
  ["cargo-relaxed", "Карго Relaxed", "Mono Studio", "trousers", 5900, null, "pants", ["olive", "black"], ["1624378439575-d8705ad7ae80", "1515886657613-9f3515b0c78f"], 0, 0, "Свободные карго с боковыми накладными карманами.", ["Хлопок рипстоп", "Стирка 30°C"]],
  ["joggers-knit", "Джоггеры Knit", "Northline", "trousers", 4200, 5200, "pants", ["grey", "black"], ["1523381210434-271e8be1f52b", "1515886657613-9f3515b0c78f"], 0, 0, "Мягкие джоггеры из футера с манжетами.", ["Хлопок 85%, полиэстер 15%", "Стирка 30°C"]],
  ["sneakers-court", "Кроссовки Court", "Stride", "shoes", 9900, null, "shoes", ["white", "black"], ["1542291026-7eec264c27ff", "1549298916-b41d501d3772"], 1, 1, "Минималистичные кожаные кроссовки на вулканизированной подошве.", ["Натуральная кожа", "Протирать влажной тканью"]],
  ["sneakers-runner", "Кроссовки Runner", "Stride", "shoes", 8400, 10900, "shoes", ["grey", "navy"], ["1491553895911-0055eca6402d", "1460353581641-37baddab0fa2"], 0, 1, "Лёгкие беговые кроссовки с амортизирующей подошвой.", ["Текстиль, EVA", "Ручная чистка"]],
  ["boots-chelsea", "Ботинки Chelsea", "Stride", "shoes", 14900, null, "shoes", ["black", "brown"], ["1549298916-b41d501d3772", "1606760227091-3dd870d97f1d"], 0, 0, "Классические челси из гладкой кожи с эластичными вставками.", ["Натуральная кожа", "Крем для кожи"]],
  ["loafers-leather", "Лоферы Leather", "Atelier 21", "shoes", 12900, 15900, "shoes", ["brown", "black"], ["1606760227091-3dd870d97f1d", "1608231387042-66d1773070a5"], 0, 0, "Лоферы из мягкой кожи на сплошной подошве.", ["Натуральная кожа", "Крем для кожи"]],
  ["sneakers-high", "Высокие кеды Hi", "Stride", "shoes", 6900, null, "shoes", ["black", "white"], ["1460353581641-37baddab0fa2", "1542291026-7eec264c27ff"], 1, 0, "Высокие кеды из плотного канваса.", ["Хлопок, резина", "Стирка 30°C"]],
  ["backpack-daily", "Рюкзак Daily", "Northline", "accessories", 6500, null, "one", ["black", "olive"], ["1553062407-98eeb64c6a62", "1548036328-c9fa89d128fa"], 0, 1, "Городской рюкзак на 18 литров с отделением для ноутбука.", ["Нейлон 600D", "Протирать влажной тканью"]],
  ["tote-canvas", "Тоут Canvas", "Mono Studio", "accessories", 2900, null, "one", ["beige", "black"], ["1548036328-c9fa89d128fa", "1553062407-98eeb64c6a62"], 1, 0, "Вместительная сумка-шоппер из плотного хлопка.", ["Хлопок 12 oz", "Стирка 30°C"]],
  ["watch-minimal", "Часы Minimal 38", "Orbit", "accessories", 11900, 13900, "one", ["black", "grey"], ["1523170335258-f5ed11844a49", "1584917865442-de89df76afd3"], 0, 1, "Кварцевые часы с циферблатом 38 мм и кожаным ремешком.", ["Сталь, сапфировое стекло", "Влагозащита 5 ATM"]],
  ["sunglasses-round", "Очки Round", "Orbit", "accessories", 4800, null, "one", ["black", "brown"], ["1572635196237-14b3f281503f", "1590874103328-eac38a683ce7"], 0, 0, "Круглые солнцезащитные очки с UV400-линзами.", ["Ацетат", "Чехол в комплекте"]],
  ["belt-leather", "Ремень Leather", "Atelier 21", "accessories", 3400, null, "one", ["brown", "black"], ["1611591437281-460bfbe1220a", "1627123424574-724758594e93"], 0, 0, "Ремень из натуральной кожи с матовой пряжкой.", ["Натуральная кожа", "Крем для кожи"]],
  ["scarf-wool", "Шарф Wool", "Mono Studio", "accessories", 3900, 4900, "one", ["grey", "navy", "beige"], ["1627123424574-724758594e93", "1584917865442-de89df76afd3"], 0, 0, "Шерстяной шарф крупной вязки.", ["Шерсть 100%", "Ручная стирка"]],
  ["cap-classic", "Кепка Classic", "Northline", "accessories", 2200, null, "one", ["black", "olive", "beige"], ["1590874103328-eac38a683ce7", "1572635196237-14b3f281503f"], 1, 0, "Шестипанельная кепка из хлопкового твилла.", ["Хлопок твилл", "Стирка 30°C"]],
];

// Детерминированный UUID из имени (v4-подобный): те же id при каждом запуске, поэтому seed можно применять повторно.
const uid = (name) => {
  const h = createHash("sha1").update(`shopflow:${name}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${"89ab"[parseInt(h[16], 16) % 4]}${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const lower = (s) => s.toLowerCase();
const stamp = (daysAgo) => new Date(Date.UTC(2026, 10, 1) - daysAgo * 86_400_000).toISOString();
const out = [];
out.push("-- GENERATED by scripts/gen-seed.mjs. Не править вручную. Повторное применение безопасно (insert or ignore).\n");

out.push("insert or ignore into categories (id, slug, name, description, image_url, sort_order) values");
out.push(categories.map((c, i) => `  (${q(uid("cat:" + c[0]))}, ${q(c[0])}, ${q(c[1])}, ${q(c[2])}, ${q(U(c[3]))}, ${i})`).join(",\n") + ";\n");

out.push("insert or ignore into products (id, slug, name, brand, description, details, search, category_id, price, old_price, is_new, is_featured, created_at, updated_at) values");
out.push(P.map((p, i) => {
  const details = JSON.stringify({ "Материал": p[12][0], "Уход": p[12][1], "Артикул": `SF-${String(i + 1).padStart(3, "0")}` });
  const at = stamp(i * 2);
  return `  (${q(uid("prod:" + p[0]))}, ${q(p[0])}, ${q(p[1])}, ${q(p[2])}, ${q(p[11])}, ${q(details)}, ${q(lower(`${p[1]} ${p[2]} ${p[11]}`))}, ${q(uid("cat:" + p[3]))}, ${p[4]}, ${p[5] ?? "null"}, ${p[9] ? 1 : 0}, ${p[10] ? 1 : 0}, ${q(at)}, ${q(at)})`;
}).join(",\n") + ";\n");

out.push("insert or ignore into product_images (id, product_id, url, alt, sort_order) values");
out.push(P.flatMap((p) => p[8].map((id, k) => `  (${q(uid(`img:${p[0]}:${k}`))}, ${q(uid("prod:" + p[0]))}, ${q(U(id))}, ${q(p[1])}, ${k})`)).join(",\n") + ";\n");

const variants = P.flatMap((p) => SIZES[p[6]].flatMap((s) => p[7].map((c) => {
  const sku = `${p[0]}-${s}-${c}`.toUpperCase().replaceAll(" ", "").replace(/[^A-Z0-9-]/g, "");
  const r = hash(sku) % 100;
  const qty = r < 12 ? 0 : r % 25 + 1; // часть вариантов намеренно отсутствует на складе
  return { slug: p[0], sku, s, c, qty };
})));
out.push("insert or ignore into product_variants (id, product_id, sku, size, color, color_hex) values");
out.push(variants.map((v) => `  (${q(uid("var:" + v.sku))}, ${q(uid("prod:" + v.slug))}, ${q(v.sku)}, ${q(v.s)}, ${q(COLORS[v.c][0])}, ${q(COLORS[v.c][1])})`).join(",\n") + ";\n");

out.push("insert or ignore into inventory (variant_id, quantity) values");
out.push(variants.map((v) => `  (${q(uid("var:" + v.sku))}, ${v.qty})`).join(",\n") + ";\n");

out.push(`insert or ignore into promo_codes (id, code, description, discount_percent, discount_amount, min_order_total, max_uses, expires_at) values
  (${q(uid("promo:WELCOME10"))}, 'WELCOME10', 'Скидка 10% на первый заказ от 3 000 ₽', 10, null, 3000, null, null),
  (${q(uid("promo:SPRING500"))}, 'SPRING500', 'Скидка 500 ₽ на заказ от 5 000 ₽', null, 500, 5000, 200, null),
  (${q(uid("promo:VIP20"))}, 'VIP20', 'Скидка 20% для постоянных клиентов', 20, null, 8000, 50, null);`);

fs.mkdirSync(new URL("../db", import.meta.url), { recursive: true });
fs.writeFileSync(new URL("../db/seed.sql", import.meta.url), out.join("\n") + "\n");
console.log(`products=${P.length} variants=${variants.length} categories=${categories.length}`);
