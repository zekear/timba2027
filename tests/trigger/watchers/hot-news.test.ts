import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../../../src/db/client.js';
import { news } from '../../../src/db/schema.js';
import { runHotNewsWatcher } from '../../../src/trigger/watchers/hot-news.js';

beforeEach(async () => {
  await db.execute(sql`DELETE FROM events WHERE type = 'HOT_NEWS'`);
  await db.execute(sql`DELETE FROM news WHERE url LIKE 'https://test.example/hnw-%'`);
  // Pre-mark events for any *real* news that already qualifies, to prevent
  // the watcher from emitting them and inflating the counts in this test.
  // We insert dummy 'HOT_NEWS' events with the news ids so the LEFT JOIN
  // dedupe in runHotNewsWatcher excludes them.
  await db.execute(sql`
    INSERT INTO events (type, payload, status)
    SELECT 'HOT_NEWS', jsonb_build_object('newsId', n.id, '_test_isolation', true), 'processed'
    FROM news n
    LEFT JOIN events e ON e.type = 'HOT_NEWS' AND (e.payload->>'newsId')::int = n.id
    WHERE n.tagged_at IS NOT NULL
      AND n.relevance_score IS NOT NULL
      AND n.relevance_score >= 0.7
      AND jsonb_array_length(n.candidates_mentioned) > 0
      AND e.id IS NULL
  `);
});

afterEach(async () => {
  await db.execute(sql`DELETE FROM events WHERE type = 'HOT_NEWS'`);
  await db.execute(sql`DELETE FROM news WHERE url LIKE 'https://test.example/hnw-%'`);
});

describe('runHotNewsWatcher', () => {
  it('emits HOT_NEWS only for high relevance + candidate mentioned', async () => {
    await db.insert(news).values([
      {
        source: 'test',
        url: 'https://test.example/hnw-1',
        headline: 'Milei pivotó en política exterior',
        publishedAt: new Date(),
        candidatesMentioned: ['Milei'],
        category: 'gobierno',
        relevanceScore: '0.85',
        taggedAt: new Date(),
      },
      {
        source: 'test',
        url: 'https://test.example/hnw-2',
        headline: 'Color: chocolate del día',
        publishedAt: new Date(),
        candidatesMentioned: [],
        category: 'otro',
        relevanceScore: '0.20',
        taggedAt: new Date(),
      },
      {
        source: 'test',
        url: 'https://test.example/hnw-3',
        headline: 'Análisis del mercado financiero',
        publishedAt: new Date(),
        candidatesMentioned: [],
        category: 'economia',
        relevanceScore: '0.85',
        taggedAt: new Date(),
      },
    ]);

    const stats = await runHotNewsWatcher({ relevanceThreshold: 0.7 });
    expect(stats.emitted).toBe(1);
  });

  it('is idempotent — same article does not re-emit', async () => {
    await db.insert(news).values({
      source: 'test',
      url: 'https://test.example/hnw-4',
      headline: 'Milei: noticia X',
      publishedAt: new Date(),
      candidatesMentioned: ['Milei'],
      category: 'gobierno',
      relevanceScore: '0.90',
      taggedAt: new Date(),
    });
    await runHotNewsWatcher({ relevanceThreshold: 0.7 });
    const second = await runHotNewsWatcher({ relevanceThreshold: 0.7 });
    expect(second.emitted).toBe(0);
  });
});
