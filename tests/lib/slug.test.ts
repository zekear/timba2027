import { describe, it, expect } from 'vitest';
import { candidateToSlug, slugToCandidate } from '../../app/lib/slug.js';

describe('candidateToSlug', () => {
  it('lowercases + replaces spaces with hyphens', () => {
    expect(candidateToSlug('Javier Milei')).toBe('javier-milei');
    expect(candidateToSlug('Cristina Fernández de Kirchner')).toBe('cristina-fernandez-de-kirchner');
  });

  it('strips accents', () => {
    expect(candidateToSlug('Patricia Bullrich')).toBe('patricia-bullrich');
    expect(candidateToSlug('Ñoño')).toBe('nono');
  });

  it('collapses repeated hyphens and strips trailing/leading', () => {
    expect(candidateToSlug('  Hello  World  ')).toBe('hello-world');
  });
});

describe('slugToCandidate', () => {
  it('roundtrips title-cased name (lossy: no accents recovered)', () => {
    expect(slugToCandidate('javier-milei')).toBe('Javier Milei');
  });
});
