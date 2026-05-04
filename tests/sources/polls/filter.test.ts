import { describe, it, expect } from 'vitest';
import { mightBePoll } from '../../../src/sources/polls/filter.js';

describe('mightBePoll', () => {
  it('matches obvious poll texts', () => {
    expect(mightBePoll('Encuesta nacional. Milei 45%, Kicillof 30%')).toBe(true);
    expect(mightBePoll('Nueva medición de intención de voto para 2027.')).toBe(true);
    expect(mightBePoll('Imagen de Milei en abril: 47%')).toBe(true);
  });

  it('matches when text is short but media is attached', () => {
    expect(mightBePoll('Datos de abril 👇', { hasMedia: true })).toBe(true);
  });

  it('rejects clearly non-poll content', () => {
    expect(mightBePoll('Hoy almorcé pizza con la familia')).toBe(false);
    expect(mightBePoll('Vamos River!!!')).toBe(false);
  });

  it('rejects retweets / mentions without context', () => {
    expect(mightBePoll('@usuario gracias por seguirme')).toBe(false);
  });
});
