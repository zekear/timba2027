import { desc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { botPosts } from '@/db/schema';
import { DraftRow } from './components/DraftRow';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const drafts = await db
    .select()
    .from(botPosts)
    .where(eq(botPosts.status, 'draft'))
    .orderBy(desc(botPosts.generatedAt))
    .limit(50);

  return (
    <main className="max-w-4xl mx-auto p-8">
      <header className="border-b-2 border-ink pb-4 mb-6">
        <h1 className="font-serif text-5xl">Review queue</h1>
        <div className="font-mono text-xs uppercase tracking-wide text-caption mt-2">
          {drafts.length} drafts pending · <a href="/admin" className="text-accent underline">admin</a>
        </div>
      </header>

      {drafts.length === 0 ? (
        <p className="text-caption">No hay drafts en la cola. Esperá a que los watchers detecten algo.</p>
      ) : (
        <ul>
          {drafts.map((d) => (
            <li key={d.id}>
              <DraftRow
                id={d.id}
                shape={d.shape}
                caption={d.caption}
                cardPath={d.cardPath}
                generatedAt={d.generatedAt}
                candidateFocus={d.candidateFocus}
                llmSource={(d.llmMetadata as { source?: string } | null)?.source ?? null}
              />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
