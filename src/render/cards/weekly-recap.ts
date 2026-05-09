/**
 * Cover card del thread semanal. Layout broadsheet:
 *   - Ribbon: 'TIMBA RECAP · SEMANA DEL X AL Y'
 *   - Headline grande: "La semana en una mirada"
 *   - Stats grid: # market moves, # encuestas, # hot news, top mover (%)
 *   - Subtítulo con teaser de los 3 datos principales
 */
import { Ribbon } from '../components/Ribbon.js';
import { Footer } from '../components/Footer.js';
import { frame, type CardElement } from '../compose.js';
import { colors, fonts, sizes } from '../tokens.js';

export interface WeeklyRecapInput {
  weekStartLabel: string;     // ej: '3 may'
  weekEndLabel: string;       // ej: '9 may'
  marketMovesCount: number;
  pollsCount: number;
  hotNewsCount: number;
  topMover?: { candidate: string; deltaPct: number; priceNow: number };
  timestamp: string;
  handle: string;
}

export function weeklyRecapCard(input: WeeklyRecapInput): CardElement {
  const { weekStartLabel, weekEndLabel, marketMovesCount, pollsCount, hotNewsCount, topMover, timestamp, handle } = input;
  const ribbon = `TIMBA RECAP · ${weekStartLabel.toUpperCase()} → ${weekEndLabel.toUpperCase()}`;

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
              style: { display: 'flex', flexDirection: 'column', gap: 24 },
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
                    children: 'Resumen automatizado · Polymarket + encuestas + noticias',
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
                    children: 'La semana en una mirada',
                  },
                },
              ],
            },
          },
          {
            type: 'div',
            props: {
              style: {
                display: 'flex',
                gap: 32,
                paddingTop: 24,
                borderTop: `2px solid ${colors.ink}`,
              },
              children: [
                statBlock(String(marketMovesCount), 'moves de mercado'),
                statBlock(String(pollsCount), pollsCount === 1 ? 'encuesta' : 'encuestas'),
                statBlock(String(hotNewsCount), 'hot news'),
                ...(topMover
                  ? [
                      statBlock(
                        `${topMover.deltaPct >= 0 ? '+' : ''}${topMover.deltaPct.toFixed(1)}pp`,
                        `top mover · ${truncate(topMover.candidate, 18)}`,
                      ),
                    ]
                  : []),
              ],
            },
          },
        ],
      },
    },
    Footer(timestamp, 'TIMBA RECAP', handle),
  ]);
}

function statBlock(value: string, label: string): CardElement {
  return {
    type: 'div',
    props: {
      style: { display: 'flex', flexDirection: 'column', gap: 4 },
      children: [
        {
          type: 'div',
          props: {
            style: {
              fontFamily: fonts.display,
              fontSize: 64,
              lineHeight: 1.0,
              color: colors.pageInk,
            },
            children: value,
          },
        },
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
            children: label,
          },
        },
      ],
    },
  };
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}
