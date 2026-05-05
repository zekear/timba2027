import { sql } from 'drizzle-orm';
import Link from 'next/link';
import { db } from '../../src/db/client.js';
import { Header } from '../components/public/Header.js';
import { Footer } from '../components/public/Footer.js';
import { MarketChart, type ChartPoint } from '../components/public/MarketChart.js';
import { BarRow } from '../components/public/BarRow.js';

export const dynamic = 'force-dynamic';

async function getTimeSeriesData(): Promise<{ data: ChartPoint[]; candidates: string[] }> {
  const topRes = await db.execute(sql`
    SELECT DISTINCT ON (candidate) candidate, price::float AS price
    FROM market_prices mp JOIN markets m ON m.id = mp.market_id
    WHERE m.slug = 'argentina-presidential-election-winner'
    ORDER BY candidate, ts DESC
  `);
  const top = (topRes.rows as Array<{ candidate: string; price: number }>)
    .sort((a, b) => b.price - a.price)
    .slice(0, 5)
    .map((r) => r.candidate);

  if (top.length === 0) return { data: [], candidates: [] };

  // Build the ARRAY[...] expression manually for Postgres
  const arrayExpr = sql.join(top.map((c) => sql`${c}`), sql`, `);
  const seriesRes = await db.execute(sql`
    SELECT candidate, DATE_TRUNC('day', ts)::date AS day, AVG(price::float * 100) AS pct
    FROM market_prices mp JOIN markets m ON m.id = mp.market_id
    WHERE m.slug = 'argentina-presidential-election-winner'
      AND mp.candidate = ANY(ARRAY[${arrayExpr}])
      AND ts >= NOW() - INTERVAL '30 days'
    GROUP BY candidate, day
    ORDER BY day ASC
  `);
  const rows = seriesRes.rows as Array<{ candidate: string; day: string; pct: number }>;

  // Pivot to { date, [candidate]: pct, ... }
  const byDay = new Map<string, ChartPoint>();
  for (const r of rows) {
    const date = String(r.day).slice(0, 10);
    if (!byDay.has(date)) byDay.set(date, { date });
    const point = byDay.get(date)!;
    point[r.candidate] = Number(r.pct);
  }
  const data = Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date));

  return { data, candidates: top };
}

export default async function Year2027() {
  const { data, candidates } = await getTimeSeriesData();

  const last = data[data.length - 1];
  const top5Latest = candidates
    .map((c) => ({ candidato: c, pct: Number(last?.[c] ?? 0) }))
    .filter((x) => x.pct > 0)
    .sort((a, b) => b.pct - a.pct);
  const maxPct = Math.max(...top5Latest.map((c) => c.pct), 1);

  return (
    <>
      <Header />
      <main className="max-w-5xl mx-auto px-6 py-12">
        <Link href="/" className="font-mono text-xs uppercase tracking-wide text-accent underline mb-4 inline-block">
          ← home
        </Link>
        <div className="font-mono text-xs uppercase tracking-wide text-caption mb-2">
          Polymarket — Argentina presidential election
        </div>
        <h1 className="font-serif text-6xl md:text-7xl leading-none mb-12 text-pageInk">2027</h1>

        <section className="mb-12">
          <h2 className="font-mono text-xs uppercase tracking-wide font-bold border-b-2 border-ink pb-2 mb-4">
            Top 5 ahora
          </h2>
          <div className="space-y-1">
            {top5Latest.map((c) => (
              <BarRow key={c.candidato} candidato={c.candidato} pct={c.pct} maxPct={maxPct} />
            ))}
          </div>
        </section>

        <section>
          <h2 className="font-mono text-xs uppercase tracking-wide font-bold border-b-2 border-ink pb-2 mb-4">
            Últimos 30 días
          </h2>
          {data.length < 2 ? (
            <p className="font-serif text-lg text-caption">
              Necesitamos al menos 2 días de datos para dibujar el chart. Esperá un poco.
            </p>
          ) : (
            <MarketChart data={data} candidates={candidates} />
          )}
        </section>
      </main>
      <Footer />
    </>
  );
}
