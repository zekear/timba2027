/**
 * Genera cards preview con data sintética para validar diseños.
 * Run: pnpm tsx scripts/preview-cards.ts
 */
import { env } from '../src/lib/env.js';
import { renderToPng } from '../src/render/compose.js';
import { marketMoveCard } from '../src/render/cards/market-move.js';
import { hotNewsCard } from '../src/render/cards/hot-news.js';

const ts = '14:32 GMT-3';
const handle = env.BOT_HANDLE;

// Sparkline sintético: subida con ruido (168 puntos = 1 muestra/hora * 7 días)
function fakeSparkline(start: number, end: number, points = 168, noise = 0.005): number[] {
  const series: number[] = [];
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1);
    const base = start + (end - start) * t;
    const wobble = Math.sin(t * Math.PI * 6) * noise + (Math.random() - 0.5) * noise * 2;
    series.push(base + wobble);
  }
  return series;
}

// Caso 1: inflación anual — consenso 30-34.9% subiendo
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
      siblings: [],
    },
    timestamp: ts,
    handle,
    priceHistory: fakeSparkline(29, 34, 168, 0.5).map((x) => x / 100),
    allBuckets: [
      { label: '30.0-34.9%', pctNow: 34, deltaPct: 5.0 },
      { label: '25.0-29.9%', pctNow: 24, deltaPct: -1.2 },
      { label: '35.0-39.9%', pctNow: 18, deltaPct: -2.1 },
      { label: '40.0%+', pctNow: 12, deltaPct: -0.8 },
      { label: '20.0-24.9%', pctNow: 8, deltaPct: -0.3 },
    ],
  }),
  'preview-inflation-annual',
);

// Caso 2: inflación mensual — bucket 4.0%+ cayendo fuerte (el alert)
// pero el consenso real está en 3.0-3.4%
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
      siblings: [],
    },
    timestamp: ts,
    handle,
    priceHistory: fakeSparkline(28, 34, 168, 0.5).map((x) => x / 100),
    allBuckets: [
      { label: '3.0-3.4%', pctNow: 34, deltaPct: 2.1 },
      { label: '3.5-3.9%', pctNow: 26, deltaPct: 1.4 },
      { label: '2.5-2.9%', pctNow: 18, deltaPct: 2.6 },
      { label: '4.0%+', pctNow: 1.6, deltaPct: -5.3 },
      { label: '< 2.5%', pctNow: 12, deltaPct: -0.8 },
    ],
  }),
  'preview-inflation-monthly',
);

// Caso 3: electoral con sparkline + siblings
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
      siblings: [
        { candidate: 'Axel Kicillof', priceNow: 0.215, priceThen: 0.25, deltaPct: -3.5 },
        { candidate: 'Victoria Villarruel', priceNow: 0.105, priceThen: 0.092, deltaPct: 1.3 },
      ],
    },
    timestamp: ts,
    handle,
    priceHistory: fakeSparkline(0.0515, 0.081),
  }),
  'preview-electoral',
);

// Hot news con headline larga
await renderToPng(
  hotNewsCard({
    source: 'lanacion',
    headline:
      'El Gobierno analiza cambios en la reforma política: separaría ficha limpia y haría opcionales las primarias en distritos chicos',
    candidatesMentioned: ['Patricia Bullrich'],
    correlatedMove: null,
    timestamp: '07:22 GMT-3',
    handle,
  }),
  'preview-hotnews-long',
);

console.log('Done. 4 PNGs en storage/cards/preview-*.png');
process.exit(0);
