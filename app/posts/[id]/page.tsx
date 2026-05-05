import { eq } from 'drizzle-orm';
import { basename } from 'node:path';
import Link from 'next/link';
import { db } from '../../../src/db/client.js';
import { botPosts } from '../../../src/db/schema.js';
import { ActionButtons } from '../../components/ActionButtons.js';

export const dynamic = 'force-dynamic';

export default async function PostDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const numId = Number(id);
  const [p] = await db.select().from(botPosts).where(eq(botPosts.id, numId));
  if (!p) return <main className="p-8">Not found · <Link href="/" className="text-accent underline">back</Link></main>;

  const cardFile = basename(p.cardPath);
  const cardUrl = `/api/cards/${encodeURIComponent(cardFile)}`;
  const meta = p.llmMetadata as Record<string, unknown> | null;

  return (
    <main className="max-w-4xl mx-auto p-8">
      <Link href="/" className="font-mono text-xs uppercase tracking-wide text-accent underline">← back to queue</Link>

      <header className="border-b-2 border-ink pb-4 mb-6 mt-4">
        <div className="font-mono text-xs uppercase tracking-wide text-caption">
          #{p.id} · {p.shape} · status={p.status} · {p.generatedAt.toLocaleString('es-AR')}
          {p.candidateFocus ? ` · focus: ${p.candidateFocus}` : null}
        </div>
      </header>

      <img src={cardUrl} alt="" className="border-2 border-ink w-full mb-6" />

      <section className="mb-6">
        <div className="font-mono text-xs uppercase tracking-wide text-caption mb-2">Caption ({p.caption.length} chars)</div>
        <p className="font-serif text-2xl leading-snug">{p.caption}</p>
      </section>

      <ActionButtons postId={p.id} status={p.status} />

      {p.status === 'published' && p.xPostId && (
        <p className="mt-4 font-mono text-xs uppercase tracking-wide">
          Published as <a className="text-accent underline" href={`https://x.com/i/status/${p.xPostId}`} target="_blank" rel="noreferrer">{p.xPostId}</a>
        </p>
      )}

      <details className="mt-8">
        <summary className="font-mono text-xs uppercase tracking-wide text-caption cursor-pointer">LLM metadata</summary>
        <pre className="text-xs mt-2 bg-hairline/30 p-4 overflow-auto">{JSON.stringify(meta, null, 2)}</pre>
      </details>

      <details className="mt-4">
        <summary className="font-mono text-xs uppercase tracking-wide text-caption cursor-pointer">Source snapshot</summary>
        <pre className="text-xs mt-2 bg-hairline/30 p-4 overflow-auto">{JSON.stringify(p.sourceSnapshot, null, 2)}</pre>
      </details>
    </main>
  );
}
