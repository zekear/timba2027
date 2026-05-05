import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { botPosts } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { renderToPng } from '../render/compose.js';
import { morningBriefCard } from '../render/cards/morning-brief.js';
import { generateCaption } from '../caption/generate.js';
import { canPostNow } from './caps.js';

export async function runMorningBrief(): Promise<{ ok: boolean; postId?: number; reason?: string }> {
  const cap = await canPostNow({ now: new Date(), candidateFocus: null });
  if (!cap.ok) return { ok: false, reason: cap.reason };

  const rows = await db.execute(sql`
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

  if (rows.rows.length < 3) {
    logger.warn({ count: rows.rows.length }, 'morning-brief: not enough data');
    return { ok: false, reason: 'insufficient_data' };
  }

  const top = (rows.rows as Array<{ candidate: string; pct: number; delta_pct: number }>).map((r) => ({
    candidato: r.candidate,
    pct: r.pct,
    deltaPct: r.delta_pct,
  }));

  const date = new Date();
  const dateStr = `${date.getUTCDate()} ${['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'][date.getUTCMonth()]} ${date.getUTCFullYear()}`;

  const card = morningBriefCard({
    topCandidates: top,
    marketDate: dateStr,
    timestamp: '09:00 GMT-3',
    handle: '@politica',
  });

  const filename = `morning-brief-${date.toISOString().slice(0, 10)}`;
  const { relPath } = await renderToPng(card, filename);

  const captionData = { topCandidates: top };
  const cap_ = await generateCaption({ shape: 'morning_brief', data: captionData });

  const inserted = await db.insert(botPosts).values({
    shape: 'morning_brief',
    status: 'draft',
    caption: cap_.caption,
    cardPath: relPath,
    sourceSnapshot: captionData,
    llmMetadata: { source: cap_.source, attempts: cap_.attempts, lintViolations: cap_.lintViolations },
  }).returning({ id: botPosts.id });

  logger.info({ postId: inserted[0].id, source: cap_.source }, 'morning-brief: drafted');
  return { ok: true, postId: inserted[0].id };
}
