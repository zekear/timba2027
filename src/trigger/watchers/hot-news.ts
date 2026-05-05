import { sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import { emitEvent } from '../events.js';
import type { HotNewsEvent } from '../types.js';

export interface WatcherStats {
  candidates: number;
  emitted: number;
}

/**
 * Detecta noticias relevanceScore > threshold + al menos un candidato top
 * mencionado, que aún no generaron evento. Si en las últimas 24h hubo un
 * movimiento de Polymarket >2% para alguno de esos candidatos, lo
 * adjuntamos como `correlatedMove`.
 */
export async function runHotNewsWatcher(opts: {
  relevanceThreshold: number;
}): Promise<WatcherStats> {
  const { relevanceThreshold } = opts;
  const threshold = relevanceThreshold.toFixed(2);
  const candidatesResult = await db.execute(sql`
    SELECT n.id, n.source, n.headline, n.candidates_mentioned AS candidates_mentioned,
           n.relevance_score::float AS relevance_score
    FROM news n
    LEFT JOIN events e ON e.type = 'HOT_NEWS'
                       AND (e.payload->>'newsId')::int = n.id
    WHERE n.tagged_at IS NOT NULL
      AND n.relevance_score IS NOT NULL
      AND n.relevance_score >= ${threshold}::numeric
      AND jsonb_array_length(n.candidates_mentioned) > 0
      AND n.published_at > NOW() - INTERVAL '48 hours'
      AND e.id IS NULL
  `);

  const stats: WatcherStats = { candidates: candidatesResult.rows.length, emitted: 0 };

  for (const row of candidatesResult.rows as Array<{
    id: number;
    source: string;
    headline: string;
    candidates_mentioned: string[];
    relevance_score: number;
  }>) {
    const candidates = row.candidates_mentioned ?? [];
    if (!candidates.length) continue;

    // Buscar correlación con un market move reciente (24h) para los candidatos mencionados
    // Build ARRAY['cand1','cand2'] literal so postgres receives a single array param
    const candidateArrayLiteral = sql.join(
      candidates.map((c) => sql`${c}`),
      sql`, `,
    );
    const corr = await db.execute(sql`
      SELECT candidate, ((latest.price - earlier.price) * 100)::float AS delta_pct
      FROM (
        SELECT DISTINCT ON (candidate) candidate, price::float AS price
        FROM market_prices
        WHERE candidate = ANY(ARRAY[${candidateArrayLiteral}])
        ORDER BY candidate, ts DESC
      ) latest
      JOIN (
        SELECT DISTINCT ON (candidate) candidate, price::float AS price
        FROM market_prices
        WHERE candidate = ANY(ARRAY[${candidateArrayLiteral}])
          AND ts <= NOW() - INTERVAL '24 hours'
        ORDER BY candidate, ts DESC
      ) earlier USING (candidate)
      WHERE ABS(latest.price - earlier.price) * 100 >= 2
      LIMIT 1
    `);

    const correlatedMove = corr.rows.length
      ? {
          candidate: (corr.rows[0] as { candidate: string }).candidate,
          deltaPct: (corr.rows[0] as { delta_pct: number }).delta_pct,
        }
      : null;

    const payload: HotNewsEvent = {
      newsId: row.id,
      source: row.source,
      headline: row.headline,
      candidatesMentioned: candidates,
      relevanceScore: row.relevance_score,
      correlatedMove,
    };
    await emitEvent('HOT_NEWS', payload);
    stats.emitted++;
    logger.info({ newsId: row.id, source: row.source, hasCorrelation: !!correlatedMove }, 'watcher: emitted HOT_NEWS');
  }
  return stats;
}
