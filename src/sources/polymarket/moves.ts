import { sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';

export interface MarketMove {
  marketId: string;
  candidate: string;
  priceNow: number;
  priceThen: number;
  deltaPct: number;       // points percentuales (puede ser negativo)
  windowHours: number;
  detectedAt: Date;
}

/**
 * Detecta candidatos cuyo precio se movió más de `thresholdPct` (en pp)
 * dentro de las últimas `windowHours` horas.
 *
 * Lógica:
 *   priceNow   = precio más reciente (último ts)
 *   priceThen  = precio más cercano a (now - windowHours)
 *   deltaPct   = (priceNow - priceThen) * 100
 */
export async function detectMoves(opts: {
  thresholdPct: number;
  windowHours: number;
}): Promise<MarketMove[]> {
  const { thresholdPct, windowHours } = opts;
  const now = new Date();

  // Para cada (market_id, candidate), traemos el precio más reciente
  // y el precio más cercano al borde de la ventana.
  const rows = await db.execute(sql`
    WITH latest AS (
      SELECT DISTINCT ON (market_id, candidate)
        market_id, candidate, price::float AS price, ts
      FROM market_prices
      ORDER BY market_id, candidate, ts DESC
    ),
    earlier AS (
      SELECT DISTINCT ON (market_id, candidate)
        market_id, candidate, price::float AS price, ts
      FROM market_prices
      WHERE ts <= ${new Date(now.getTime() - windowHours * 3600 * 1000)}
      ORDER BY market_id, candidate, ts DESC
    )
    SELECT
      l.market_id,
      l.candidate,
      l.price AS price_now,
      e.price AS price_then,
      (l.price - e.price) * 100 AS delta_pct
    FROM latest l
    JOIN earlier e USING (market_id, candidate)
    WHERE ABS(l.price - e.price) * 100 >= ${thresholdPct};
  `);

  const moves: MarketMove[] = (rows.rows as Array<Record<string, unknown>>).map((r) => ({
    marketId: r.market_id as string,
    candidate: r.candidate as string,
    priceNow: Number(r.price_now),
    priceThen: Number(r.price_then),
    deltaPct: Number(r.delta_pct),
    windowHours,
    detectedAt: now,
  }));

  if (moves.length) {
    logger.info({ count: moves.length, thresholdPct, windowHours }, 'polymarket: moves detected');
  }
  return moves;
}
