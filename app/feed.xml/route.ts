import { desc, eq } from 'drizzle-orm';
import { db } from '../../src/db/client.js';
import { botPosts } from '../../src/db/schema.js';
import { env } from '../../src/lib/env.js';
import { splitCaptionAndUrl } from '../lib/caption-display.js';

const FEED_SIZE = 50;

const SHAPE_LABEL: Record<string, string> = {
  morning_brief: 'Morning brief',
  market_move: 'Polymarket move',
  new_poll: 'Nueva encuesta',
  hot_news: 'Hot news',
};

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function GET() {
  const site = env.SITE_URL.replace(/\/$/, '');
  const updated = new Date().toISOString();

  const posts = await db
    .select()
    .from(botPosts)
    .where(eq(botPosts.status, 'published'))
    .orderBy(desc(botPosts.publishedAt))
    .limit(FEED_SIZE);

  const entries = posts
    .map((p) => {
      const { text } = splitCaptionAndUrl(p.caption);
      const id = `${site}/posts/${p.id}`;
      const title = `${SHAPE_LABEL[p.shape] ?? p.shape} — ${text.slice(0, 80)}${text.length > 80 ? '…' : ''}`;
      const pubDate = (p.publishedAt ?? new Date()).toISOString();
      return `  <entry>
    <id>${id}</id>
    <title>${escapeXml(title)}</title>
    <link href="${id}"/>
    <updated>${pubDate}</updated>
    <published>${pubDate}</published>
    <summary>${escapeXml(text)}</summary>
  </entry>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Timba 2027 — la timba electoral argentina</title>
  <subtitle>Polymarket + encuestas + noticias mainstream automatizadas rumbo al 2027.</subtitle>
  <link href="${site}/feed.xml" rel="self" type="application/atom+xml"/>
  <link href="${site}/" rel="alternate" type="text/html"/>
  <id>${site}/</id>
  <updated>${updated}</updated>
${entries}
</feed>
`;

  return new Response(xml, {
    headers: {
      'content-type': 'application/atom+xml; charset=utf-8',
      'cache-control': 'public, max-age=600',
    },
  });
}
