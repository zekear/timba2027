import type { MetadataRoute } from 'next';
import { sql, eq } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { botPosts, pollsters } from '../src/db/schema.js';
import { candidateToSlug } from './lib/slug.js';

const BASE = process.env.SITE_URL ?? 'http://localhost:3000';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const entries: MetadataRoute.Sitemap = [
    { url: `${BASE}/`, lastModified: now, priority: 1.0, changeFrequency: 'hourly' },
    { url: `${BASE}/2027`, lastModified: now, priority: 0.9, changeFrequency: 'hourly' },
  ];

  const posts = await db
    .select({ id: botPosts.id, publishedAt: botPosts.publishedAt })
    .from(botPosts)
    .where(eq(botPosts.status, 'published'));
  for (const p of posts) {
    entries.push({
      url: `${BASE}/posts/${p.id}`,
      lastModified: p.publishedAt ?? now,
      priority: 0.7,
      changeFrequency: 'never',
    });
  }

  const candRes = await db.execute(sql`
    SELECT DISTINCT candidate FROM market_prices mp
    JOIN markets m ON m.id = mp.market_id
    WHERE m.slug = 'argentina-presidential-election-winner'
  `);
  for (const row of candRes.rows as Array<{ candidate: string }>) {
    entries.push({
      url: `${BASE}/c/${candidateToSlug(row.candidate)}`,
      lastModified: now,
      priority: 0.8,
      changeFrequency: 'daily',
    });
  }

  const ps = await db.select({ slug: pollsters.slug }).from(pollsters);
  for (const p of ps) {
    entries.push({
      url: `${BASE}/encuestadora/${p.slug}`,
      lastModified: now,
      priority: 0.6,
      changeFrequency: 'weekly',
    });
  }

  return entries;
}
