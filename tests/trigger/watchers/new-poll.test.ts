import { describe, it, expect, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../../../src/db/client.js';
import { polls, pollsters } from '../../../src/db/schema.js';
import { runNewPollWatcher } from '../../../src/trigger/watchers/new-poll.js';

const TEST_SLUG = 'test_pollster_npw';

beforeEach(async () => {
  await db.execute(sql`DELETE FROM events WHERE type = 'NEW_POLL'`);
  await db.execute(sql`DELETE FROM polls WHERE source_tweet_id LIKE 'test-npw-%'`);
  await db.execute(sql`DELETE FROM pollsters WHERE slug = ${TEST_SLUG}`);
  await db.insert(pollsters).values({ slug: TEST_SLUG, displayName: 'Test', xHandle: 'testhandle_npw' });
});

describe('runNewPollWatcher', () => {
  it('emits NEW_POLL for approved polls only', async () => {
    const [pollster] = await db.select().from(pollsters).where(sql`slug = ${TEST_SLUG}`);
    await db.insert(polls).values([
      {
        pollsterId: pollster.id,
        sourceUrl: 'https://x.com/i/status/test-npw-1',
        sourceTweetId: 'test-npw-1',
        results: [{ candidato: 'Milei', pct: 45 }, { candidato: 'Kicillof', pct: 28 }],
        confidence: 'alto',
        status: 'approved',
      },
      {
        pollsterId: pollster.id,
        sourceUrl: 'https://x.com/i/status/test-npw-2',
        sourceTweetId: 'test-npw-2',
        results: [{ candidato: 'Milei', pct: 47 }],
        confidence: 'alto',
        status: 'pending_review',
      },
    ]);

    const stats = await runNewPollWatcher();
    expect(stats.emitted).toBe(1);
    const rows = await db.execute(sql`SELECT * FROM events WHERE type = 'NEW_POLL'`);
    expect(rows.rows.length).toBe(1);
  });

  it('is idempotent — same approved poll does not re-emit', async () => {
    const [pollster] = await db.select().from(pollsters).where(sql`slug = ${TEST_SLUG}`);
    await db.insert(polls).values({
      pollsterId: pollster.id,
      sourceUrl: 'https://x.com/i/status/test-npw-3',
      sourceTweetId: 'test-npw-3',
      results: [{ candidato: 'Milei', pct: 45 }, { candidato: 'Kicillof', pct: 28 }],
      confidence: 'alto',
      status: 'auto_approved',
    });
    await runNewPollWatcher();
    const second = await runNewPollWatcher();
    expect(second.emitted).toBe(0);
  });
});
