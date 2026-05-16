import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { botPosts } from '@/db/schema';
import { DraftRow } from '../components/DraftRow';

export const dynamic = 'force-dynamic';

const SHAPES = [
  { value: 'market_move', label: 'Market move' },
  { value: 'hot_news', label: 'Hot news' },
  { value: 'new_poll', label: 'New poll' },
  { value: 'morning_brief', label: 'Morning brief' },
  { value: 'weekly_recap', label: 'Weekly recap' },
] as const;

type Shape = (typeof SHAPES)[number]['value'];

const SHAPE_VALUES = new Set<string>(SHAPES.map((s) => s.value));

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ shape?: string }>;
}) {
  const { shape } = await searchParams;
  const activeShape: Shape | null = shape && SHAPE_VALUES.has(shape) ? (shape as Shape) : null;

  const baseWhere = eq(botPosts.status, 'draft');
  const where = activeShape ? and(baseWhere, eq(botPosts.shape, activeShape)) : baseWhere;

  const [drafts, countsRows] = await Promise.all([
    db.select().from(botPosts).where(where).orderBy(desc(botPosts.generatedAt)).limit(50),
    db
      .select({ shape: botPosts.shape, count: sql<number>`count(*)::int` })
      .from(botPosts)
      .where(baseWhere)
      .groupBy(botPosts.shape),
  ]);

  const counts = new Map(countsRows.map((r) => [r.shape, r.count]));
  const total = countsRows.reduce((acc, r) => acc + r.count, 0);

  return (
    <main className="max-w-4xl mx-auto p-8">
      <header className="border-b-2 border-ink pb-4 mb-6">
        <h1 className="font-serif text-5xl">Review queue</h1>
        <div className="font-mono text-xs uppercase tracking-wide text-caption mt-2">
          {drafts.length} drafts shown · <a href="/admin/decisions" className="text-accent underline">decisiones</a> · <a href="/admin/settings" className="text-accent underline">settings</a>
        </div>
      </header>

      <nav className="flex flex-wrap gap-2 mb-6 font-mono text-xs uppercase tracking-wide">
        <ShapePill href="/admin" active={activeShape === null} label="Todos" count={total} />
        {SHAPES.map((s) => (
          <ShapePill
            key={s.value}
            href={`/admin?shape=${s.value}`}
            active={activeShape === s.value}
            label={s.label}
            count={counts.get(s.value) ?? 0}
          />
        ))}
      </nav>

      {drafts.length === 0 ? (
        <p className="text-caption">
          {activeShape
            ? `No hay drafts de ${activeShape}. Probá con otro filtro.`
            : 'No hay drafts en la cola. Esperá a que los watchers detecten algo.'}
        </p>
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

function ShapePill({
  href,
  active,
  label,
  count,
}: {
  href: string;
  active: boolean;
  label: string;
  count: number;
}) {
  return (
    <a
      href={href}
      className={
        active
          ? 'border-2 border-ink bg-ink text-paper px-3 py-1.5'
          : 'border-2 border-ink text-ink px-3 py-1.5 hover:bg-paper'
      }
    >
      {label} <span className="text-caption">{count}</span>
    </a>
  );
}
