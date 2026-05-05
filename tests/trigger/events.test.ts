import { describe, it, expect, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../../src/db/client.js';
import { events } from '../../src/db/schema.js';
import { emitEvent, claimNextPendingEvent, markEventProcessed } from '../../src/trigger/events.js';

beforeEach(async () => {
  await db.execute(sql`DELETE FROM events WHERE type LIKE 'TEST_%'`);
});

describe('emitEvent', () => {
  it('inserts a new pending event', async () => {
    const id = await emitEvent('TEST_X', { foo: 'bar' });
    expect(id).toBeGreaterThan(0);
    const rows = await db.select().from(events).where(sql`${events.id} = ${id}`);
    expect(rows[0]?.status).toBe('pending');
    expect((rows[0]?.payload as { foo?: string }).foo).toBe('bar');
  });
});

describe('claimNextPendingEvent', () => {
  it('returns the oldest pending event and marks it as processing', async () => {
    const a = await emitEvent('TEST_A', { v: 1 });
    await emitEvent('TEST_B', { v: 2 });
    const claimed = await claimNextPendingEvent();
    expect(claimed?.id).toBe(a);
    expect(claimed?.type).toBe('TEST_A');
  });

  it('returns null when no pending events', async () => {
    const result = await claimNextPendingEvent();
    expect(result).toBeNull();
  });
});

describe('markEventProcessed', () => {
  it('moves status from processing to processed', async () => {
    const id = await emitEvent('TEST_DONE', {});
    await claimNextPendingEvent();
    await markEventProcessed(id);
    const rows = await db.select().from(events).where(sql`${events.id} = ${id}`);
    expect(rows[0]?.status).toBe('processed');
    expect(rows[0]?.processedAt).not.toBeNull();
  });
});
