import { sql, desc } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '../../../src/db/client.js';
import { botPosts } from '../../../src/db/schema.js';
import { candidateToSlug, slugToCandidate } from '../../lib/slug.js';
import { Header } from '../../components/public/Header.js';
import { Footer } from '../../components/public/Footer.js';
import { PostCard } from '../../components/public/PostCard.js';

export const dynamic = 'force-dynamic';

async function findCandidateByName(slug: string): Promise<string | null> {
  const r = await db.execute(sql`
    SELECT DISTINCT candidate FROM market_prices mp
    JOIN markets m ON m.id = mp.market_id
    WHERE m.slug = 'argentina-presidential-election-winner'
  `);
  const candidates = (r.rows as Array<{ candidate: string }>).map((row) => row.candidate);
  return candidates.find((c) => candidateToSlug(c) === slug) ?? null;
}

export default async function CandidatePage({
  params,
}: {
  params: Promise<{ candidate: string }>;
}) {
  const { candidate: slug } = await params;
  const realName = (await findCandidateByName(slug)) ?? slugToCandidate(slug);

  // Precio actual + delta 7d
  const priceRes = await db.execute(sql`
    WITH latest AS (
      SELECT price::float AS price, ts FROM market_prices mp
      JOIN markets m ON m.id = mp.market_id
      WHERE m.slug = 'argentina-presidential-election-winner' AND mp.candidate = ${realName}
      ORDER BY ts DESC LIMIT 1
    ),
    week_ago AS (
      SELECT price::float AS price FROM market_prices mp
      JOIN markets m ON m.id = mp.market_id
      WHERE m.slug = 'argentina-presidential-election-winner' AND mp.candidate = ${realName}
        AND ts <= NOW() - INTERVAL '7 days'
      ORDER BY ts DESC LIMIT 1
    )
    SELECT l.price * 100 AS pct_now, COALESCE((l.price - w.price) * 100, 0) AS delta_7d
    FROM latest l LEFT JOIN week_ago w ON true;
  `);
  const priceRow = priceRes.rows[0] as { pct_now?: number; delta_7d?: number } | undefined;
  if (!priceRow || priceRow.pct_now == null) notFound();

  const pctNow = priceRow.pct_now;
  const delta = priceRow.delta_7d ?? 0;

  // Bot posts publicados sobre este candidato
  const posts = await db
    .select()
    .from(botPosts)
    .where(sql`${botPosts.status} = 'published' AND ${botPosts.candidateFocus} = ${realName}`)
    .orderBy(desc(botPosts.publishedAt))
    .limit(6);

  return (
    <>
      <Header />
      <main className="max-w-4xl mx-auto px-6 py-12">
        <Link href="/" className="font-mono text-xs uppercase tracking-wide text-accent underline mb-4 inline-block">
          ← home
        </Link>
        <div className="font-mono text-xs uppercase tracking-wide text-caption mb-2">
          Candidato — Polymarket 2027
        </div>
        <h1 className="font-serif text-6xl md:text-7xl leading-none mb-8 text-pageInk">{realName}</h1>

        <section className="border-y-2 border-ink py-6 mb-12 grid grid-cols-2 gap-6">
          <div>
            <div className="font-mono text-xs uppercase tracking-wide text-caption">Precio actual</div>
            <div className="font-serif text-5xl mt-1">{pctNow.toFixed(1)}<span className="text-2xl">%</span></div>
          </div>
          <div>
            <div className="font-mono text-xs uppercase tracking-wide text-caption">Δ 7 días</div>
            <div className="font-serif text-5xl mt-1">
              {delta >= 0 ? '+' : ''}{delta.toFixed(1)}<span className="text-2xl">pp</span>
            </div>
          </div>
        </section>

        {posts.length > 0 && (
          <section>
            <h2 className="font-mono text-xs uppercase tracking-wide font-bold border-b-2 border-ink pb-2 mb-4">
              Posts del bot sobre {realName}
            </h2>
            <div className="grid md:grid-cols-2 gap-x-8">
              {posts.map((p) => (
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
          </section>
        )}
      </main>
      <Footer />
    </>
  );
}
