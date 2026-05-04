import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { parseRssXml } from '../../../src/sources/news/parse.js';

describe('parseRssXml', () => {
  it('parses fixture into items with required fields', async () => {
    const xml = readFileSync('tests/fixtures/rss-clarin.xml', 'utf-8');
    const items = await parseRssXml(xml);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.url).toMatch(/^https?:\/\//);
      expect(item.headline.length).toBeGreaterThan(0);
      expect(item.publishedAt).toBeInstanceOf(Date);
    }
  });
});
