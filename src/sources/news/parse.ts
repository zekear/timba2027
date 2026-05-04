import Parser from 'rss-parser';

export interface NewsItem {
  url: string;
  headline: string;
  bodyExcerpt: string | null;
  publishedAt: Date;
}

const parser = new Parser({
  customFields: { item: ['content:encoded', 'description'] },
});

export async function parseRssXml(xml: string): Promise<NewsItem[]> {
  const feed = await parser.parseString(xml);
  const items: NewsItem[] = [];
  for (const it of feed.items) {
    const url = it.link?.trim();
    const headline = it.title?.trim();
    const dateStr = it.isoDate ?? it.pubDate;
    if (!url || !headline || !dateStr) continue;
    const publishedAt = new Date(dateStr);
    if (Number.isNaN(publishedAt.getTime())) continue;
    items.push({
      url,
      headline,
      bodyExcerpt: stripHtml(it.contentSnippet ?? it.content ?? it['content:encoded'] ?? '').slice(0, 500) || null,
      publishedAt,
    });
  }
  return items;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}
