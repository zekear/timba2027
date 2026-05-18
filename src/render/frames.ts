/**
 * Frame generators para cards animadas. Cada generator toma un evento y
 * devuelve N CardElements que representan la animación.
 *
 * Estrategia: el último frame es idéntico al PNG estático que se generaría
 * sin animación → el "frame final" del GIF se ve igual que la card normal.
 * Los frames intermedios animan el "approach" (counter, fade, etc).
 */
import type { CardElement } from './compose.js';
import { marketMoveCard } from './cards/market-move.js';
import { dueloCrossoverCard } from './cards/duelo-crossover.js';
import { morningBriefCard } from './cards/morning-brief.js';
import type { MarketMoveEvent, CrossoverEvent } from '../trigger/types.js';

const TOTAL_FRAMES = 13;
const HOLD_FRAMES = 1; // un solo frame final; el "hold" real lo hace lastFrameDelayMs en gif.ts

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Progress 0 → 1, easing easeOutCubic. Los últimos HOLD_FRAMES quedan en 1. */
function progressAt(i: number): number {
  if (i >= TOTAL_FRAMES - HOLD_FRAMES) return 1;
  return easeOutCubic(i / (TOTAL_FRAMES - HOLD_FRAMES - 1));
}

/**
 * Market-move animado: el delta sube de 0 hasta deltaPct con easing.
 * El priceNow también interpola (priceThen → priceNow) para coherencia.
 */
export function marketMoveFrames(input: {
  event: MarketMoveEvent;
  context?: { latestPollPct?: number; latestPollSource?: string };
  timestamp: string;
  handle: string;
  priceHistory?: number[];
  allBuckets?: Array<{ label: string; pctNow: number; deltaPct?: number }>;
}): CardElement[] {
  const { event, ...rest } = input;
  return Array.from({ length: TOTAL_FRAMES }, (_, i) => {
    const p = progressAt(i);
    const animatedEvent: MarketMoveEvent = {
      ...event,
      deltaPct: event.deltaPct * p,
      priceNow: event.priceThen + (event.priceNow - event.priceThen) * p,
    };
    return marketMoveCard({ ...rest, event: animatedEvent });
  });
}

/**
 * Duelo crossover animado: los pcts interpolan de "antes" → "ahora".
 * El rank-swap aparece numéricamente (las pcts cambian y el ranking
 * efectivamente se invierte cerca del final).
 */
export function dueloCrossoverFrames(input: {
  event: CrossoverEvent;
  timestamp: string;
  handle: string;
}): CardElement[] {
  const { event, ...rest } = input;
  return Array.from({ length: TOTAL_FRAMES }, (_, i) => {
    const p = progressAt(i);
    const animatedEvent: CrossoverEvent = {
      ...event,
      passerPctNow: event.passerPctBefore + (event.passerPctNow - event.passerPctBefore) * p,
      passedPctNow: event.passedPctBefore + (event.passedPctNow - event.passedPctBefore) * p,
    };
    return dueloCrossoverCard({ ...rest, event: animatedEvent });
  });
}

/**
 * Morning-brief animado: las barras del top 5 crecen progresivamente
 * de 0 a su pct final. El delta 7d aparece solo en los últimos frames
 * (para no distraer durante la animación).
 */
export function morningBriefFrames(input: {
  topCandidates: Array<{ candidato: string; pct: number; deltaPct?: number }>;
  marketDate: string;
  timestamp: string;
  handle: string;
}): CardElement[] {
  return Array.from({ length: TOTAL_FRAMES }, (_, i) => {
    const p = progressAt(i);
    const animated = input.topCandidates.map((c) => ({
      candidato: c.candidato,
      pct: c.pct * p,
      deltaPct: i >= TOTAL_FRAMES - HOLD_FRAMES ? c.deltaPct : undefined,
    }));
    return morningBriefCard({ ...input, topCandidates: animated });
  });
}
