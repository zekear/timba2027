import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractPollFromImage } from '../../../src/sources/polls/extractor.js';

vi.mock('../../../src/llm/index.js', () => ({
  llm: { extractFromImage: vi.fn(), classify: vi.fn(), generateText: vi.fn() },
}));

beforeEach(() => vi.clearAllMocks());

describe('extractPollFromImage', () => {
  it('parses a well-formed extraction', async () => {
    const { llm } = await import('../../../src/llm/index.js');
    (llm.extractFromImage as any).mockResolvedValue(JSON.stringify({
      pollster_hint: 'Opinaia',
      fecha_campo: '2026-04-28',
      sample_size: 1200,
      metodologia: 'online',
      results: [
        { candidato: 'Milei', pct: 45.2 },
        { candidato: 'Kicillof', pct: 28.5 },
      ],
    }));
    const result = await extractPollFromImage(Buffer.from('fake'));
    expect(result.pollster_hint).toBe('Opinaia');
    expect(result.results).toHaveLength(2);
    expect(result.results[0].pct).toBeCloseTo(45.2);
  });

  it('rejects extractions with fewer than 2 results', async () => {
    const { llm } = await import('../../../src/llm/index.js');
    (llm.extractFromImage as any).mockResolvedValue(JSON.stringify({
      pollster_hint: null,
      fecha_campo: null,
      sample_size: null,
      metodologia: null,
      results: [],
    }));
    await expect(extractPollFromImage(Buffer.from('fake'))).rejects.toThrow();
  });

  it('rejects pct out of [0, 100]', async () => {
    const { llm } = await import('../../../src/llm/index.js');
    (llm.extractFromImage as any).mockResolvedValue(JSON.stringify({
      pollster_hint: null,
      fecha_campo: null,
      sample_size: null,
      metodologia: null,
      results: [
        { candidato: 'A', pct: 150 },
        { candidato: 'B', pct: 50 },
      ],
    }));
    await expect(extractPollFromImage(Buffer.from('fake'))).rejects.toThrow();
  });
});
