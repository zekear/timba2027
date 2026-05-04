import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { xTweetSchema, xMediaSchema } from '../../../src/sources/polls/x-client.js';

const dump = JSON.parse(readFileSync('tests/fixtures/x-timeline.json', 'utf-8'));

describe('X API schema (offline against fixture)', () => {
  it('all fixture tweets parse via xTweetSchema', () => {
    expect(dump.tweets.length).toBeGreaterThan(0);
    for (const t of dump.tweets) {
      const result = xTweetSchema.safeParse(t);
      expect(result.success, `tweet ${t.id} failed: ${result.success ? '' : JSON.stringify(result.error.flatten())}`).toBe(true);
    }
  });

  it('all fixture media parse via xMediaSchema', () => {
    for (const [, m] of dump.media as Array<[string, unknown]>) {
      const result = xMediaSchema.safeParse(m);
      expect(result.success).toBe(true);
    }
  });
});
