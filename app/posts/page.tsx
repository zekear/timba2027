import Link from 'next/link';
import { sql, desc, eq, and } from 'drizzle-orm';
import type { Metadata } from 'next';
import { db } from '../../src/db/client.js';
import { botPosts } from '../../src/db/schema.js';
import { Header } from '../components/public/Header.js';
import { Footer } from '../components/public/Footer.js';
import { PostCard } from '../components/public/PostCard.js';

export const metadata: Metadata = {
  title: 'Posts · Timba 2027',
  description: 'Todos los posts del bot — Polymarket, encuestas, noticias.',
};

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

const SHAPE_OPTIONS = [
  { value: null, label: 'Todos', href: '/posts' },
  { value: 'hot_news', label: 'Hot News', href: '/posts?shape=hot_news' },
  { value: 'market_move', label: 'Polymarket', href: '/posts?shape=market_move' },
  { value: 'new_poll', label: 'Encuestas', href: '/posts?shape=new_poll' },
  { value: 'morning_brief', label: 'Morning brief', href: '/posts?shape=morning_brief' },
] as const;

const VALID_SHAPES = new Set(['hot_news', 'market_move', 'new_poll', 'morning_brief']);

export default async function PostsIndex({
  searchParams,
}: {
  searchParams: Promise<{ shape?: string; page?: string }>;
}) {
  const { shape: shapeParam, page: pageParam } = await searchParams;
  const shape = shapeParam && VALID_SHAPES.has(shapeParam) ? shapeParam : null;
  const page = Math.max(1, Number.parseInt(pageParam ?? '1', 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const filterShape = shape as 'hot_news' | 'market_move' | 'new_poll' | 'morning_brief' | null;
  const where = filterShape
    ? and(eq(botPosts.status, 'published'), eq(botPosts.shape, filterShape))
    : eq(botPosts.status, 'published');

  const [posts, totalRes] = await Promise.all([
    db
      .select()
      .from(botPosts)
      .where(where)
      .orderBy(desc(botPosts.publishedAt))
      .limit(PAGE_SIZE)
      .offset(offset),
    db.execute(
      filterShape
        ? sql`SELECT COUNT(*)::int AS n FROM bot_posts WHERE status = 'published' AND shape = ${filterShape}`
        : sql`SELECT COUNT(*)::int AS n FROM bot_posts WHERE status = 'published'`,
    ),
  ]);
  const total = (totalRes.rows[0] as { n: number }).n;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasPrev = page > 1;
  const hasNext = page < totalPages;
  const buildHref = (p: number) =>
    `/posts?${new URLSearchParams({ ...(shape ? { shape } : {}), ...(p > 1 ? { page: String(p) } : {}) }).toString()}`;

  return (
    <>
      <Header />
      <main className="max-w-5xl mx-auto px-6 py-12">
        <div className="font-mono text-xs uppercase tracking-wide text-caption mb-3">
          Archivo · {total} {total === 1 ? 'post' : 'posts'}
        </div>
        <h1 className="font-serif text-5xl md:text-6xl leading-none mb-8 text-pageInk">
          Posts del bot
        </h1>

        <nav className="flex flex-wrap gap-2 mb-8 font-mono text-xs uppercase tracking-wide">
          {SHAPE_OPTIONS.map((opt) => {
            const active = (shape ?? null) === opt.value;
            return (
              <Link
                key={opt.label}
                href={opt.href as never}
                className={
                  'px-3 py-1 border-2 ' +
                  (active
                    ? 'border-ink bg-ink text-paperWhite'
                    : 'border-hairline text-caption hover:border-ink hover:text-pageInk')
                }
              >
                {opt.label}
              </Link>
            );
          })}
        </nav>

        {posts.length === 0 ? (
          <p className="font-serif text-lg text-caption">No hay posts en este filtro todavía.</p>
        ) : (
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
        )}

        {totalPages > 1 && (
          <nav className="flex items-baseline justify-between mt-8 pt-4 border-t-2 border-ink font-mono text-xs uppercase tracking-wide">
            {hasPrev ? (
              <Link href={buildHref(page - 1) as never} className="text-accent underline">
                ← anterior
              </Link>
            ) : (
              <span className="text-caption">← anterior</span>
            )}
            <span className="text-caption">
              página {page} de {totalPages}
            </span>
            {hasNext ? (
              <Link href={buildHref(page + 1) as never} className="text-accent underline">
                siguiente →
              </Link>
            ) : (
              <span className="text-caption">siguiente →</span>
            )}
          </nav>
        )}
      </main>
      <Footer />
    </>
  );
}
