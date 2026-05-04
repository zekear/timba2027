import type { PolymarketEvent } from './types.js';
import type { markets, marketPrices } from '../../db/schema.js';
import type { InferInsertModel } from 'drizzle-orm';

type MarketInsert = InferInsertModel<typeof markets>;
type PriceInsert = Omit<InferInsertModel<typeof marketPrices>, 'id'>;

export interface NormalizedEvent {
  market: MarketInsert;
  prices: PriceInsert[];
}

/**
 * Polymarket events de elección suelen tener:
 *   - 1 event con N markets (uno por candidato)
 *   - cada market tiene outcomes ["Yes","No"] y outcomePrices ["0.52","0.48"]
 *   - el "candidato" se infiere de market.groupItemTitle o de market.question
 *
 * Algunos markets pueden no tener outcomes/outcomePrices todavía (markets recién creados).
 * En ese caso incluimos el candidato en candidates[] pero no creamos un price snapshot.
 */
export function normalizeEvent(event: PolymarketEvent): NormalizedEvent {
  const ts = new Date();
  const candidates: string[] = [];
  const prices: PriceInsert[] = [];

  for (const market of event.markets) {
    const candidate =
      market.groupItemTitle?.trim() ||
      market.question.replace(/^Will\s+/i, '').replace(/\s+win\b.*$/i, '').trim();
    if (!candidates.includes(candidate)) {
      candidates.push(candidate);
    }

    if (!market.outcomes || !market.outcomePrices) {
      continue; // no price data for this market yet
    }

    let outcomes: string[];
    let outcomePrices: string[];
    try {
      outcomes = JSON.parse(market.outcomes) as string[];
      outcomePrices = JSON.parse(market.outcomePrices) as string[];
    } catch {
      continue;
    }
    const yesIdx = outcomes.findIndex((o) => o.toLowerCase() === 'yes');
    if (yesIdx === -1) continue;
    const yesPrice = outcomePrices[yesIdx];
    if (!yesPrice) continue;

    prices.push({
      marketId: event.id,
      candidate,
      price: yesPrice,
      volume24h:
        typeof market.volume24hr === 'number'
          ? market.volume24hr.toFixed(2)
          : market.volume24hr ?? null,
      ts,
    });
  }

  return {
    market: {
      id: event.id,
      slug: event.slug,
      question: event.title,
      candidates,
      endDate: event.endDate ? new Date(event.endDate) : null,
      status: event.closed ? 'closed' : event.archived ? 'archived' : 'open',
    },
    prices,
  };
}
