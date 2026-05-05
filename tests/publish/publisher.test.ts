import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sql, eq } from 'drizzle-orm';
import { db } from '../../src/db/client.js';
import { botPosts } from '../../src/db/schema.js';

vi.mock('../../src/publish/x-write-client.js', () => ({
  uploadMedia: vi.fn().mockResolvedValue('media-99'),
  createTweet: vi.fn().mockResolvedValue('tweet-12345'),
}));

beforeEach(async () => {
  await db.execute(sql`DELETE FROM bot_posts WHERE caption LIKE 'test-pub-%'`);
  vi.clearAllMocks();
});

describe('runPublisher', () => {
  it('publishes scheduled posts and marks them published', async () => {
    process.env.PUBLISH_MODE = 'full';
    process.env.KILL_SWITCH = 'false';
    const { runPublisher } = await import('../../src/publish/publisher.js');
    const { writeFileSync, mkdirSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    mkdirSync(resolve(process.cwd(), 'storage/cards'), { recursive: true });
    writeFileSync(resolve(process.cwd(), 'storage/cards/test-pub.png'), Buffer.from('fakepng'));

    const [p] = await db.insert(botPosts).values({
      shape: 'market_move',
      status: 'scheduled',
      caption: 'test-pub-publish',
      cardPath: 'storage/cards/test-pub.png',
      sourceSnapshot: {},
      llmMetadata: {},
    }).returning({ id: botPosts.id });

    const stats = await runPublisher();
    expect(stats.published).toBeGreaterThanOrEqual(1);

    const [updated] = await db.select().from(botPosts).where(eq(botPosts.id, p.id));
    expect(updated.status).toBe('published' as never);
    expect(updated.xPostId).toBe('tweet-12345');
  });

  it('does not publish in shadow mode', async () => {
    process.env.PUBLISH_MODE = 'shadow';
    process.env.KILL_SWITCH = 'false';
    const { runPublisher } = await import('../../src/publish/publisher.js');
    const stats = await runPublisher();
    expect(stats.published).toBe(0);
  });

  it('honors KILL_SWITCH', async () => {
    process.env.PUBLISH_MODE = 'full';
    process.env.KILL_SWITCH = 'true';
    const { runPublisher } = await import('../../src/publish/publisher.js');
    const stats = await runPublisher();
    expect(stats.published).toBe(0);
    process.env.KILL_SWITCH = 'false';
  });
});
