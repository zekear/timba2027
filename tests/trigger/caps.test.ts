import { describe, it, expect, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../../src/db/client.js';
import { botPosts } from '../../src/db/schema.js';
import { canPostNow, dailyPostCount, candidateCooldownActive, isQuietHour } from '../../src/trigger/caps.js';

beforeEach(async () => {
  await db.execute(sql`DELETE FROM bot_posts`);
});

describe('caps', () => {
  it('isQuietHour true between 1am and 7am ARG (=GMT-3)', () => {
    const t1 = new Date('2026-05-04T05:00:00-03:00');
    expect(isQuietHour(t1)).toBe(true);
    const t2 = new Date('2026-05-04T13:00:00-03:00');
    expect(isQuietHour(t2)).toBe(false);
  });

  it('dailyPostCount returns 0 with no posts today', async () => {
    expect(await dailyPostCount()).toBe(0);
  });

  it('dailyPostCount counts published+draft within last 24h', async () => {
    await db.insert(botPosts).values({
      shape: 'market_move',
      caption: 'x',
      cardPath: 'storage/cards/x.png',
      sourceSnapshot: {},
      llmMetadata: {},
      status: 'draft',
    });
    expect(await dailyPostCount()).toBe(1);
  });

  it('candidateCooldownActive returns true when same candidate posted within window', async () => {
    await db.insert(botPosts).values({
      shape: 'market_move',
      caption: 'x',
      cardPath: 'storage/cards/x.png',
      sourceSnapshot: {},
      llmMetadata: {},
      candidateFocus: 'Milei',
      status: 'draft',
    });
    expect(await candidateCooldownActive('Milei', { hours: 4 })).toBe(true);
    expect(await candidateCooldownActive('Kicillof', { hours: 4 })).toBe(false);
  });

  it('canPostNow combines all checks', async () => {
    const noon = new Date('2026-05-04T12:00:00-03:00');
    const r = await canPostNow({ now: noon, candidateFocus: 'Milei' });
    expect(r.ok).toBe(true);
  });
});
