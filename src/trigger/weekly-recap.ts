/**
 * Thread semanal: domingo 21h ART recap los últimos 7 días.
 *
 * Estructura del thread (~5 tweets):
 *   1. Cover (con card)            — hook + stats
 *   2. Polymarket presidencial     — top 3 movers
 *   3. Inflación                   — si hubo movimientos significativos (skip si no)
 *   4. Encuestas                   — pollsters que publicaron data nueva
 *   5. Hot news                    — top noticias relevantes (con link a la 1ra)
 *   6. Outro                       — CTA al sitio
 *
 * Cada tweet es una llamada al LLM por separado (mejor control + lint
 * independiente). Si no hay data en alguna sección, se skipea ese tweet.
 */
import { sql, desc, and, gte } from 'drizzle-orm';
import { db } from '../db/client.js';
import { botPosts, news } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { env } from '../lib/env.js';
import { renderToPng } from '../render/compose.js';
import { weeklyRecapCard } from '../render/cards/weekly-recap.js';
import { llm } from '../llm/index.js';
import { lintCaption, collectNumbers } from '../caption/linter.js';

const ELECTORAL_MARKET = 'argentina-presidential-election-winner';

interface CandidateMove {
  candidate: string;
  pctNow: number;
  pctThen: number;
  deltaPct: number;
}

interface PollEntry {
  pollster: string;
  publishedAt: Date;
  topCandidate: string;
  topPct: number;
}

interface NewsEntry {
  source: string;
  headline: string;
  url: string;
  relevance: number;
  candidates: string[];
}

interface RecapData {
  weekStart: Date;
  weekEnd: Date;
  topMovers: CandidateMove[];
  inflationSummary: { rangeShift: string | null } | null;
  newPolls: PollEntry[];
  hotNews: NewsEntry[];
  marketMovesCount: number;
  postsPublishedCount: number;
}

/**
 * Junta toda la data de los últimos 7 días.
 */
async function gatherWeekData(): Promise<RecapData> {
  const weekEnd = new Date();
  const weekStart = new Date(weekEnd.getTime() - 7 * 24 * 3600 * 1000);

  // 1. Top movers en mercado presidencial: comparar precio ahora vs hace 7 días
  const moversRes = await db.execute(sql`
    WITH latest AS (
      SELECT DISTINCT ON (mp.candidate) mp.candidate, mp.price::float * 100 AS pct
      FROM market_prices mp JOIN markets m ON m.id = mp.market_id
      WHERE m.slug = ${ELECTORAL_MARKET}
      ORDER BY mp.candidate, mp.ts DESC
    ),
    week_ago AS (
      SELECT DISTINCT ON (mp.candidate) mp.candidate, mp.price::float * 100 AS pct
      FROM market_prices mp JOIN markets m ON m.id = mp.market_id
      WHERE m.slug = ${ELECTORAL_MARKET} AND mp.ts <= NOW() - INTERVAL '7 days'
      ORDER BY mp.candidate, mp.ts DESC
    )
    SELECT l.candidate, l.pct AS pct_now, w.pct AS pct_then, (l.pct - w.pct) AS delta_pct
    FROM latest l JOIN week_ago w USING (candidate)
    ORDER BY ABS(l.pct - w.pct) DESC
    LIMIT 5
  `);
  const topMovers: CandidateMove[] = (moversRes.rows as Array<{
    candidate: string;
    pct_now: number;
    pct_then: number;
    delta_pct: number;
  }>)
    .filter((r) => Math.abs(r.delta_pct) >= 1)
    .slice(0, 3)
    .map((r) => ({
      candidate: r.candidate,
      pctNow: r.pct_now,
      pctThen: r.pct_then,
      deltaPct: r.delta_pct,
    }));

  // 2. Encuestas nuevas (status approved/auto_approved en últimos 7 días).
  //    Polls.results es jsonb [{candidato, pct}, ...] — extraemos top candidato.
  const sevenDaysAgo = new Date(weekEnd.getTime() - 7 * 24 * 3600 * 1000);
  const pollsRes = await db.execute(sql`
    SELECT p.id, p.results, p.ingested_at, p.fecha_campo, ps.display_name AS pollster
    FROM polls p
    JOIN pollsters ps ON ps.id = p.pollster_id
    WHERE p.status IN ('approved', 'auto_approved')
      AND p.ingested_at >= ${sevenDaysAgo}
    ORDER BY p.ingested_at DESC
    LIMIT 10
  `);
  const newPolls: PollEntry[] = (pollsRes.rows as Array<{
    id: number;
    pollster: string;
    ingested_at: Date;
    fecha_campo: Date | null;
    results: Array<{ candidato: string; pct: number }>;
  }>)
    .map((r) => {
      const top = (r.results ?? []).slice().sort((a, b) => b.pct - a.pct)[0];
      if (!top) return null;
      return {
        pollster: r.pollster,
        publishedAt: r.fecha_campo ?? r.ingested_at,
        topCandidate: top.candidato,
        topPct: top.pct,
      };
    })
    .filter((x): x is PollEntry => x != null);

  // 3. Hot news: top 5 con relevance >= 0.7
  const newsRows = await db
    .select()
    .from(news)
    .where(and(gte(news.publishedAt, sevenDaysAgo), gte(news.relevanceScore, '0.7')))
    .orderBy(desc(news.relevanceScore), desc(news.publishedAt))
    .limit(5);
  const hotNews: NewsEntry[] = newsRows.map((n) => ({
    source: n.source,
    headline: n.headline,
    url: n.url,
    relevance: Number(n.relevanceScore ?? 0),
    candidates: (n.candidatesMentioned as string[]) ?? [],
  }));

  // 4. Stats de actividad propia
  const movesCountRes = await db.execute(sql`
    SELECT COUNT(*)::int AS c FROM bot_posts
    WHERE shape = 'market_move' AND status = 'published' AND published_at >= ${sevenDaysAgo}
  `);
  const postsCountRes = await db.execute(sql`
    SELECT COUNT(*)::int AS c FROM bot_posts
    WHERE status = 'published' AND published_at >= ${sevenDaysAgo}
  `);

  return {
    weekStart,
    weekEnd,
    topMovers,
    inflationSummary: null, // por ahora no incluimos sección de inflación; se puede agregar después
    newPolls,
    hotNews,
    marketMovesCount: (movesCountRes.rows[0] as { c: number }).c,
    postsPublishedCount: (postsCountRes.rows[0] as { c: number }).c,
  };
}

