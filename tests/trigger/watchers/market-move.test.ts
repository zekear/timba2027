import { describe, it, expect, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../../../src/db/client.js';
import { markets, marketPrices } from '../../../src/db/schema.js';
import { runMarketMoveWatcher } from '../../../src/trigger/watchers/market-move.js';

const TEST_MARKET_ID = 'test-watcher-market';

beforeEach(async () => {
  await db.execute(sql`DELETE FROM market_prices WHERE market_id = ${TEST_MARKET_ID}`);
  await db.execute(sql`DELETE FROM markets WHERE id = ${TEST_MARKET_ID}`);
  await db.execute(sql`DELETE FROM events WHERE type = 'MARKET_MOVE' AND payload->>'marketId' = ${TEST_MARKET_ID}`);
  await db.insert(markets).values({
    id: TEST_MARKET_ID,
    slug: 'test',
    question: 'Test',
    candidates: ['Alice'],
    status: 'open',
  });
  const sixHoursAgo = new Date(Date.now() - 6 * 3600 * 1000);
  await db.insert(marketPrices).values([
    { marketId: TEST_MARKET_ID, candidate: 'Alice', price: '0.4000', ts: sixHoursAgo },
    { marketId: TEST_MARKET_ID, candidate: 'Alice', price: '0.5000', ts: new Date() },
  ]);
});

describe('runMarketMoveWatcher', () => {
  it('emits a MARKET_MOVE event for the detected move', async () => {
    const stats = await runMarketMoveWatcher({ thresholdPct: 2, windowHours: 6 });
    expect(stats.emitted).toBeGreaterThanOrEqual(1);
    const rows = await db.execute(sql`
      SELECT type, payload FROM events
      WHERE type = 'MARKET_MOVE' AND payload->>'marketId' = ${TEST_MARKET_ID}
    `);
    expect(rows.rows.length).toBe(1);
  });

  it('is idempotent — re-running does not re-emit if no new prices arrive', async () => {
    await runMarketMoveWatcher({ thresholdPct: 2, windowHours: 6 });
    const stats2 = await runMarketMoveWatcher({ thresholdPct: 2, windowHours: 6 });
    // The test market should NOT re-emit (it's still in dedupe window)
    const rows = await db.execute(sql`
      SELECT count(*)::int AS c FROM events
      WHERE type = 'MARKET_MOVE' AND payload->>'marketId' = ${TEST_MARKET_ID}
    `);
    expect((rows.rows[0] as { c: number }).c).toBe(1);
  });
});
