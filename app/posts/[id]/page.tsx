import { eq } from 'drizzle-orm';
import { basename } from 'node:path';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { db } from '../../../src/db/client.js';
import { botPosts } from '../../../src/db/schema.js';
import { Header } from '../../components/public/Header.js';
import { Footer } from '../../components/public/Footer.js';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const numId = Number(id);
  if (!Number.isInteger(numId)) return { title: 'Post' };
  const [p] = await db.select().from(botPosts).where(eq(botPosts.id, numId));
  if (!p || p.status !== 'published') return { title: 'Post' };
  const cardFile = (await import('node:path')).basename(p.cardPath);
  return {
    title: p.caption.slice(0, 70),
    description: p.caption.slice(0, 200),
    openGraph: {
      title: p.caption.slice(0, 70),
      images: [`/api/cards/${encodeURIComponent(cardFile)}`],
    },
  };
}

export const dynamic = 'force-dynamic';

const SHAPE_LABEL: Record<string, string> = {
  morning_brief: 'MORNING BRIEF',
  market_move: 'POLYMARKET MOVE',
  new_poll: 'NUEVA ENCUESTA',
  hot_news: 'HOT NEWS',
};

export default async function PublicPost({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const numId = Number(id);
  if (!Number.isInteger(numId)) notFound();

  const [p] = await db.select().from(botPosts).where(eq(botPosts.id, numId));
  // Solo posts published son visibles públicamente
  if (!p || p.status !== 'published') notFound();

  const cardFile = basename(p.cardPath);
  const cardUrl = `/api/cards/${encodeURIComponent(cardFile)}`;

  // Source resumen amigable (sin LLM metadata interna)
  const source = p.sourceSnapshot as Record<string, unknown>;
  const sourceJson = JSON.stringify(source, null, 2);

  return (
    <>
      <Header />
      <main className="max-w-3xl mx-auto px-6 py-12">
        <Link href="/" className="font-mono text-xs uppercase tracking-wide text-accent underline mb-4 inline-block">
          ← home
        </Link>
        <div className="font-mono text-xs uppercase tracking-wide text-caption mb-3">
          {SHAPE_LABEL[p.shape] ?? p.shape} · #{p.id} · {p.publishedAt?.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }) ?? 's/d'}
        </div>

        <img src={cardUrl} alt="" className="w-full border-2 border-ink mb-8" />

        <p className="font-serif text-2xl leading-snug text-pageInk mb-8">{p.caption}</p>

        {p.xPostId && (
          <p className="mb-8">
            <a
              href={`https://x.com/i/status/${p.xPostId}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-xs uppercase tracking-wide text-accent underline"
            >
              ver en X →
            </a>
          </p>
        )}

        <details className="mb-8">
          <summary className="font-mono text-xs uppercase tracking-wide text-caption cursor-pointer">
            Datos source ↓
          </summary>
          <pre className="text-xs mt-3 bg-hairline/30 p-4 overflow-auto whitespace-pre-wrap">
            {sourceJson}
          </pre>
        </details>
      </main>
      <Footer />
    </>
  );
}
