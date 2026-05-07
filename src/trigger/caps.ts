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
    const cd = await candidateCooldownActive(opts.candidateFocus, {
      hours: opts.cooldownHours ?? 4,
    });
    if (cd) return { ok: false, reason: 'candidate_cooldown' };
  }
  return { ok: true };
}
