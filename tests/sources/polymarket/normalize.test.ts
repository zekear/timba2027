import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { normalizeEvent } from '../../../src/sources/polymarket/normalize.js';
import { polymarketEventSchema } from '../../../src/sources/polymarket/types.js';

const raw = JSON.parse(readFileSync('tests/fixtures/polymarket-event.json', 'utf-8'));
const event = polymarketEventSchema.parse(raw);

describe('normalizeEvent', () => {
  it('returns one market record per polymarket event', () => {
    const { market } = normalizeEvent(event);
    expect(market.id).toBe(event.id);
    expect(market.slug).toBe(event.slug);
    expect(market.candidates.length).toBeGreaterThan(0);
  });

  it('returns price records only for markets with valid outcomes/prices', () => {
    const { prices } = normalizeEvent(event);
    expect(prices.length).toBeGreaterThan(0);
    for (const p of prices) {
      const numericPrice = Number(p.price);
      expect(numericPrice).toBeGreaterThanOrEqual(0);
      expect(numericPrice).toBeLessThanOrEqual(1);
      expect(p.candidate).toBeTruthy();
    }
  });

  it('extracts candidate names — every priced candidate is in market.candidates', () => {
    const { market, prices } = normalizeEvent(event);
    for (const p of prices) {
      expect(market.candidates).toContain(p.candidate);
    }
  });
});
