import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { extractJson } from '../../../src/sources/news/tagger.js';
import { z } from 'zod';

const tagSchema = z.object({
  candidates: z.array(z.string()),
  category: z.enum(['campania', 'gobierno', 'economia', 'escandalo', 'debate', 'otro']),
  relevance: z.number().min(0).max(1),
});

describe('extractJson', () => {
  it('parses clean JSON output', () => {
    const raw = readFileSync('tests/fixtures/llm-tag-clean.txt', 'utf-8');
    const json = extractJson(raw);
    const parsed = tagSchema.parse(json);
    expect(parsed.candidates).toEqual(['Javier Milei']);
    expect(parsed.category).toBe('gobierno');
    expect(parsed.relevance).toBeCloseTo(0.65);
  });

  it('extracts JSON from prose-wrapped output (markdown fence + comments)', () => {
    const raw = readFileSync('tests/fixtures/llm-tag-prose-wrapped.txt', 'utf-8');
    const json = extractJson(raw);
    const parsed = tagSchema.parse(json);
    expect(parsed.candidates).toEqual(['Milei', 'Kicillof']);
    expect(parsed.category).toBe('campania');
  });

  it('throws on output without any JSON', () => {
    const raw = readFileSync('tests/fixtures/llm-tag-malformed.txt', 'utf-8');
    expect(() => extractJson(raw)).toThrow(/no json/i);
  });

  it('throws on JSON-shaped but invalid-against-schema output', () => {
    // Tipo número fuera de rango — extractJson lo retorna OK; zod debe rechazarlo.
    const raw = '{"candidates": [], "category": "otro", "relevance": 1.5}';
    const json = extractJson(raw);
    expect(() => tagSchema.parse(json)).toThrow();
  });
});
