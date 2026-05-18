import { sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import { emitEvent } from '../events.js';
import type { MilestoneEvent } from '../types.js';

export interface WatcherStats {
  candidatesChecked: number;
  emitted: number;
}

const MARKET_SLUG = 'argentina-presidential-election-winner';
// Thresholds memorables (números redondos que la audiencia política sigue)
const THRESHOLDS = [5, 10, 15, 20, 25, 30, 40, 50];
// Mínimo de días "desde la última vez" para que valga como milestone
const MIN_DAYS_SINCE = 14;
// Cooldown por (candidato, threshold, direction) para evitar oscilaciones
const COOLDOWN_HOURS = 72;

/**
 * Detecta milestones del tipo "X cruzó N% por primera vez en M días" en el
 * mercado presidencial 2027. Corre cada N horas; los precios cambian gradual
 * así que no vale chequear seguido.
 *
 * Algoritmo por candidato:
 *  1. Obtener pct actual.
 *  2. Para cada threshold T cercano (±5pp del pct actual):
 *     a. Decidir direction: si pct >= T → 'above', si pct < T → 'below'.
 *     b. Buscar la fecha más reciente en que el candidato estuvo del OTRO lado
 *        del threshold.
 *     c. Si esa fecha es >= MIN_DAYS_SINCE atrás → es milestone.
 *     d. Verificar cooldown (no postear el mismo trío en COOLDOWN_HOURS).
 *  3. Emitir solo el milestone "más memorable" por candidato (mayor daysSince).
 */
export async function runMilestoneWatcher(): Promise<WatcherStats> {
  const stats: WatcherStats = { candidatesChecked: 0, emitted: 0 };

  // Top 10 candidatos por price actual
  const latestRows = await db.execute(sql`
    SELECT DISTINCT ON (candidate) candidate, price::float * 100 AS pct
    FROM market_prices mp JOIN markets m ON m.id = mp.market_id
    WHERE m.slug = ${MARKET_SLUG}
    ORDER BY candidate, ts DESC
  `);
  const candidates = (latestRows.rows as Array<{ candidate: string; pct: number }>)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 10);
  stats.candidatesChecked = candidates.length;

  for (const c of candidates) {
    const milestone = await findMilestone(c.candidate, c.pct);
    if (!milestone) continue;

    // Cooldown: ¿posteamos uno igual en últimas COOLDOWN_HOURS?
    const dup = await db.execute(sql`
      SELECT 1 FROM events
      WHERE type = 'MILESTONE'
        AND payload->>'candidate' = ${milestone.candidate}
        AND (payload->>'threshold')::int = ${milestone.threshold}
        AND payload->>'direction' = ${milestone.direction}
        AND created_at > NOW() - INTERVAL '${sql.raw(String(COOLDOWN_HOURS))} hours'
      LIMIT 1
    `);
    if (dup.rows.length > 0) continue;

    await emitEvent('MILESTONE', milestone);
    stats.emitted++;
    logger.info(
      { candidate: milestone.candidate, threshold: milestone.threshold, direction: milestone.direction, daysSince: milestone.daysSince },
      'watcher: emitted MILESTONE',
    );
  }

  return stats;
}

/**
 * Para un candidato dado, encuentra el milestone más memorable (mayor daysSince)
 * o null si no hay nada noticiable.
 */
async function findMilestone(candidate: string, pctNow: number): Promise<MilestoneEvent | null> {
  // Solo evaluar thresholds dentro de ±5pp del precio actual (cruces recientes)
  const candidates = THRESHOLDS.filter((t) => Math.abs(pctNow - t) <= 5);
  if (candidates.length === 0) return null;

  let best: MilestoneEvent | null = null;

  for (const threshold of candidates) {
    const direction: 'above' | 'below' = pctNow >= threshold ? 'above' : 'below';
    // Buscar la última vez que estuvo del OTRO lado.
    // "above" → buscar última vez con pct < threshold. "below" → última con pct >= threshold.
    const lastOtherSide = await db.execute(
      direction === 'above'
        ? sql`
            SELECT MAX(ts) AS last_ts
            FROM market_prices mp JOIN markets m ON m.id = mp.market_id
            WHERE m.slug = ${MARKET_SLUG}
              AND mp.candidate = ${candidate}
              AND mp.price::float * 100 < ${threshold}
          `
        : sql`
            SELECT MAX(ts) AS last_ts
            FROM market_prices mp JOIN markets m ON m.id = mp.market_id
            WHERE m.slug = ${MARKET_SLUG}
              AND mp.candidate = ${candidate}
              AND mp.price::float * 100 >= ${threshold}
          `,
    );
    const row = lastOtherSide.rows[0] as { last_ts: Date | null } | undefined;
    if (!row?.last_ts) continue; // nunca estuvo del otro lado (caso edge)

    const daysSince = Math.floor((Date.now() - new Date(row.last_ts).getTime()) / (1000 * 60 * 60 * 24));
    if (daysSince < MIN_DAYS_SINCE) continue;

    if (!best || daysSince > best.daysSince) {
      best = { candidate, pctNow, threshold, direction, daysSince };
    }
  }

  return best;
}
