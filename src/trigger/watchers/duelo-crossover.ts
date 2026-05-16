import { sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import { emitEvent } from '../events.js';
import type { CrossoverEvent } from '../types.js';

export interface WatcherStats {
  pairsChecked: number;
  emitted: number;
}

const MARKET_SLUG = 'argentina-presidential-election-winner';

interface RankRow {
  candidate: string;
  pct: number;
  rank: number;
}

/**
 * Detecta crossovers en el top 5 de Polymarket: pares (A, B) donde A
 * supera a B respecto a un snapshot anterior (24h atrás).
 *
 * Para evitar ruido por flicker, sólo emite cuando:
 *  - El swap se sostuvo: usamos las muestras de hace 24h y la actual (no
 *    se chequea cada movimiento intermedio).
 *  - El pair (passer, passed) no fue emitido en las últimas 72h (cooldown).
 *
 * Solo se emite un CROSSOVER event por par; si hubo múltiples overtakes
 * en una misma corrida, se priorizan los que afectan el top 3.
 */
export async function runCrossoverWatcher(): Promise<WatcherStats> {
  const stats: WatcherStats = { pairsChecked: 0, emitted: 0 };

  const nowRows = await db.execute(sql`
    SELECT DISTINCT ON (candidate) candidate, (price::float * 100) AS pct
    FROM market_prices mp JOIN markets m ON m.id = mp.market_id
    WHERE m.slug = ${MARKET_SLUG}
    ORDER BY candidate, ts DESC
  `);
  const beforeRows = await db.execute(sql`
    SELECT DISTINCT ON (candidate) candidate, (price::float * 100) AS pct
    FROM market_prices mp JOIN markets m ON m.id = mp.market_id
    WHERE m.slug = ${MARKET_SLUG}
      AND ts <= NOW() - INTERVAL '24 hours'
    ORDER BY candidate, ts DESC
  `);

  const top5Now = rankTop5(nowRows.rows as Array<{ candidate: string; pct: number }>);
  const top5Before = rankTop5(beforeRows.rows as Array<{ candidate: string; pct: number }>);
  if (top5Now.length < 2 || top5Before.length < 2) return stats;

  const beforeMap = new Map(top5Before.map((r) => [r.candidate, r]));
  const nowMap = new Map(top5Now.map((r) => [r.candidate, r]));

  // Buscar pares (A pasa a B): A.rankNow < B.rankNow, A.rankBefore > B.rankBefore
  const pairs: CrossoverEvent[] = [];
  for (const a of top5Now) {
    const aBefore = beforeMap.get(a.candidate);
    if (!aBefore) continue;
    for (const b of top5Now) {
      if (a.candidate === b.candidate) continue;
      const bBefore = beforeMap.get(b.candidate);
      if (!bBefore) continue;
      if (a.rank < b.rank && aBefore.rank > bBefore.rank) {
        pairs.push({
          marketId: '',
          passer: a.candidate,
          passed: b.candidate,
          rankNow: a.rank,
          rankBefore: aBefore.rank,
          passerPctNow: a.pct,
          passedPctNow: b.pct,
          passerPctBefore: aBefore.pct,
          passedPctBefore: bBefore.pct,
        });
      }
    }
  }
  stats.pairsChecked = pairs.length;

  // Cooldown 72h por par exacto
  for (const p of pairs) {
    const dup = await db.execute(sql`
      SELECT 1 FROM events
      WHERE type = 'CROSSOVER'
        AND payload->>'passer' = ${p.passer}
        AND payload->>'passed' = ${p.passed}
        AND created_at > NOW() - INTERVAL '72 hours'
      LIMIT 1
    `);
    if (dup.rows.length > 0) continue;

    // Buscar marketId actual (sólo informativo, no condiciona el match)
    const m = await db.execute(sql`SELECT id FROM markets WHERE slug = ${MARKET_SLUG} LIMIT 1`);
    if (m.rows.length === 0) break;
    p.marketId = (m.rows[0] as { id: string }).id;

    // Re-validar el cruce — el shape de pct ahora viene en % (0-100), pero
    // los pcts internos del schema son numbers, OK.
    if (Math.abs(p.passerPctNow - p.passedPctNow) > 15) continue; // overtakes implausibles

    await emitEvent('CROSSOVER', p);
    stats.emitted++;
    logger.info({ passer: p.passer, passed: p.passed }, 'watcher: emitted CROSSOVER');
  }

  return stats;
}

function rankTop5(rows: Array<{ candidate: string; pct: number }>): RankRow[] {
  return rows
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 5)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}
