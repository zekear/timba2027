import { Ribbon } from '../components/Ribbon.js';
import { Footer } from '../components/Footer.js';
import { frame, type CardElement } from '../compose.js';
import { colors, fonts, sizes } from '../tokens.js';
import type { CrossoverEvent } from '../../trigger/types.js';

const RANK_LABELS: Record<number, string> = {
  1: '1º',
  2: '2º',
  3: '3º',
  4: '4º',
  5: '5º',
};

/**
 * Card "DUELO" para crossover events: dos candidatos enfrentados, el que
 * supera arriba con su delta vs el que es pasado abajo. El número
 * protagonista es el rank-swap (e.g. "2º → 1º").
 */
export function dueloCrossoverCard(input: {
  event: CrossoverEvent;
  timestamp: string;
  handle: string;
}): CardElement {
  const { event, timestamp, handle } = input;
  const passerArrow = '▲';

  const passerDelta = event.passerPctNow - event.passerPctBefore;
  const passedDelta = event.passedPctNow - event.passedPctBefore;
  const sign = (x: number): string => (x >= 0 ? '+' : '');

  return frame([
    Ribbon('POLYMARKET · CRUCE EN EL TOP 5'),
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
              style: { display: 'flex', flexDirection: 'column', gap: 14 },
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
                    children: `${event.passer.toUpperCase()} PASÓ A ${event.passed.toUpperCase()} EN LAS ÚLTIMAS 24 HORAS`,
                  },
                },
                // Big rank swap protagonista
                {
                  type: 'div',
                  props: {
                    style: {
                      fontFamily: fonts.display,
                      fontSize: 160,
                      lineHeight: 1.0,
                      color: colors.pageInk,
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: 24,
                    },
                    children: `${RANK_LABELS[event.rankBefore] ?? `${event.rankBefore}º`} → ${RANK_LABELS[event.rankNow] ?? `${event.rankNow}º`}`,
                  },
                },
                // Detalle de ambos candidatos
                {
                  type: 'div',
                  props: {
                    style: {
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      paddingTop: 12,
                      borderTop: `1px solid ${colors.hairline}`,
                    },
                    children: [
                      {
                        type: 'div',
                        props: {
                          style: {
                            fontFamily: fonts.body,
                            fontSize: sizes.bodyLarge,
                            color: colors.pageInk,
                            lineHeight: 1.3,
                          },
                          children: `${event.passer}  ${passerArrow} ${sign(passerDelta)}${passerDelta.toFixed(1)}pp · ${event.passerPctNow.toFixed(1)}%`,
                        },
                      },
                      {
                        type: 'div',
                        props: {
                          style: {
                            fontFamily: fonts.body,
                            fontSize: sizes.bodyLarge,
                            color: colors.caption,
                            lineHeight: 1.3,
                          },
                          children: `${event.passed}  ${passedDelta >= 0 ? '▲' : '▼'} ${sign(passedDelta)}${passedDelta.toFixed(1)}pp · ${event.passedPctNow.toFixed(1)}%`,
                        },
                      },
                    ],
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
                fontSize: sizes.body,
                color: colors.caption,
                lineHeight: 1.3,
              },
              children: 'Probabilidades implícitas del mercado presidencial 2027. Cambio respecto a hace 24h.',
            },
          },
        ],
      },
    },
    Footer(timestamp, 'POLYMARKET', handle),
  ]);
}
