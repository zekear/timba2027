import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { pollsters } from '../../db/schema.js';
import { logger } from '../../lib/logger.js';
import { getUserByUsername, getUserTimeline } from './x-client.js';
import { processTweet, type ProcessTweetResult } from './pipeline.js';

const TWEETS_PER_POLLSTER = 10;

export interface PollsIngestStats {
  pollsters: number;
  pollsterErrors: number;
  tweetsSeen: number;
  inserted: number;
  bySkipReason: Record<string, number>;
}

export async function runPollsIngest(): Promise<PollsIngestStats> {
  const start = Date.now();
  const stats: PollsIngestStats = {
    pollsters: 0,
    pollsterErrors: 0,
    tweetsSeen: 0,
    inserted: 0,
    bySkipReason: {},
  };

  const active = await db.select().from(pollsters).where(eq(pollsters.active, true));

  for (const p of active) {
    stats.pollsters++;
    try {
      // Resolve x_user_id si no está cacheado
      let xUserId = p.xUserId;
      if (!xUserId) {
        const user = await getUserByUsername(p.xHandle);
        xUserId = user.id;
        await db.update(pollsters).set({ xUserId }).where(eq(pollsters.id, p.id));
        logger.info({ pollster: p.slug, handle: p.xHandle, xUserId }, 'polls: resolved x_user_id');
      }

      const page = await getUserTimeline(xUserId, {
        maxResults: TWEETS_PER_POLLSTER,
        sinceId: p.lastSeenTweetId ?? undefined,
      });
      stats.tweetsSeen += page.tweets.length;

      // Update checkpoint to the highest tweet id we saw (X snowflake ids are
      // strings of equal length where lexicographic order matches numeric order)
      if (page.tweets.length > 0) {
        const maxId = page.tweets.reduce(
          (acc, t) => (t.id > acc ? t.id : acc),
          page.tweets[0].id,
        );
        if (!p.lastSeenTweetId || maxId > p.lastSeenTweetId) {
          await db.update(pollsters).set({ lastSeenTweetId: maxId }).where(eq(pollsters.id, p.id));
        }
      }

      for (const tweet of page.tweets) {
        const mediaKeys = tweet.attachments?.media_keys ?? [];
        const attached = mediaKeys
          .map((k) => page.media.get(k))
          .filter((m): m is NonNullable<typeof m> => !!m);

        const result: ProcessTweetResult = await processTweet({
          pollsterDbId: p.id,
          tweet,
          attachedMedia: attached,
        });

        if (result.status === 'inserted') {
          stats.inserted++;
          logger.info({ pollster: p.slug, pollId: result.pollId, tweetId: tweet.id }, 'polls: inserted');
        } else {
          stats.bySkipReason[result.status] = (stats.bySkipReason[result.status] ?? 0) + 1;
        }
      }
    } catch (err) {
      stats.pollsterErrors++;
      logger.warn({ pollster: p.slug, handle: p.xHandle, err: (err as Error).message }, 'polls: pollster ingest failed');
    }
  }

  logger.info(
    { ...stats, ms: Date.now() - start },
    'polls: ingest complete',
  );
  return stats;
}
