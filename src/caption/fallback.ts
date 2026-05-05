import type { MarketMoveEvent, NewPollEvent, HotNewsEvent } from '../trigger/types.js';

export function fallbackCaption(
  shape: 'morning_brief' | 'market_move' | 'new_poll' | 'hot_news',
  data: Record<string, unknown>,
): string {
  switch (shape) {
    case 'market_move': {
      const e = data.event as MarketMoveEvent;
      const sign = e.deltaPct >= 0 ? '+' : '';
      return `${e.candidate} ${sign}${e.deltaPct.toFixed(1)}pp en Polymarket (${e.windowHours}h). Precio actual: ${(e.priceNow * 100).toFixed(1)}%.`;
    }
    case 'new_poll': {
      const e = data as unknown as NewPollEvent & { pollsterDisplayName?: string };
      const psName = e.pollsterDisplayName ?? e.pollsterSlug;
      return `Nueva encuesta de ${psName}: ${e.topCandidate} ${e.topCandidatePct.toFixed(1)}% (#1).`;
    }
    case 'hot_news': {
      const e = data as unknown as HotNewsEvent;
      const move = e.correlatedMove
        ? ` · Polymarket ${e.correlatedMove.candidate} ${e.correlatedMove.deltaPct >= 0 ? '+' : ''}${e.correlatedMove.deltaPct.toFixed(1)}pp/24h`
        : '';
      return `${e.source}: ${e.headline.slice(0, 150)}${move}`;
    }
    case 'morning_brief': {
      const top = data.topCandidates as Array<{ candidato: string; pct: number }>;
      const t = top.slice(0, 3).map((c) => `${c.candidato} ${c.pct.toFixed(1)}%`).join(' · ');
      return `Polymarket 2027 — top 3: ${t}`;
    }
  }
}
