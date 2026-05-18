import { sql, desc, eq, inArray } from 'drizzle-orm';
import { basename } from 'node:path';
import Link from 'next/link';
import type { Metadata } from 'next';
import { db } from '../../src/db/client.js';
import { botPosts } from '../../src/db/schema.js';
import { Header } from '../components/public/Header.js';
import { Footer } from '../components/public/Footer.js';

export const dynamic = 'force-dynamic';

const TYPES = ['milestone', 'duelo_crossover', 'weekly_recap'] as const;

const TYPE_LABEL: Record<string, string> = {
  milestone: 'HITO',
  duelo_crossover: 'CRUCE',
  weekly_recap: 'SEMANAL',
  market_move: 'MOVIMIENTO',
};

const TYPE_ICON: Record<string, string> = {
  milestone: '◆',
  duelo_crossover: '⇋',
  weekly_recap: '◐',
  market_move: '▲',
};

export async function generateMetadata(): Promise<Metadata> {
  const title = 'Momentos — Timba 2027';
  const description = 'Cronología de hitos: crossovers, primeras veces, recaps semanales.';
  // OG: usar la card del último milestone o crossover (lo más representativo de esta page).
  const [latest] = await db
    .select({ cardPath: botPosts.cardPath })
    .from(botPosts)
    .where(sql`${botPosts.status} = 'published' AND ${botPosts.shape} IN ('milestone', 'duelo_crossover')`)
    .orderBy(desc(botPosts.publishedAt))
    .limit(1);
  const ogImage = latest ? `/api/cards/${encodeURIComponent(basename(latest.cardPath))}` : '/og-default.png';
  return {
    title,
    description,
    openGraph: { title, description, images: [ogImage] },
  };
}

function monthLabel(d: Date): string {
  return d.toLocaleDateString('es-AR', {
    year: 'numeric',
    month: 'long',
    timeZone: 'America/Argentina/Buenos_Aires',
  });
}

function dayTimeLabel(d: Date): string {
  return d.toLocaleString('es-AR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Argentina/Buenos_Aires',
  });
}

export default async function MomentosPage() {
  const items = await db
    .select()
    .from(botPosts)
    .where(sql`${botPosts.status} = 'published' AND ${botPosts.shape} IN ('milestone', 'duelo_crossover', 'weekly_recap')`)
    .orderBy(desc(botPosts.publishedAt))
    .limit(80);

  // Agrupar por mes (string "Mayo 2026")
  const byMonth = new Map<string, typeof items>();
  for (const item of items) {
    if (!item.publishedAt) continue;
    const key = monthLabel(new Date(item.publishedAt));
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key)!.push(item);
  }

  return (
    <>
      <Header />
      <main className="max-w-3xl mx-auto px-6 py-12">
        <div className="font-mono text-xs uppercase tracking-wide text-caption mb-3">
          Cronología del proyecto
        </div>
        <h1 className="font-serif text-5xl md:text-6xl leading-none mb-4 text-pageInk">
          Momentos.
        </h1>
        <p className="font-serif text-xl leading-snug text-pageInk mb-12 max-w-2xl">
          Hitos del mercado presidencial 2027: primeras veces, cruces en el top 5,
          recaps semanales. La línea del tiempo de cómo se movió la timba.
        </p>

        {items.length === 0 ? (
          <p className="font-serif text-lg text-caption">
            Todavía no hay momentos archivados. Aparecen acá cuando el bot detecta cruces,
            hitos o publica el recap semanal.
          </p>
        ) : (
          Array.from(byMonth.entries()).map(([month, monthItems]) => (
            <section key={month} className="mb-12">
              <h2 className="font-mono text-xs uppercase tracking-wide font-bold border-b-2 border-ink pb-2 mb-6">
                {month}
              </h2>
              <ul className="space-y-6">
                {monthItems.map((item) => (
                  <li key={item.id} className="flex gap-4">
                    <div
                      className="font-mono text-xl text-pageInk shrink-0 w-6 text-center"
                      aria-hidden
                    >
                      {TYPE_ICON[item.shape] ?? '·'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-xs uppercase tracking-wide text-caption mb-1">
                        {TYPE_LABEL[item.shape] ?? item.shape}
                        {' · '}
                        {item.publishedAt ? dayTimeLabel(new Date(item.publishedAt)) : 's/d'}
                      </div>
                      <Link
                        href={`/posts/${item.id}`}
                        className="font-serif text-lg leading-snug text-pageInk hover:text-accent group block whitespace-pre-line"
                      >
                        {item.caption.split('\n')[0]}
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </main>
      <Footer />
    </>
  );
}
