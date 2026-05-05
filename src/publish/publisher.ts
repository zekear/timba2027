import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';
import { uploadMedia, createTweet } from './x-write-client.js';
import { markPublished } from './transitions.js';
import { policyForMode, type PublishMode } from './modes.js';

const MAX_PER_RUN = 3;

export interface PublisherStats {
  scheduled: number;
  published: number;
  failed: number;
  skippedShadow: number;
  skippedKillSwitch: number;
  skippedMode: number;
}

export async function runPublisher(): Promise<PublisherStats> {
  const stats: PublisherStats = {
    scheduled: 0,
    published: 0,
    failed: 0,
    skippedShadow: 0,
    skippedKillSwitch: 0,
    skippedMode: 0,
  };

  // Re-leer env vars (permite override en tests via process.env)
  const mode = (process.env.PUBLISH_MODE ?? env.PUBLISH_MODE) as PublishMode;
  const killSwitch =
    process.env.KILL_SWITCH !== undefined
      ? process.env.KILL_SWITCH === 'true'
      : env.KILL_SWITCH;

  if (killSwitch) {
    stats.skippedKillSwitch = await countScheduled();
    logger.warn({ mode }, 'publisher: KILL_SWITCH active — skipping');
    return stats;
  }

  const policy = policyForMode(mode);
  if (mode === 'shadow') {
    stats.skippedShadow = await countScheduled();
    return stats;
  }
  if (!policy.canPublish(new Date())) {
    stats.skippedMode = await countScheduled();
    logger.debug({ mode }, 'publisher: outside publish window for current mode');
    return stats;
  }

  const scheduled = await db.execute(sql`
    SELECT id, caption, card_path FROM bot_posts
    WHERE status = 'scheduled'
    ORDER BY generated_at ASC
    LIMIT ${MAX_PER_RUN}
  `);
  stats.scheduled = scheduled.rows.length;

  for (const row of scheduled.rows as Array<{ id: number; caption: string; card_path: string }>) {
    try {
      const cardBuf = await readFile(resolve(process.cwd(), row.card_path));
      const mediaId = await uploadMedia(cardBuf, 'image/png');
      const tweetId = await createTweet({ text: row.caption, mediaIds: [mediaId] });
      await markPublished(row.id, tweetId);
      stats.published++;
    } catch (err) {
      stats.failed++;
      logger.error(
        { postId: row.id, err: (err as Error).message },
        'publisher: failed to publish',
      );
    }
  }

  logger.info({ ...stats, mode }, 'publisher: run complete');
  return stats;
}

async function countScheduled(): Promise<number> {
  const r = await db.execute(sql`SELECT COUNT(*)::int AS c FROM bot_posts WHERE status = 'scheduled'`);
  return (r.rows[0] as { c: number }).c;
}