function dayLabel(d: Date): string {
  return d.toLocaleDateString('es-AR', {
    day: 'numeric',
    month: 'short',
    timeZone: 'America/Argentina/Buenos_Aires',
  });
}

async function llmTweet(promptBody: string, allowedNumbers: number[]): Promise<string> {
  const prompt = `${promptBody}

Devolvé EXCLUSIVAMENTE el texto del tweet (sin prefijos, sin comillas).
Reglas:
- Máximo 240 caracteres.
- Solo podés usar números que aparecen en los datos provistos arriba.
- Tono factual, español rioplatense, sin opinión política.
- Sin hashtags. Máximo 1 emoji al inicio si la sección lo amerita.`;

  for (let i = 0; i < 3; i++) {
    const raw = await llm.classify(prompt, { model: 'haiku' });
    const text = raw.trim().replace(/^["']|["']$/g, '');
    const lint = lintCaption(text, { numbers: allowedNumbers });
    if (lint.ok && text.length > 0 && text.length <= 270) return text;
    logger.debug({ violations: lint.violations, length: text.length, attempt: i }, 'recap: tweet retry');
  }
  // Fallback: devolver lo último (mejor algo que nada — la mayoría de drafts son revisados a mano)
  return (await llm.classify(prompt, { model: 'haiku' })).trim().replace(/^["']|["']$/g, '');
}

interface ThreadEntry {
  caption: string;
  cardPath?: string;
}

export async function runWeeklyRecap(): Promise<{ ok: true; postId: number } | { ok: false; reason: string }> {
  logger.info({}, 'weekly-recap: starting');
  const data = await gatherWeekData();

  if (data.topMovers.length === 0 && data.newPolls.length === 0 && data.hotNews.length === 0) {
    logger.warn({}, 'weekly-recap: no data this week, skipping');
    return { ok: false, reason: 'no_data' };
  }

  const weekStartLabel = dayLabel(data.weekStart);
  const weekEndLabel = dayLabel(data.weekEnd);

  // ── Cover card ───────────────────────────────────────────────
  const topMover = data.topMovers[0];
  const card = weeklyRecapCard({
    weekStartLabel,
    weekEndLabel,
    marketMovesCount: data.marketMovesCount,
    pollsCount: data.newPolls.length,
    hotNewsCount: data.hotNews.length,
    topMover: topMover ? { candidate: topMover.candidate, deltaPct: topMover.deltaPct, priceNow: topMover.pctNow } : undefined,
    timestamp: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' }) + ' GMT-3',
    handle: env.BOT_HANDLE,
  });
  const { relPath: cardPath } = await renderToPng(card, `weekly-recap-${data.weekEnd.toISOString().slice(0, 10)}`);

  // ── Tweet 1: Cover (hook) ────────────────────────────────────
  const allowed1 = collectNumbers({
    moves: data.marketMovesCount,
    polls: data.newPolls.length,
    news: data.hotNews.length,
    topMoverDelta: topMover?.deltaPct,
  });
  const headCaption = await llmTweet(
    `Vas a abrir un thread semanal de recap político argentino (datos de los últimos 7 días).
Este es el primer tweet (hook). Anunciá que viene un thread, mencioná 1-2 datos clave del resumen.

Datos del resumen:
- Moves de mercado en Polymarket: ${data.marketMovesCount}
- Encuestas nuevas detectadas: ${data.newPolls.length}
- Noticias hot detectadas: ${data.hotNews.length}
${topMover ? `- Top mover: ${topMover.candidate} ${topMover.deltaPct >= 0 ? '+' : ''}${topMover.deltaPct.toFixed(1)}pp` : ''}

Empezá con 🧵. Mencioná que es de Polymarket + encuestas + noticias. Cierra invitando a leer el hilo (sin decir "abajo" ni "👇").`,
    allowed1,
  );

  // ── Tweet 2: Polymarket movers ───────────────────────────────
  const replies: ThreadEntry[] = [];
  if (data.topMovers.length > 0) {
    const allowed2 = collectNumbers(data.topMovers);
    const moversText = data.topMovers
      .map((m) => `${m.candidate}: ${m.pctThen.toFixed(1)}% → ${m.pctNow.toFixed(1)}% (${m.deltaPct >= 0 ? '+' : ''}${m.deltaPct.toFixed(1)}pp)`)
      .join('\n');
    const cap = await llmTweet(
      `Tweet 2 del thread (sigue al primero). Sección: Polymarket — Presidencia 2027.
Reportá los top movers de la semana. Sin opinión.

Datos:
${moversText}

Estructura sugerida: "Polymarket presidencia: [candidato 1] subió/bajó X pp (de Y a Z%); [candidato 2] [opuesto]; [candidato 3] [delta]."`,
      allowed2,
    );
    replies.push({ caption: cap });
  }

  // ── Tweet 3: Encuestas ───────────────────────────────────────
  if (data.newPolls.length > 0) {
    const allowed3 = collectNumbers(data.newPolls);
    const pollsText = data.newPolls
      .slice(0, 5)
      .map((p) => `${p.pollster}: ${p.topCandidate} ${p.topPct.toFixed(1)}%`)
      .join('\n');
    const cap = await llmTweet(
      `Tweet 3 del thread. Sección: Encuestas de la semana.
${data.newPolls.length} encuesta${data.newPolls.length === 1 ? '' : 's'} relevante${data.newPolls.length === 1 ? '' : 's'} detectada${data.newPolls.length === 1 ? '' : 's'}. Mencioná los pollsters y el primero/segundo más mencionado.

Datos:
${pollsText}

Estructura: "Encuestas: [pollster1] da [candidate] X%; [pollster2] [candidate] Y%; ..." o un resumen narrativo si todas coinciden.`,
      allowed3,
    );
    replies.push({ caption: cap });
  }

  // ── Tweet 4: Hot news ────────────────────────────────────────
  if (data.hotNews.length > 0) {
    const top1 = data.hotNews[0]!;
    const allowed4 = collectNumbers(data.hotNews);
    const newsText = data.hotNews
      .slice(0, 3)
      .map((n) => `[${n.source}] ${n.headline}`)
      .join('\n');
    const cap = await llmTweet(
      `Tweet 4 del thread. Sección: Noticias que movieron la semana.
${data.hotNews.length} noticia${data.hotNews.length === 1 ? '' : 's'} top. Resumí 2-3 con frase corta cada una. Cerrá con el link a la primera (es la más relevante).

Datos:
${newsText}

Estructura: "Noticias: [headline 1 acortada] · [headline 2] · [headline 3]." Termina con "${top1.url}" (X auto-acorta a t.co, ocupa 23 chars).`,
      allowed4,
    );
    replies.push({ caption: cap });
  }

  // ── Tweet 5: Outro ───────────────────────────────────────────
  replies.push({
    caption: `Datos completos en timba2027.com — Polymarket + encuestas + noticias.\n\nSin opinión. Con fuente. 100% automatizado.`,
  });

  // ── Insert draft ─────────────────────────────────────────────
  const inserted = await db
    .insert(botPosts)
    .values({
      shape: 'weekly_recap',
      status: 'draft',
      caption: headCaption,
      cardPath,
      sourceSnapshot: data,
      llmMetadata: { source: 'weekly-recap' },
      thread: replies,
    })
    .returning({ id: botPosts.id });

  logger.info(
    { postId: inserted[0].id, threadLength: replies.length },
    'weekly-recap: draft created',
  );
  return { ok: true, postId: inserted[0].id };
}
