import { env } from '../../lib/env.js';
import { logger } from '../../lib/logger.js';
import { polymarketEventSchema, type PolymarketEvent } from './types.js';

/**
 * Fetch eventos de Polymarket por tag o slug.
 * El endpoint Gamma `/events` permite filtrar por `tag_slug=argentina-elections-2027` o similar.
 */
export async function fetchEventsByTag(tagSlug: string): Promise<PolymarketEvent[]> {
  const url = `${env.POLYMARKET_API_BASE}/events?tag_slug=${encodeURIComponent(tagSlug)}&closed=false&archived=false&limit=50`;
  logger.debug({ url }, 'polymarket: fetching events');

  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`Polymarket fetch failed: ${res.status} ${res.statusText}`);
  }

  const json: unknown = await res.json();
  if (!Array.isArray(json)) {
    throw new Error(`Polymarket returned non-array: ${typeof json}`);
  }

  const parsed: PolymarketEvent[] = [];
  for (const item of json) {
    const result = polymarketEventSchema.safeParse(item);
    if (result.success) {
      parsed.push(result.data);
    } else {
      logger.warn({ errors: result.error.flatten() }, 'polymarket: skipping malformed event');
    }
  }
  return parsed;
}
