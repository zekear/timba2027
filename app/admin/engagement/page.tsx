import { sql } from 'drizzle-orm';
import { extname } from 'node:path';
import Link from 'next/link';
import { db } from '@/db/client';
import {
  EngagementLineChart,
  ImpressionsChart,
  PostsPerDayChart,
  type DayPoint,
} from '../components/EngagementChart';

export const dynamic = 'force-dynamic';

interface PostMetrics {
  like_count?: number;
  reply_count?: number;
  retweet_count?: number;
  quote_count?: number;
  bookmark_count?: number;
  impression_count?: number;
  updated_at?: string;
}

interface Row {
  id: number;
  shape: string;
  caption: string;
  card_path: string;
  x_post_id: string;
  published_at: Date;
  metrics: PostMetrics | null;
}

const SHAPE_LABEL: Record<string, string> = {
  morning_brief: 'BRIEF',
  market_move: 'MOVE',
  new_poll: 'POLL',
  hot_news: 'NEWS',
  weekly_recap: 'RECAP',
  duelo_crossover: 'DUELO',
  milestone: 'HITO',
};

function mAvg(rows: Row[], key: keyof PostMetrics): number {
  if (rows.length === 0) return 0;
  const sum = rows.reduce((acc, r) => acc + Number(r.metrics?.[key] ?? 0), 0);
  return sum / rows.length;
}

function mTotal(rows: Row[], key: keyof PostMetrics): number {
  return rows.reduce((acc, r) => acc + Number(r.metrics?.[key] ?? 0), 0);
}

