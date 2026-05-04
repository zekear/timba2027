import { db } from '../../db/client.js';
import { markets, marketPrices } from '../../db/schema.js';
import { logger } from '../../lib/logger.js';
import { fetchEventsByTag } from './client.js';
import { normalizeEvent } from './normalize.js';

const TAG_SLUGS = ['argentina'];

export async function runPolymarketIngest(): Promise<{ markets: number; prices: number }> {
  const start = Date.now();
  const seen = new Set<string>();
  let marketsCount = 0;
  let pricesCount = 0;

  for (const tag of TAG_SLUGS) {
    const events = await fetchEventsByTag(tag);
    for (const event of events) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);

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
    { marketsCount, pricesCount, ms: Date.now() - start },
    'polymarket: ingest complete',
  );
  return { markets: marketsCount, prices: pricesCount };
}
