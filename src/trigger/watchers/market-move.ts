import { sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import { detectMoves } from '../../sources/polymarket/moves.js';
import { emitEvent } from '../events.js';
import type { MarketMoveEvent } from '../types.js';

export interface WatcherStats {
  detected: number;
  emitted: number;
  dedupedAlreadyEmitted: number;
}

/**
 * Detecta movimientos vía detectMoves() y emite events MARKET_MOVE.
 * Dedupes: si ya hay un MARKET_MOVE event en últimas N horas para el mismo
 * (marketId, candidate), no emitir uno nuevo.
 */
export async function runMarketMoveWatcher(opts: {
  thresholdPct: number;
  windowHours: number;
  dedupeHours?: number;
}): Promise<WatcherStats> {
  const { thresholdPct, windowHours } = opts;
  const dedupeHours = opts.dedupeHours ?? 4;
  const moves = await detectMoves({ thresholdPct, windowHours });

  const stats: WatcherStats = { detected: moves.length, emitted: 0, dedupedAlreadyEmitted: 0 };

  for (const move of moves) {
    const existing = await db.execute(sql`
      SELECT 1 FROM events
      WHERE type = 'MARKET_MOVE'
        AND payload->>'marketId' = ${move.marketId}
        AND payload->>'candidate' = ${move.candidate}
        AND created_at > NOW() - (${dedupeHours} || ' hours')::interval
      LIMIT 1
    `);
    if (existing.rows.length > 0) {
      stats.dedupedAlreadyEmitted++;
      continue;
    }

    const payload: MarketMoveEvent = {
      marketId: move.marketId,
      marketSlug: move.marketSlug,
      marketQuestion: move.marketQuestion,
      candidate: move.candidate,
      priceNow: move.priceNow,
      priceThen: move.priceThen,
      deltaPct: move.deltaPct,
      windowHours: move.windowHours,
    };
    await emitEvent('MARKET_MOVE', payload);
    stats.emitted++;
    logger.info({ ...payload }, 'watcher: emitted MARKET_MOVE');
  }
  return stats;
}
