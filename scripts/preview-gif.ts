/**
 * Genera los 3 GIFs de preview para validar las cards animadas.
 *
 * Run: pnpm tsx scripts/preview-gif.ts
 * Output: storage/cards/preview-*-animated.gif
 */
import { env } from '../src/lib/env.js';
import { renderFramesToGif } from '../src/render/gif.js';
import { marketMoveFrames, dueloCrossoverFrames, morningBriefFrames } from '../src/render/frames.js';

const ts = '14:32 GMT-3';
const handle = env.BOT_HANDLE;

// 1. Market move (counter del delta)
console.log('1/3 market-move...');
let start = Date.now();
const mmFrames = marketMoveFrames({
  event: {
    marketId: 'm3',
    marketSlug: 'argentina-presidential-election-winner',
    marketQuestion: 'Who will win the 2027 Argentine presidential election?',
    candidate: 'Dante Gebel',
    priceNow: 0.081,
    priceThen: 0.0515,
    deltaPct: 5.0,
    windowHours: 6,
    siblings: [],
  },
  timestamp: ts,
  handle,
});
await renderFramesToGif(mmFrames, 'preview-market-move-animated');
console.log(`  done in ${Date.now() - start}ms`);

// 2. Duelo crossover (pcts interpolan)
console.log('2/3 duelo-crossover...');
start = Date.now();
const dcFrames = dueloCrossoverFrames({
  event: {
    marketId: 'm3',
    passer: 'Javier Milei',
    passed: 'Axel Kicillof',
    rankNow: 1,
    rankBefore: 2,
    passerPctNow: 26.4,
    passerPctBefore: 22.1,
    passedPctNow: 24.8,
    passedPctBefore: 27.5,
  },
  timestamp: ts,
  handle,
});
await renderFramesToGif(dcFrames, 'preview-duelo-animated');
console.log(`  done in ${Date.now() - start}ms`);

// 3. Morning brief (barras del top 5 llenándose)
console.log('3/3 morning-brief...');
start = Date.now();
const mbFrames = morningBriefFrames({
  topCandidates: [
    { candidato: 'Javier Milei', pct: 49.5, deltaPct: -4.0 },
    { candidato: 'Axel Kicillof', pct: 32.5, deltaPct: 0.8 },
    { candidato: 'Dante Gebel', pct: 5.1, deltaPct: 1.2 },
    { candidato: 'Sergio Massa', pct: 3.3, deltaPct: 0.4 },
    { candidato: 'Juan Grabois', pct: 2.6, deltaPct: -0.6 },
  ],
  marketDate: '18 may 2026',
  timestamp: '09:00 GMT-3',
  handle,
});
await renderFramesToGif(mbFrames, 'preview-morning-brief-animated');
console.log(`  done in ${Date.now() - start}ms`);

console.log('\nDone. 3 GIFs en storage/cards/preview-*-animated.gif');
process.exit(0);
