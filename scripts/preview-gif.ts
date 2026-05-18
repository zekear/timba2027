/**
 * Spike de cards animadas: genera 1 GIF de prueba con el delta de un
 * market-move haciendo "counter up" desde 0 hasta el delta final.
 *
 * Run: pnpm tsx scripts/preview-gif.ts
 * Output: storage/cards/preview-market-move-animated.gif
 */
import { env } from '../src/lib/env.js';
import { marketMoveCard } from '../src/render/cards/market-move.js';
import { renderFramesToGif } from '../src/render/gif.js';
import type { MarketMoveEvent } from '../src/trigger/types.js';

const finalDelta = 5.0;
const finalPriceNow = 0.34;
const finalPriceThen = 0.29;
const FRAMES = 18;

const baseEvent: MarketMoveEvent = {
  marketId: 'm3',
  marketSlug: 'argentina-presidential-election-winner',
  marketQuestion: 'Who will win the 2027 Argentine presidential election?',
  candidate: 'Dante Gebel',
  priceNow: finalPriceNow,
  priceThen: finalPriceThen,
  deltaPct: finalDelta,
  windowHours: 6,
  siblings: [],
};

// Easing easeOutCubic
function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

const frames = Array.from({ length: FRAMES }, (_, i) => {
  // últimos 4 frames pause (hold final)
  const t = Math.min(1, easeOut(i / (FRAMES - 5)));
  const progress = i >= FRAMES - 4 ? 1 : t;
  const event: MarketMoveEvent = {
    ...baseEvent,
    deltaPct: finalDelta * progress,
    priceNow: finalPriceThen + (finalPriceNow - finalPriceThen) * progress,
  };
  return marketMoveCard({
    event,
    timestamp: '14:32 GMT-3',
    handle: env.BOT_HANDLE,
    // Sparkline opcional pero estática a través del GIF (sino sería muy ruidoso)
    priceHistory: undefined,
  });
});

console.log(`Generating ${FRAMES} frames at 800x450...`);
const start = Date.now();
const { absPath } = await renderFramesToGif(frames, 'preview-market-move-animated', {
  width: 800,
  height: 450,
  frameDelayMs: 80,
});
console.log(`Done in ${Date.now() - start}ms → ${absPath}`);
process.exit(0);
