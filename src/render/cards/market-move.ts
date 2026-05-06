import { Ribbon } from '../components/Ribbon.js';
import { Footer } from '../components/Footer.js';
import { frame, type CardElement } from '../compose.js';
import { colors, fonts, sizes } from '../tokens.js';
import type { MarketMoveEvent } from '../../trigger/types.js';

/**
 * Categorizar mercado para elegir Ribbon label + sub-context legible.
 * Los slugs vienen de Polymarket Gamma API.
 */
function marketContext(slug?: string, question?: string): {
  ribbon: string;
  contextLine: string;
  isElectoral: boolean;
} {
  if (!slug) {
    return { ribbon: 'POLYMARKET MOVE', contextLine: '', isElectoral: true };
  }
  if (/inflation/i.test(slug)) {
    if (/monthly|monthly-inflation-april/i.test(slug)) {
      return {
        ribbon: 'INFLACIÓN MENSUAL · ABRIL',
        contextLine: 'Probabilidad de que el IPC mensual de abril caiga en este rango.',
        isElectoral: false,
      };
    }
    return {
      ribbon: 'INFLACIÓN ANUAL · 2026',
      contextLine: 'Probabilidad de que la inflación anual 2026 caiga en este rango.',
      isElectoral: false,
    };
  }
  if (/presidential|president|election/i.test(slug)) {
    return {
      ribbon: 'POLYMARKET · PRESIDENCIA 2027',
      contextLine: question ?? 'Mercado de elección presidencial argentina 2027.',
      isElectoral: true,
    };
  }
  return { ribbon: 'POLYMARKET MOVE', contextLine: question ?? '', isElectoral: true };
}

export function marketMoveCard(input: {
  event: MarketMoveEvent;
  context?: { latestPollPct?: number; latestPollSource?: string };
  timestamp: string;
  handle: string;
}): CardElement {
  const { event, context, timestamp, handle } = input;
  const sign = event.deltaPct >= 0 ? '+' : '';
  const arrow = event.deltaPct >= 0 ? '▲' : '▼';
  const { ribbon, contextLine, isElectoral } = marketContext(event.marketSlug, event.marketQuestion);
  const ribbonSourceLabel = ribbon.includes('PRESIDENCIA') ? 'POLYMARKET' : ribbon;
  const subjectLabel = isElectoral ? event.candidate : `Rango ${event.candidate}`;

  return frame([
    Ribbon(ribbon),
    {
      type: 'div',
      props: {
        style: {
          flex: 1,
          padding: sizes.padding,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        },
        children: [
          {
            type: 'div',
            props: {
              style: {
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
              },
              children: [
                {
                  type: 'div',
                  props: {
                    style: {
                      fontFamily: fonts.mono,
                      fontSize: sizes.kicker,
                      color: colors.caption,
                      textTransform: 'uppercase',
                      letterSpacing: '1.0px',
                    },
                    children: contextLine,
                  },
                },
                {
                  type: 'div',
                  props: {
                    style: {
                      fontFamily: fonts.display,
                      fontSize: sizes.display,
                      lineHeight: 1.0,
                      color: colors.pageInk,
                    },
                    children: `${subjectLabel} ${arrow} ${sign}${event.deltaPct.toFixed(1)}pp`,
                  },
                },
              ],
            },
          },
          {
            type: 'div',
            props: {
              style: {
                fontFamily: fonts.body,
                fontSize: sizes.bodyLarge,
                color: colors.pageInk,
                lineHeight: 1.4,
              },
              children: `Probabilidad actual ${(event.priceNow * 100).toFixed(1)}% · cambio en últimas ${event.windowHours}h${
                context?.latestPollPct != null
                  ? ` · Encuesta más cercana: ${context.latestPollPct.toFixed(1)}%${
                      context.latestPollSource ? ` (${context.latestPollSource})` : ''
                    }`
                  : ''
              }`,
            },
          },
        ],
      },
    },
    Footer(timestamp, ribbonSourceLabel, handle),
  ]);
}
