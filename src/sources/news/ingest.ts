import { sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { news } from '../../db/schema.js';
import { fetchWithTimeout } from '../../lib/http.js';
import { logger } from '../../lib/logger.js';
import { FEEDS } from './feeds.js';
import { parseRssXml, type NewsItem } from './parse.js';

async function fetchFeed(url: string): Promise<string> {
  const res = await fetchWithTimeout(url, {
    timeoutMs: 15_000,
    headers: { accept: 'application/rss+xml,application/xml,*/*' },
  });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.text();
}

export async function runNewsIngest(): Promise<{ inserted: number; skipped: number }> {
  const start = Date.now();
  let inserted = 0;
  let skipped = 0;

  for (const feed of FEEDS.filter((f) => f.active)) {
    try {
      const xml = await fetchFeed(feed.url);
      const items = await parseRssXml(xml);
      logger.debug({ source: feed.source, count: items.length }, 'news: feed parsed');

      for (const item of items) {
        const result = await db
          .insert(news)
          .values({
            source: feed.source,
            url: item.url,
            headline: item.headline,
            bodyExcerpt: item.bodyExcerpt,
            publishedAt: item.publishedAt,
          })
          .onConflictDoNothing({ target: news.url })
          .returning({ id: news.id });
        if (result.length === 1) inserted++;
        else skipped++;
      }
    } catch (err) {
      logger.warn({ source: feed.source, err: (err as Error).message }, 'news: feed failed');
    }
  }

  logger.info({ inserted, skipped, ms: Date.now() - start }, 'news: ingest complete');
  return { inserted, skipped };
}
