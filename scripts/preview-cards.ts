/**
 * Genera 3 cards preview para validar el nuevo diseño post-fix de marketSlug.
 * Run: pnpm tsx scripts/preview-cards.ts
 */
import { renderToPng } from '../src/render/compose.js';
import { marketMoveCard } from '../src/render/cards/market-move.js';

const ts = '14:32 GMT-3';
const handle = '@ezeqmina';

// Caso 1: inflación anual subiendo
await renderToPng(
  marketMoveCard({
    event: {
      marketId: 'm1',
      marketSlug: 'argentina-annual-inflation-2026',
      marketQuestion: 'What will the 2026 annual inflation in Argentina be?',
      candidate: '30.0-34.9%',
      priceNow: 0.34,
      priceThen: 0.29,
      deltaPct: 5.0,
      windowHours: 6,
    },
    timestamp: ts,
    handle,
  }),
  'preview-inflation-annual',
);

// Caso 2: inflación mensual cayendo (el #60 problemático)
await renderToPng(
  marketMoveCard({
    event: {
      marketId: 'm2',
      marketSlug: 'argentina-monthly-inflation-april',
      marketQuestion: 'What will April monthly inflation be?',
      candidate: '4.0%+',
      priceNow: 0.016,
      priceThen: 0.069,
      deltaPct: -5.3,
      windowHours: 6,
    },
    timestamp: ts,
    handle,
  }),
  'preview-inflation-monthly',
);

// Caso 3: electoral real (Dante Gebel)
await renderToPng(
  marketMoveCard({
    event: {
      marketId: 'm3',
      marketSlug: 'argentina-presidential-election-winner',
      marketQuestion: 'Who will win the 2027 Argentine presidential election?',
      candidate: 'Dante Gebel',
      priceNow: 0.081,
      priceThen: 0.0515,
      deltaPct: 3.0,
      windowHours: 6,
    },
    timestamp: ts,
    handle,
  }),
  'preview-electoral',
);

console.log('Done. 3 PNGs en storage/cards/preview-*.png');
process.exit(0);
