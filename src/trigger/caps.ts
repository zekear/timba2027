import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { env } from '../lib/env.js';

// Cap de publicación por día. Se aplica solo al publisher (drafts
// usan bypassDailyCap). Default 30 — el usuario aprueba qué se
// postea, así que la barrera real es manual. Configurable via
// DAILY_PUBLISH_CAP env var.
const QUIET_START_HOUR = 1;
const QUIET_END_HOUR = 7;

/**
 * Convierte una Date a hora del día en ARG (UTC-3).
 */
function hourInArg(d: Date): number {
  const utc = d.getUTCHours();
  return (utc + 24 - 3) % 24;
}

export function isQuietHour(now: Date): boolean {
  const h = hourInArg(now);
  return h >= QUIET_START_HOUR && h < QUIET_END_HOUR;
}

export async function dailyPostCount(): Promise<number> {
  const r = await db.execute(sql`
    SELECT COUNT(*)::int AS c FROM bot_posts
    WHERE status IN ('draft', 'scheduled', 'published')
      AND generated_at > NOW() - INTERVAL '24 hours'
  `);
  return (r.rows[0] as { c: number }).c;
}

export async function candidateCooldownActive(
  candidate: string,
  opts: { hours: number },
): Promise<boolean> {
  const r = await db.execute(sql`
    SELECT 1 FROM bot_posts
    WHERE candidate_focus = ${candidate}
      AND status IN ('draft', 'scheduled', 'published')
      AND generated_at > NOW() - (${opts.hours} || ' hours')::interval
    LIMIT 1
  `);
  return r.rows.length > 0;
}

const ELECTORAL_MARKET_SLUG = 'argentina-presidential-election-winner';

/**
 * Cooldown ajustado por tier. Frontrunners de Polymarket pueden
 * postearse más seguido (1h); mid-tier 4h (default); fringe / inflation
 * buckets / nombres no encontrados, 12h.
 *
 * El threshold se calcula sobre el último precio en el mercado
 * presidencial principal. Auto-tunea: si un candidato sube en el
 * mercado, su cooldown baja sin tocar código.
 */
export async function cooldownHoursForCandidate(candidate: string): Promise<number> {
  const r = await db.execute(sql`
    SELECT mp.price::float * 100 AS pct
    FROM market_prices mp
    JOIN markets m ON m.id = mp.market_id
    WHERE m.slug = ${ELECTORAL_MARKET_SLUG} AND mp.candidate = ${candidate}
    ORDER BY mp.ts DESC
    LIMIT 1
  `);
  const pct = (r.rows[0] as { pct: number } | undefined)?.pct ?? 0;
  if (pct >= 10) return 1;
  if (pct >= 2) return 4;
  return 12;
}

export interface CanPostResult {
  ok: boolean;
  reason?: string;
}

export async function canPostNow(opts: {
  now: Date;
  candidateFocus: string | null;
  cooldownHours?: number;
  bypassQuietHours?: boolean;
  bypassDailyCap?: boolean;
}): Promise<CanPostResult> {
  if (!opts.bypassQuietHours && isQuietHour(opts.now)) {
    return { ok: false, reason: 'quiet_hour' };
  }
  if (!opts.bypassDailyCap) {
    const count = await dailyPostCount();
    if (count >= env.DAILY_PUBLISH_CAP) {
      return { ok: false, reason: 'daily_cap' };
    }
  }
  if (opts.candidateFocus) {
    const hours = opts.cooldownHours ?? (await cooldownHoursForCandidate(opts.candidateFocus));
    const cd = await candidateCooldownActive(opts.candidateFocus, { hours });
    if (cd) return { ok: false, reason: 'candidate_cooldown' };
  }
  return { ok: true };
}