export default async function EngagementDashboard() {
  const result = await db.execute(sql`
    SELECT id, shape::text, caption, card_path, x_post_id, published_at, metrics
    FROM bot_posts
    WHERE status = 'published' AND metrics IS NOT NULL AND x_post_id IS NOT NULL
    ORDER BY published_at DESC
    LIMIT 100
  `);
  const rows = result.rows as unknown as Row[];

  const totalLikes = mTotal(rows, 'like_count');
  const totalRTs = mTotal(rows, 'retweet_count');
  const totalImpr = mTotal(rows, 'impression_count');
  const totalReplies = mTotal(rows, 'reply_count');

  // Por shape
  const byShape = new Map<string, Row[]>();
  for (const r of rows) {
    if (!byShape.has(r.shape)) byShape.set(r.shape, []);
    byShape.get(r.shape)!.push(r);
  }
  const shapeAggs = Array.from(byShape.entries())
    .map(([shape, items]) => ({
      shape,
      n: items.length,
      avgLikes: mAvg(items, 'like_count'),
      avgImpr: mAvg(items, 'impression_count'),
      avgRT: mAvg(items, 'retweet_count'),
    }))
    .sort((a, b) => b.avgImpr - a.avgImpr);

  // A/B animadas vs estáticas (.gif vs .png)
  const animated = rows.filter((r) => extname(r.card_path).toLowerCase() === '.gif');
  const stat = rows.filter((r) => extname(r.card_path).toLowerCase() !== '.gif');

  // Métricas por día (agrupar por published_at en ARG)
  const dayMap = new Map<string, Row[]>();
  for (const r of rows) {
    const d = new Date(r.published_at);
    // YYYY-MM-DD en ARG
    const key = d
      .toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
    if (!dayMap.has(key)) dayMap.set(key, []);
    dayMap.get(key)!.push(r);
  }
  const daySeries: DayPoint[] = Array.from(dayMap.entries())
    .map(([date, items]) => ({
      date,
      posts: items.length,
      avgLikes: mAvg(items, 'like_count'),
      avgRTs: mAvg(items, 'retweet_count'),
      avgImpressions: mAvg(items, 'impression_count'),
      totalLikes: mTotal(items, 'like_count'),
      totalImpressions: mTotal(items, 'impression_count'),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return (
    <main className="max-w-5xl mx-auto p-8">
      <header className="border-b-2 border-ink pb-4 mb-6">
        <h1 className="font-serif text-5xl">Engagement</h1>
        <div className="font-mono text-xs uppercase tracking-wide text-caption mt-2">
          {rows.length} posts trackeados ·
          <Link href="/admin" className="text-accent underline ml-2">admin</Link>
          ·
          <Link href="/admin/decisions" className="text-accent underline ml-2">decisiones</Link>
        </div>
      </header>

      {rows.length === 0 ? (
        <p className="text-caption">
          Todavía no hay métricas. El collector corre cada hora; volvé después del próximo tick.
        </p>
      ) : (
        <>
          {/* Totales */}
          <section className="mb-10 grid grid-cols-2 md:grid-cols-4 gap-6 border-y-2 border-ink py-6">
            <Stat label="Likes" value={totalLikes} />
            <Stat label="Retweets" value={totalRTs} />
            <Stat label="Replies" value={totalReplies} />
            <Stat label="Impressions" value={totalImpr} />
          </section>

          {/* Evolución por día */}
          {daySeries.length >= 2 && (
            <section className="mb-10">
              <h2 className="font-mono text-xs uppercase tracking-wide font-bold border-b-2 border-ink pb-2 mb-4">
                Evolución por día (promedio por post)
              </h2>
              <div className="mb-6">
                <div className="font-mono text-xs uppercase text-caption mb-1">Likes y RTs</div>
                <EngagementLineChart data={daySeries} />
              </div>
              <div className="mb-6">
                <div className="font-mono text-xs uppercase text-caption mb-1">Impressions</div>
                <ImpressionsChart data={daySeries} />
              </div>
              <div>
                <div className="font-mono text-xs uppercase text-caption mb-1">Volumen — posts publicados</div>
                <PostsPerDayChart data={daySeries} />
              </div>
              <p className="font-mono text-xs text-caption mt-4">
                Promedios por post. Para ver impacto de un cambio: comparar la curva antes vs después
                del día en que activaste la feature. Cada barra del último gráfico es un día calendario.
              </p>
            </section>
          )}

          {/* A/B animadas vs estáticas */}
          {animated.length > 0 && stat.length > 0 && (
            <section className="mb-10">
              <h2 className="font-mono text-xs uppercase tracking-wide font-bold border-b-2 border-ink pb-2 mb-4">
                Animadas (.gif) vs estáticas (.png)
              </h2>
              <div className="grid grid-cols-2 gap-6">
                <ABCard
                  label="Animadas"
                  n={animated.length}
                  avgLikes={mAvg(animated, 'like_count')}
                  avgImpr={mAvg(animated, 'impression_count')}
                  avgRT={mAvg(animated, 'retweet_count')}
                />
                <ABCard
                  label="Estáticas"
                  n={stat.length}
                  avgLikes={mAvg(stat, 'like_count')}
                  avgImpr={mAvg(stat, 'impression_count')}
                  avgRT={mAvg(stat, 'retweet_count')}
                />
              </div>
            </section>
          )}

          {/* Promedio por shape */}
          <section className="mb-10">
            <h2 className="font-mono text-xs uppercase tracking-wide font-bold border-b-2 border-ink pb-2 mb-4">
              Promedio por shape
            </h2>
            <table className="w-full font-mono text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-caption uppercase text-xs">
                  <th className="py-2">Shape</th>
                  <th className="text-right">N</th>
                  <th className="text-right">Avg likes</th>
                  <th className="text-right">Avg RTs</th>
                  <th className="text-right">Avg impr</th>
                </tr>
              </thead>
              <tbody>
                {shapeAggs.map((s) => (
                  <tr key={s.shape} className="border-b border-hairline">
                    <td className="py-2 font-bold">{SHAPE_LABEL[s.shape] ?? s.shape}</td>
                    <td className="text-right tabular-nums">{s.n}</td>
                    <td className="text-right tabular-nums">{s.avgLikes.toFixed(1)}</td>
                    <td className="text-right tabular-nums">{s.avgRT.toFixed(1)}</td>
                    <td className="text-right tabular-nums">{s.avgImpr.toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Tabla detalle */}
          <section className="mb-10">
            <h2 className="font-mono text-xs uppercase tracking-wide font-bold border-b-2 border-ink pb-2 mb-4">
              Detalle (últimos 100 publicados)
            </h2>
            <table className="w-full font-mono text-xs">
              <thead>
                <tr className="border-b border-hairline text-left text-caption uppercase">
                  <th className="py-2">Tipo</th>
                  <th>Fecha</th>
                  <th>Caption</th>
                  <th className="text-right">♥</th>
                  <th className="text-right">RT</th>
                  <th className="text-right">↩</th>
                  <th className="text-right">Impr</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const m = r.metrics ?? {};
                  const isGif = extname(r.card_path).toLowerCase() === '.gif';
                  return (
                    <tr key={r.id} className="border-b border-hairline hover:bg-paper">
                      <td className="py-2 font-bold">
                        {SHAPE_LABEL[r.shape] ?? r.shape}
                        {isGif && <span className="text-caption ml-1">·gif</span>}
                      </td>
                      <td className="text-caption">
                        {new Date(r.published_at).toLocaleDateString('es-AR', {
                          day: '2-digit',
                          month: 'short',
                          timeZone: 'America/Argentina/Buenos_Aires',
                        })}
                      </td>
                      <td className="font-sans text-xs max-w-md truncate">{r.caption.split('\n')[0]}</td>
                      <td className="text-right tabular-nums">{m.like_count ?? 0}</td>
                      <td className="text-right tabular-nums">{m.retweet_count ?? 0}</td>
                      <td className="text-right tabular-nums">{m.reply_count ?? 0}</td>
                      <td className="text-right tabular-nums">{m.impression_count ?? 0}</td>
                      <td className="text-right">
                        <a
                          href={`https://x.com/i/status/${r.x_post_id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-accent"
                        >
                          ↗
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="font-mono text-xs uppercase tracking-wide text-caption">{label}</div>
      <div className="font-serif text-4xl mt-1 tabular-nums">{value.toLocaleString('es-AR')}</div>
    </div>
  );
}

function ABCard(props: { label: string; n: number; avgLikes: number; avgImpr: number; avgRT: number }) {
  return (
    <div className="border-2 border-ink p-4">
      <div className="font-mono text-xs uppercase tracking-wide text-caption">{props.label} · n={props.n}</div>
      <div className="mt-3 grid grid-cols-3 gap-3 font-mono text-sm">
        <div>
          <div className="text-caption uppercase text-[10px]">avg ♥</div>
          <div className="text-xl tabular-nums">{props.avgLikes.toFixed(1)}</div>
        </div>
        <div>
          <div className="text-caption uppercase text-[10px]">avg RT</div>
          <div className="text-xl tabular-nums">{props.avgRT.toFixed(1)}</div>
        </div>
        <div>
          <div className="text-caption uppercase text-[10px]">avg impr</div>
          <div className="text-xl tabular-nums">{props.avgImpr.toFixed(0)}</div>
        </div>
      </div>
    </div>
  );
}
