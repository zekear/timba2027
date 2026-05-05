import { eq, desc } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { db } from '../../../src/db/client.js';
import { pollsters, polls } from '../../../src/db/schema.js';
import { Header } from '../../components/public/Header.js';
import { Footer } from '../../components/public/Footer.js';
import { PollResultsTable } from '../../components/public/PollResultsTable.js';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const [pollster] = await db.select().from(pollsters).where(eq(pollsters.slug, slug));
  if (!pollster) return { title: 'Encuestadora' };
  return {
    title: pollster.displayName,
    description: `Histórico de encuestas de ${pollster.displayName}.`,
  };
}

export const dynamic = 'force-dynamic';

export default async function EncuestadoraPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [pollster] = await db.select().from(pollsters).where(eq(pollsters.slug, slug));
  if (!pollster) notFound();

  const recent = await db
    .select()
    .from(polls)
    .where(eq(polls.pollsterId, pollster.id))
    .orderBy(desc(polls.fechaCampo))
    .limit(10);

  return (
    <>
      <Header />
      <main className="max-w-4xl mx-auto px-6 py-12">
        <Link href="/" className="font-mono text-xs uppercase tracking-wide text-accent underline mb-4 inline-block">
          ← home
        </Link>
        <div className="font-mono text-xs uppercase tracking-wide text-caption mb-2">Encuestadora</div>
        <h1 className="font-serif text-6xl md:text-7xl leading-none mb-2 text-pageInk">{pollster.displayName}</h1>
        <p className="font-mono text-xs uppercase tracking-wide text-caption mb-12">
          @{pollster.xHandle}
        </p>

        <h2 className="font-mono text-xs uppercase tracking-wide font-bold border-b-2 border-ink pb-2 mb-6">
          Últimas encuestas ({recent.length})
        </h2>

        {recent.length === 0 ? (
          <p className="font-serif text-lg text-caption">
            Sin encuestas publicadas todavía. Cuando {pollster.displayName} postee una nueva
            con datos numéricos, aparecerá acá.
          </p>
        ) : (
          <div className="space-y-12">
            {recent.map((poll) => (
              <article key={poll.id} className="border-b-2 border-hairline pb-8">
                <div className="font-mono text-xs uppercase tracking-wide text-caption mb-3">
                  {poll.fechaCampo ? `Campo ${poll.fechaCampo.toISOString().slice(0, 10)}` : 'fecha s/d'}
                  {poll.sampleSize ? ` · n=${poll.sampleSize}` : ''}
                  {poll.metodologia ? ` · ${poll.metodologia}` : ''}
                </div>
                <PollResultsTable results={poll.results} />
                <a
                  href={poll.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-xs uppercase tracking-wide text-accent underline mt-3 inline-block"
                >
                  fuente original →
                </a>
              </article>
            ))}
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
