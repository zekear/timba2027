import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { botPosts } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { renderToPng } from '../render/compose.js';
import { renderFramesToGif } from '../render/gif.js';
import { morningBriefCard } from '../render/cards/morning-brief.js';
import { morningBriefFrames } from '../render/frames.js';
import { generateCaption } from '../caption/generate.js';
import { canPostNow } from './caps.js';
import { env } from '../lib/env.js';
import { llmTweet } from './weekly-recap.js';
import { collectNumbers } from '../caption/linter.js';

interface ThreadEntry {
  caption: string;
  cardPath?: string;
}

export async function runMorningBrief(): Promise<{ ok: boolean; postId?: number; reason?: string }> {
  const cap = await canPostNow({ now: new Date(), candidateFocus: null });
  if (!cap.ok) {
    logger.info({ reason: cap.reason }, 'morning-brief: skipped');
    return { ok: false, reason: cap.reason };
  }

  const existing = await db.execute(sql`
    SELECT 1 FROM bot_posts
    WHERE shape = 'morning_brief'
      AND status IN ('draft', 'scheduled', 'published')
      AND generated_at > NOW() - INTERVAL '18 hours'
    LIMIT 1
  `);
  if (existing.rows.length > 0) {
    logger.info({ reason: 'already_drafted_today' }, 'morning-brief: skipped');
    return { ok: false, reason: 'already_drafted_today' };
  }

  // Top 5 con delta 7d (cover card)
  const top5Rows = await db.execute(sql`
    WITH latest AS (
      SELECT DISTINCT ON (candidate) candidate, price::float AS price
      FROM market_prices mp JOIN markets m ON m.id = mp.market_id
      WHERE m.slug = 'argentina-presidential-election-winner'
      ORDER BY candidate, ts DESC
    ),
    week_ago AS (
      SELECT DISTINCT ON (candidate) candidate, price::float AS price
      FROM market_prices mp JOIN markets m ON m.id = mp.market_id
      WHERE m.slug = 'argentina-presidential-election-winner'
        AND ts <= NOW() - INTERVAL '7 days'
      ORDER BY candidate, ts DESC
    )
    SELECT l.candidate, l.price * 100 AS pct, (l.price - COALESCE(w.price, l.price)) * 100 AS delta_pct
    FROM latest l LEFT JOIN week_ago w USING (candidate)
    ORDER BY l.price DESC LIMIT 5;
  `);

  if (top5Rows.rows.length < 3) {
    logger.warn({ count: top5Rows.rows.length }, 'morning-brief: not enough data');
    return { ok: false, reason: 'insufficient_data' };
  }

  const top = (top5Rows.rows as Array<{ candidate: string; pct: number; delta_pct: number }>).map((r) => ({
    candidato: r.candidate,
    pct: r.pct,
    deltaPct: r.delta_pct,
  }));

  // Top movers 24h (para tweet 2)
  const moversRows = await db.execute(sql`
    WITH latest AS (
      SELECT DISTINCT ON (candidate) candidate, price::float AS price
      FROM market_prices mp JOIN markets m ON m.id = mp.market_id
      WHERE m.slug = 'argentina-presidential-election-winner'
      ORDER BY candidate, ts DESC
    ),
    day_ago AS (
      SELECT DISTINCT ON (candidate) candidate, price::float AS price
      FROM market_prices mp JOIN markets m ON m.id = mp.market_id
      WHERE m.slug = 'argentina-presidential-election-winner'
        AND ts <= NOW() - INTERVAL '24 hours'
      ORDER BY candidate, ts DESC
    )
    SELECT l.candidate, l.price * 100 AS pct_now, (l.price - COALESCE(d.price, l.price)) * 100 AS delta_pct
    FROM latest l LEFT JOIN day_ago d USING (candidate)
    WHERE ABS((l.price - COALESCE(d.price, l.price)) * 100) >= 0.5
    ORDER BY ABS((l.price - COALESCE(d.price, l.price)) * 100) DESC
    LIMIT 3;
  `);
  const topMovers = (moversRows.rows as Array<{ candidate: string; pct_now: number; delta_pct: number }>).map((r) => ({
    candidate: r.candidate,
    pctNow: r.pct_now,
    deltaPct: r.delta_pct,
  }));

  // Hot news más relevante en últimas 24h (para tweet 3)
  const newsRows = await db.execute(sql`
    SELECT n.source, n.headline, n.url, n.relevance_score::float AS relevance
    FROM news n
    WHERE n.tagged_at IS NOT NULL
      AND n.relevance_score IS NOT NULL
      AND n.published_at > NOW() - INTERVAL '24 hours'
    ORDER BY n.relevance_score DESC, n.published_at DESC
    LIMIT 1;
  `);
  const topNews = newsRows.rows.length > 0
    ? (newsRows.rows[0] as { source: string; headline: string; url: string; relevance: number })
    : null;

  // Cover card (mismo que antes)
  const date = new Date();
  const dateStr = `${date.getUTCDate()} ${['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'][date.getUTCMonth()]} ${date.getUTCFullYear()}`;
  const cardInput = {
    topCandidates: top,
    marketDate: dateStr,
    timestamp: '09:00 GMT-3',
    handle: env.BOT_HANDLE,
  };
  const filename = `morning-brief-${date.toISOString().slice(0, 10)}`;
  let relPath: string;
  if (env.ANIMATED_CARDS) {
    const frames = morningBriefFrames(cardInput);
    ({ relPath } = await renderFramesToGif(frames, filename));
  } else {
    ({ relPath } = await renderToPng(morningBriefCard(cardInput), filename));
  }

  // Tweet 1 (head): caption original — usa LLM con shape morning_brief.
  // Sigue siendo el "hook" del thread.
  const captionData = { topCandidates: top };
  const head = await generateCaption({ shape: 'morning_brief', data: captionData });

  // Tweet 2: top movers 24h
  const replies: ThreadEntry[] = [];
  if (topMovers.length > 0) {
    const moversText = topMovers
      .map((m) => `${m.candidate}: ${m.pctNow.toFixed(1)}% (${m.deltaPct >= 0 ? '+' : ''}${m.deltaPct.toFixed(1)}pp/24h)`)
      .join('\n');
    const cap = await llmTweet(
      `Tweet 2 del thread "Morning brief". Sección: movimientos del último día.
${topMovers.length} candidato${topMovers.length === 1 ? '' : 's'} con movimiento ≥0.5pp en 24h. Reportá sin opinión.

Datos:
${moversText}

Estructura sugerida: "Últimas 24h: [candidato 1] [delta] (a [pct]%); [candidato 2] [delta] (a [pct]%); ..."`,
      collectNumbers(topMovers),
    );
    replies.push({ caption: cap });
  }

  // Tweet 3: noticia caliente del día
  if (topNews) {
    const cap = await llmTweet(
      `Tweet 3 del thread "Morning brief". Sección: noticia política caliente del día.
Una noticia destacada de las últimas 24h (relevancia ${topNews.relevance.toFixed(2)}). Resumí en 1 frase corta y al final incluí la URL EXACTAMENTE como te la doy.

Datos:
- Fuente: ${topNews.source}
- Headline: ${topNews.headline}
- URL: ${topNews.url}

Estructura: "[Resumen 1 frase corta]. <URL provista>"`,
      collectNumbers({ relevance: topNews.relevance }),
      { allowedUrls: [topNews.url] },
    );
    replies.push({ caption: cap });
  }

  // Tweet 4: outro
  replies.push({
    caption: `Más en timba2027.com — Polymarket + encuestas + noticias.\n\nSin opinión. Con fuente. 100% automatizado.`,
  });

  const inserted = await db.insert(botPosts).values({
    shape: 'morning_brief',
    status: 'draft',
    caption: head.caption,
    cardPath: relPath,
    sourceSnapshot: { topCandidates: top, topMovers, topNews },
    llmMetadata: {
      source: head.source,
      attempts: head.attempts,
      lintViolations: head.lintViolations,
      rawOutputs: head.rawOutputs,
    },
    thread: replies,
  }).returning({ id: botPosts.id });

  logger.info(
    { postId: inserted[0].id, source: head.source, threadLength: replies.length },
    'morning-brief: drafted',
  );
  return { ok: true, postId: inserted[0].id };
}
