import { formatPrice } from "@/lib/format";

type Point = { day: string; orders: number; revenue: number };

/** Столбчатый график выручки по дням. Чистый SVG: без сторонних библиотек, подписи через <title>. */
export function SalesChart({ data }: { data: Point[] }) {
  const max = Math.max(...data.map((d) => d.revenue), 1);
  const W = 720, H = 220, pad = { t: 10, b: 26, l: 8, r: 8 };
  const bw = (W - pad.l - pad.r) / data.length;
  const total = data.reduce((s, d) => s + d.revenue, 0);
  const fmt = (iso: string) => new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(new Date(iso));

  if (!total) return <p className="grid h-48 place-items-center text-sm text-muted-foreground">За последние 30 дней продаж не было</p>;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Выручка за 30 дней: ${formatPrice(total)}`} className="w-full">
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line key={f} x1={pad.l} x2={W - pad.r} y1={pad.t + (H - pad.t - pad.b) * (1 - f)} y2={pad.t + (H - pad.t - pad.b) * (1 - f)} stroke="currentColor" className="text-border" strokeDasharray="3 4" />
      ))}
      {data.map((d, i) => {
        const h = ((H - pad.t - pad.b) * d.revenue) / max;
        return (
          <g key={d.day}>
            <rect x={pad.l + i * bw + 2} y={H - pad.b - h} width={Math.max(bw - 4, 2)} height={Math.max(h, d.revenue ? 2 : 0)} rx={3} className="fill-primary/85 transition-opacity hover:opacity-60">
              <title>{`${fmt(d.day)}: ${formatPrice(d.revenue)}, заказов: ${d.orders}`}</title>
            </rect>
            {(i % 5 === 0 || i === data.length - 1) && (
              <text x={pad.l + i * bw + bw / 2} y={H - 8} textAnchor="middle" className="fill-muted-foreground text-[10px]">{fmt(d.day)}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
