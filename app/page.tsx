import Link from 'next/link';
import { sql, desc, eq } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { botPosts } from '../src/db/schema.js';
import { Header } from './components/public/Header.js';
import { Footer } from './components/public/Footer.js';
import { PostCard } from './components/public/PostCard.js';
import { BarRow } from './components/public/BarRow.js';

export const dynamic = 'force-dynamic';

interface CandidateRow {
  candidate: string;
  pct: number;
  delta7d: number | null;
  sparkline: number[];
}

async function getCurrentTop5(): Promise<CandidateRow[]> {
  const r = await db.execute(sql`
    SELECT DISTINCT ON (candidate) candidate, (price::float * 100) AS pct
    FROM market_prices mp JOIN markets m ON m.id = mp.market_id
    WHERE m.slug = 'argentina-presidential-election-winner'
    ORDER BY candidate, ts DESC
  `);
  const rows = r.rows as Array<{ candidate: string; pct: number }>;
  const top5 = rows.sort((a, b) => b.pct - a.pct).slice(0, 5);
  if (top5.length === 0) return [];

  // Histórico 7d: 1 muestra por hora, por candidato del top 5.
  // Pasamos el array como literal PG ('{a,b,c}') porque drizzle expande
  // JS arrays como tuple ($1,$2,...) en vez de array param.
  const candidates = top5.map((c) => c.candidate);
  const candidatesArrayLiteral = `{${candidates.map((c) => `"${c.replace(/"/g, '\\"')}"`).join(',')}}`;
  const history = await db.execute(sql`
    SELECT candidate,
           date_trunc('hour', ts) AS hour,
           AVG(price::float * 100) AS pct
    FROM market_prices mp JOIN markets m ON m.id = mp.market_id
    WHERE m.slug = 'argentina-presidential-election-winner'
      AND candidate = ANY(${candidatesArrayLiteral}::text[])
      AND ts > NOW() - INTERVAL '7 days'
    GROUP BY candidate, hour
    ORDER BY candidate, hour
  `);

  const byCandidate = new Map<string, number[]>();
  for (const row of history.rows as Array<{ candidate: string; hour: Date; pct: number }>) {
    const arr = byCandidate.get(row.candidate) ?? [];
    arr.push(row.pct);
    byCandidate.set(row.candidate, arr);
  }

  return top5.map((c) => {
    const series = byCandidate.get(c.candidate) ?? [];
    const delta7d = series.length >= 2 ? c.pct - series[0] : null;
    return { ...c, delta7d, sparkline: series };
  });
}

export default async function Home() {
  const [top5, recentPosts] = await Promise.all([
    getCurrentTop5(),
    db.select().from(botPosts).where(eq(botPosts.status, 'published')).orderBy(desc(botPosts.publishedAt)).limit(6),
  ]);

  const maxPct = Math.max(...top5.map((c) => c.pct), 1);

  return (
    <>
      <Header />
      <main className="max-w-5xl mx-auto px-6 py-12">
        <section className="mb-16">
          <div className="font-mono text-xs uppercase tracking-wide text-caption mb-3">
            Política argentina · datos automatizados
          </div>
          <h1 className="font-serif text-5xl md:text-7xl leading-none mb-6 text-pageInk">
            Camino al 2027.
          </h1>
          <p className="font-serif text-xl md:text-2xl leading-snug text-pageInk max-w-3xl">
            Un robot lee Polymarket, encuestas locales y noticias mainstream, y reporta lo
            que pasa con el mercado de elecciones. Sin opinión. Con fuente.
          </p>
        </section>

        {top5.length > 0 && (
          <section className="mb-16">
            <div className="flex items-baseline justify-between border-b-2 border-ink pb-2 mb-4">
              <h2 className="font-mono text-xs uppercase tracking-wide font-bold">
                Polymarket — top 5 ahora
              </h2>
              <Link href="/2027" className="font-mono text-xs uppercase tracking-wide text-accent underline">
                ver timeline →
              </Link>
            </div>
            <div className="space-y-1">
              {top5.map((c) => (
                <BarRow
                  key={c.candidate}
                  candidato={c.candidate}
                  pct={c.pct}
                  maxPct={maxPct}
                  delta7d={c.delta7d ?? undefined}
                  sparkline={c.sparkline}
                />
              ))}
            </div>
          </section>
        )}

        <section>
          <div className="flex items-baseline justify-between border-b-2 border-ink pb-2 mb-4">
            <h2 className="font-mono text-xs uppercase tracking-wide font-bold">
              Últimos posts del bot
            </h2>
            <Link href={'/posts' as never} className="font-mono text-xs uppercase tracking-wide text-accent underline">
              ver todos →
            </Link>
          </div>
          {recentPosts.length === 0 ? (
            <p className="font-serif text-lg text-caption">No hay posts publicados todavía.</p>
          ) : (
            <div className="grid md:grid-cols-2 gap-x-8">
              {recentPosts.map((p) => (
                <PostCard
                  key={p.id}
                  id={p.id}
                  shape={p.shape}
                  caption={p.caption}
                  cardPath={p.cardPath}
                  publishedAt={p.publishedAt}
                />
              ))}
            </div>
          )}
        </section>
      </main>
      <Footer />
    </>
  );
}
