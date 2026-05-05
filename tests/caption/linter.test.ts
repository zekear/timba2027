import { describe, it, expect } from 'vitest';
import { lintCaption } from '../../src/caption/linter.js';

describe('lintCaption', () => {
  const allowed = { numbers: [45.2, 28.5, 6, 142000] };

  it('passes when all numbers in caption are in allowed set', () => {
    const r = lintCaption('Milei 45.2% en encuesta. Spread 28.5pp.', allowed);
    expect(r.ok).toBe(true);
  });

  it('passes when caption has no numbers', () => {
    const r = lintCaption('Milei consolida liderazgo según relevamiento reciente.', allowed);
    expect(r.ok).toBe(true);
  });

  it('fails when caption contains a hallucinated number', () => {
    const r = lintCaption('Milei 99.9% — récord histórico.', allowed);
    expect(r.ok).toBe(false);
    expect(r.violations).toContain('99.9');
  });

  it('treats integer literal differently from decimal', () => {
    const r = lintCaption('Sample n=1500.', allowed);
    expect(r.ok).toBe(false);
  });

  it('matches with small numeric tolerance', () => {
    const r = lintCaption('Milei 45.20% según Opinaia.', allowed);
    expect(r.ok).toBe(true);
  });

  it('flags forbidden words', () => {
    const r = lintCaption('Milei sin duda gana.', allowed);
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.includes('sin duda'))).toBe(true);
  });
});
