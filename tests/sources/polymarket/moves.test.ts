import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db } from '../../../src/db/client.js';
import { markets, marketPrices } from '../../../src/db/schema.js';
import { detectMoves } from '../../../src/sources/polymarket/moves.js';
import { sql } from 'drizzle-orm';

const TEST_MARKET_ID = 'test-market-moves';

beforeEach(async () => {
  await db.execute(sql`DELETE FROM market_prices WHERE market_id = ${TEST_MARKET_ID}`);
  await db.execute(sql`DELETE FROM markets WHERE id = ${TEST_MARKET_ID}`);
  await db.insert(markets).values({
    id: TEST_MARKET_ID,
    slug: 'test',
    question: 'Test market',
    candidates: ['Alice', 'Bob'],
    status: 'open',
  });
});

afterAll(async () => {
  await db.execute(sql`DELETE FROM market_prices WHERE market_id = ${TEST_MARKET_ID}`);
  await db.execute(sql`DELETE FROM markets WHERE id = ${TEST_MARKET_ID}`);
});

describe('detectMoves', () => {
  it('reports a move when delta exceeds threshold within window', async () => {
    const now = new Date();
    const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);
    await db.insert(marketPrices).values([
      { marketId: TEST_MARKET_ID, candidate: 'Alice', price: '0.4000', ts: sixHoursAgo },
      { marketId: TEST_MARKET_ID, candidate: 'Alice', price: '0.4500', ts: now },
    ]);

    const moves = await detectMoves({ thresholdPct: 2, windowHours: 6 });
    const aliceMove = moves.find((m) => m.candidate === 'Alice' && m.marketId === TEST_MARKET_ID);
    expect(aliceMove).toBeDefined();
    expect(aliceMove!.deltaPct).toBeCloseTo(5, 1); // 0.45 - 0.40 = 0.05 = 5pp
  });

  it('does not report a move under threshold', async () => {
    const now = new Date();
    const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);
    await db.insert(marketPrices).values([
      { marketId: TEST_MARKET_ID, candidate: 'Bob', price: '0.4000', ts: sixHoursAgo },
      { marketId: TEST_MARKET_ID, candidate: 'Bob', price: '0.4100', ts: now }, // 1pp delta
    ]);

    const moves = await detectMoves({ thresholdPct: 2, windowHours: 6 });
    const bobMove = moves.find((m) => m.candidate === 'Bob' && m.marketId === TEST_MARKET_ID);
    expect(bobMove).toBeUndefined();
  });
});
