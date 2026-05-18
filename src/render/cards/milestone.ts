import { Ribbon } from '../components/Ribbon.js';
import { Footer } from '../components/Footer.js';
import { frame, type CardElement } from '../compose.js';
import { colors, fonts, sizes } from '../tokens.js';
import type { MilestoneEvent } from '../../trigger/types.js';

/**
 * Card "MILESTONE" — primera vez desde X.
 *
 * Layout:
 *   - Ribbon: POLYMARKET · HITO
 *   - Kicker: "[NOMBRE] cruzó el [N]% [arriba/abajo]"
 *   - Big number: "[daysSince] DÍAS" (es el shock — qué tan inusual es)
 *   - Sub: "es la primera vez desde [fecha], cuando estaba en [other_side]"
 *   - Detail: "% actual: [pct]%"
 */
export function milestoneCard(input: {
  event: MilestoneEvent;
  timestamp: string;
  handle: string;
}): CardElement {
  const { event, timestamp, handle } = input;
  const arrow = event.direction === 'above' ? '▲' : '▼';
  const otherSideText =
    event.direction === 'above'
      ? `cuando estaba abajo del ${event.threshold}%`
      : `cuando estaba sobre el ${event.threshold}%`;
  const aboveBelowText = event.direction === 'above' ? 'arriba del' : 'abajo del';

  return frame([
    Ribbon('POLYMARKET · HITO'),
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
              style: { display: 'flex', flexDirection: 'column', gap: 18 },
              children: [
                // Kicker explicativo
                {
                  type: 'div',
                  props: {
                    style: {
                      fontFamily: fonts.mono,
                      fontSize: sizes.kicker,
                      color: colors.caption,
                      textTransform: 'uppercase',
                      letterSpacing: '1.1px',
                    },
                    children: `${event.candidate.toUpperCase()} ${arrow} ${aboveBelowText} ${event.threshold}%`,
                  },
                },
                // Big number: daysSince
                {
                  type: 'div',
                  props: {
                    style: { display: 'flex', flexDirection: 'column', gap: 8 },
                    children: [
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
                            gap: 16,
                          },
                          children: `${event.daysSince} días`,
                        },
                      },
                      {
                        type: 'div',
                        props: {
                          style: {
                            fontFamily: fonts.body,
                            fontSize: sizes.bodyLarge,
                            color: colors.pageInk,
                            lineHeight: 1.35,
                          },
                          children: `desde la última vez que ${event.candidate} estuvo ${event.direction === 'above' ? 'abajo' : 'arriba'} del ${event.threshold}%.`,
                        },
                      },
                    ],
                  },
                },
                // Detalle
                {
                  type: 'div',
                  props: {
                    style: {
                      fontFamily: fonts.body,
                      fontSize: sizes.body,
                      color: colors.caption,
                      lineHeight: 1.3,
                      paddingTop: 16,
                      borderTop: `1px solid ${colors.hairline}`,
                    },
                    children: `Probabilidad ahora: ${event.pctNow.toFixed(1)}% · ${otherSideText}.`,
                  },
                },
              ],
            },
          },
        ],
      },
    },
    Footer(timestamp, 'POLYMARKET', handle),
  ]);
}
