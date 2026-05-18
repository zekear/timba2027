import type { MarketMoveEvent, NewPollEvent, HotNewsEvent, CrossoverEvent, MilestoneEvent } from '../trigger/types.js';

/**
 * Devuelve un label legible para el mercado (basado en marketSlug).
 * Mismo mapping que la card → consistencia visual.
 */
function marketLabel(slug?: string): string {
  if (!slug) return 'Polymarket';
  if (/monthly/i.test(slug) && /inflation/i.test(slug)) {
    return 'Polymarket — Inflación mensual abril';
  }
  if (/inflation/i.test(slug)) {
    return 'Polymarket — Inflación anual 2026';
  }
  if (/presidential|president|election/i.test(slug)) {
    return 'Polymarket — Presidencia 2027';
  }
  return 'Polymarket';
}

/**
 * Detecta si el "candidate" es persona o rango numérico (para usar
 * el lenguaje correcto en el caption).
 */
function isInflationRange(label: string): boolean {
  return /^[\d\s.,%≤≥<>+\-–]+$/.test(label);
}

export function fallbackCaption(
  shape: 'morning_brief' | 'market_move' | 'new_poll' | 'hot_news' | 'duelo_crossover' | 'milestone',
  data: Record<string, unknown>,
): string {
  switch (shape) {
    case 'milestone': {
      const e = data as unknown as MilestoneEvent;
      const sideText = e.direction === 'above' ? `arriba del ${e.threshold}%` : `abajo del ${e.threshold}%`;
      const lastSide = e.direction === 'above' ? `abajo` : `arriba`;
      return `📍 Polymarket: ${e.candidate} ${sideText} por primera vez en ${e.daysSince} días (última vez ${lastSide}). Ahora ${e.pctNow.toFixed(1)}%.`;
    }
    case 'duelo_crossover': {
      const e = data as unknown as CrossoverEvent;
      const sign = (x: number): string => (x >= 0 ? '+' : '');
      return `🔀 Cruce en Polymarket: ${e.passer} pasa a ${e.passed} (${e.rankBefore}º → ${e.rankNow}º). ${e.passer} ${sign(e.passerPctNow - e.passerPctBefore)}${(e.passerPctNow - e.passerPctBefore).toFixed(1)}pp/24h.`;
    }
    case 'market_move': {
      const e = data.event as MarketMoveEvent;
      const sign = e.deltaPct >= 0 ? '+' : '';
      const arrow = e.deltaPct >= 0 ? '▲' : '▼';
      const label = marketLabel(e.marketSlug);
      const subjectName = isInflationRange(e.candidate)
        ? `el rango ${e.candidate}`
        : e.candidate;
      const pricePct = (e.priceNow * 100).toFixed(1);
      return `🔔 ${label}: ${subjectName} ${arrow} ${sign}${e.deltaPct.toFixed(1)}pp en ${e.windowHours}h. Probabilidad actual ${pricePct}%.`;
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
