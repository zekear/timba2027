import { sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import { emitEvent } from '../events.js';
import type { NewPollEvent } from '../types.js';

export interface WatcherStats {
  candidates: number;
  emitted: number;
  dedupedAlreadyEmitted: number;
}

/**
 * Detecta polls con status approved/auto_approved que aún no han sido
 * convertidas a un NEW_POLL event. Idempotente vía LEFT JOIN contra events.
 */
export async function runNewPollWatcher(): Promise<WatcherStats> {
  const candidates = await db.execute(sql`
    SELECT p.id, p.results, ps.slug AS pollster_slug
    FROM polls p
    JOIN pollsters ps ON ps.id = p.pollster_id
    LEFT JOIN events e ON e.type = 'NEW_POLL'
                       AND (e.payload->>'pollId')::int = p.id
    WHERE p.status IN ('approved', 'auto_approved')
      AND p.ingested_at > NOW() - INTERVAL '7 days'
      AND e.id IS NULL
  `);

  const stats: WatcherStats = {
    candidates: candidates.rows.length,
    emitted: 0,
    dedupedAlreadyEmitted: 0,
  };

  for (const row of candidates.rows as Array<{ id: number; results: unknown; pollster_slug: string }>) {
    const results = row.results as Array<{ candidato: string; pct: number }>;
    if (!results.length) continue;
    // Top candidate = mayor pct
    const top = results.reduce((acc, r) => (r.pct > acc.pct ? r : acc), results[0]);
    const payload: NewPollEvent = {
      pollId: row.id,
      pollsterSlug: row.pollster_slug,
      topCandidate: top.candidato,
      topCandidatePct: top.pct,
    };
    await emitEvent('NEW_POLL', payload);
    stats.emitted++;
    logger.info({ ...payload }, 'watcher: emitted NEW_POLL');
  }
  return stats;
}
