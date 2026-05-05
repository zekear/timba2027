import { db } from '../../db/client.js';
import { markets, marketPrices } from '../../db/schema.js';
import { logger } from '../../lib/logger.js';
import { fetchEventsByTag } from './client.js';
import { normalizeEvent } from './normalize.js';

const TAG_SLUGS = ['argentina'];

/**
 * Whitelist de slugs relevantes. El tag 'argentina' devuelve TODOS los
 * mercados AR (FIFA, judiciales, dólar, etc) — solo queremos los
 * electorales y los de inflación.
 */
function isRelevantEvent(slug: string): boolean {
  // Electorales / presidenciales
  if (/election|presidencial|president|legislativ|gobernador|gubernatura/i.test(slug)) return true;
  // Inflación AR
  if (/inflation|inflaci/i.test(slug)) return true;
  return false;
}

export async function runPolymarketIngest(): Promise<{ markets: number; prices: number; skipped: number }> {
  const start = Date.now();
  const seen = new Set<string>();
  let marketsCount = 0;
  let pricesCount = 0;
  let skipped = 0;

  for (const tag of TAG_SLUGS) {
    const events = await fetchEventsByTag(tag);
    for (const event of events) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);

      if (!isRelevantEvent(event.slug)) {
        skipped++;
        continue;
      }

      const { market, prices } = normalizeEvent(event);

      await db
        .insert(markets)
        .values(market)
        .onConflictDoUpdate({
          target: markets.id,
          set: {
            slug: market.slug,
            question: market.question,
            candidates: market.candidates,
            endDate: market.endDate,
            status: market.status,
            updatedAt: new Date(),
          },
        });
      marketsCount++;

      if (prices.length) {
        await db.insert(marketPrices).values(prices);
        pricesCount += prices.length;
      }
    }
  }

  logger.info(
    { marketsCount, pricesCount, skipped, ms: Date.now() - start },
    'polymarket: ingest complete',
  );
  return { markets: marketsCount, prices: pricesCount, skipped };
}
