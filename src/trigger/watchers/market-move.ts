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
 * Detecta movimientos vía detectMoves() y emite UN event MARKET_MOVE
 * por mercado, agrupando co-moves del mismo mercado como siblings.
 *
 * - El move "principal" del evento es el de mayor |deltaPct|.
 * - Siblings son los demás moves del mismo mercado, ordenados por |deltaPct|.
 * - Dedupe por marketId (no por candidato): si en las últimas N horas ya
 *   hubo un evento de ese mercado, no emitir otro.
 *
 * Esto evita el ruido de mercados con buckets correlacionados (ej:
 * inflación, donde varios buckets co-mueven en cada actualización).
 */
export async function runMarketMoveWatcher(opts: {
  thresholdPct: number;
  windowHours: number;
  dedupeHours?: number;
}): Promise<WatcherStats> {
  const { thresholdPct, windowHours } = opts;
  const dedupeHours = opts.dedupeHours ?? 4;
  const moves = await detectMoves({ thresholdPct, windowHours });

  const groups = new Map<string, typeof moves>();
  for (const m of moves) {
    if (!groups.has(m.marketId)) groups.set(m.marketId, []);
    groups.get(m.marketId)!.push(m);
  }
  for (const arr of groups.values()) {
    arr.sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct));
  }

  const stats: WatcherStats = { detected: moves.length, emitted: 0, dedupedAlreadyEmitted: 0 };

  for (const [marketId, marketMoves] of groups) {
    const existing = await db.execute(sql`
      SELECT 1 FROM events
      WHERE type = 'MARKET_MOVE'
        AND payload->>'marketId' = ${marketId}
        AND created_at > NOW() - (${dedupeHours} || ' hours')::interval
      LIMIT 1
    `);
    if (existing.rows.length > 0) {
      stats.dedupedAlreadyEmitted++;
      continue;
    }

    const primary = marketMoves[0]!;
    const siblings = marketMoves.slice(1).map((m) => ({
      candidate: m.candidate,
      priceNow: m.priceNow,
      priceThen: m.priceThen,
      deltaPct: m.deltaPct,
    }));

    const payload: MarketMoveEvent = {
      marketId: primary.marketId,
      marketSlug: primary.marketSlug,
      marketQuestion: primary.marketQuestion,
      candidate: primary.candidate,
      priceNow: primary.priceNow,
      priceThen: primary.priceThen,
      deltaPct: primary.deltaPct,
      windowHours: primary.windowHours,
      siblings,
    };
    await emitEvent('MARKET_MOVE', payload);
    stats.emitted++;
    logger.info(
      {
        marketId,
        primary: primary.candidate,
        primaryDelta: primary.deltaPct,
        siblingsCount: siblings.length,
      },
      'watcher: emitted MARKET_MOVE',
    );
  }
  return stats;
}
