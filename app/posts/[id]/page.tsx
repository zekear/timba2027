import { eq } from 'drizzle-orm';
import { basename } from 'node:path';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '../../../src/db/client.js';
import { botPosts } from '../../../src/db/schema.js';
import { Header } from '../../components/public/Header.js';
import { Footer } from '../../components/public/Footer.js';

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
          {SHAPE_LABEL[p.shape] ?? p.shape} · #{p.id} · {p.publishedAt?.toLocaleDateString('es-AR') ?? 's/d'}
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
