import { describe, it, expect, beforeEach } from 'vitest';
import { sql, eq } from 'drizzle-orm';
import { db } from '../../src/db/client.js';
import { botPosts } from '../../src/db/schema.js';
import { approveDraft, killPost, schedulePost, markPublished } from '../../src/publish/transitions.js';

let testPostId: number;

beforeEach(async () => {
  await db.execute(sql`DELETE FROM bot_posts WHERE caption LIKE 'test-tx-%'`);
  const [p] = await db.insert(botPosts).values({
    shape: 'market_move',
    status: 'draft',
    caption: 'test-tx-' + Math.random(),
    cardPath: 'storage/cards/x.png',
    sourceSnapshot: {},
    llmMetadata: {},
  }).returning({ id: botPosts.id });
  testPostId = p.id;
});

describe('approveDraft', () => {
  it('moves draft → approved', async () => {
    await approveDraft(testPostId);
    const [p] = await db.select().from(botPosts).where(eq(botPosts.id, testPostId));
    expect(p.status).toBe('approved' as never);
  });
  it('throws if post is already published', async () => {
    await db.update(botPosts).set({ status: 'published' }).where(eq(botPosts.id, testPostId));
    await expect(approveDraft(testPostId)).rejects.toThrow(/draft/i);
  });
});

describe('killPost', () => {
  it('moves any non-published status → killed', async () => {
    await killPost(testPostId);
    const [p] = await db.select().from(botPosts).where(eq(botPosts.id, testPostId));
    expect(p.status).toBe('killed' as never);
  });
  it('refuses to kill an already published post', async () => {
    await db.update(botPosts).set({ status: 'published' }).where(eq(botPosts.id, testPostId));
    await expect(killPost(testPostId)).rejects.toThrow(/published/i);
  });
});

describe('schedulePost', () => {
  it('moves approved → scheduled', async () => {
    await db.update(botPosts).set({ status: 'approved' }).where(eq(botPosts.id, testPostId));
    await schedulePost(testPostId);
    const [p] = await db.select().from(botPosts).where(eq(botPosts.id, testPostId));
    expect(p.status).toBe('scheduled' as never);
  });
});

describe('markPublished', () => {
  it('moves scheduled → published with x_post_id', async () => {
    await db.update(botPosts).set({ status: 'scheduled' }).where(eq(botPosts.id, testPostId));
    await markPublished(testPostId, 'tweet-12345');
    const [p] = await db.select().from(botPosts).where(eq(botPosts.id, testPostId));
    expect(p.status).toBe('published' as never);
    expect(p.xPostId).toBe('tweet-12345');
    expect(p.publishedAt).not.toBeNull();
  });
});
