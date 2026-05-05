import { Ribbon } from '../components/Ribbon.js';
import { Footer } from '../components/Footer.js';
import { frame, type CardElement } from '../compose.js';
import { colors, fonts, sizes } from '../tokens.js';
import type { MarketMoveEvent } from '../../trigger/types.js';

export function marketMoveCard(input: {
  event: MarketMoveEvent;
  context?: { latestPollPct?: number; latestPollSource?: string };
  timestamp: string;
  handle: string;
}): CardElement {
  const { event, context, timestamp, handle } = input;
  const sign = event.deltaPct >= 0 ? '+' : '';
  const arrow = event.deltaPct >= 0 ? '▲' : '▼';

  return frame([
    Ribbon('POLYMARKET MOVE'),
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
                fontFamily: fonts.display,
                fontSize: sizes.display,
                lineHeight: 1.0,
                color: colors.pageInk,
              },
              children: `${event.candidate} ${arrow} ${sign}${event.deltaPct.toFixed(1)}pp`,
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
              children: `Mercado actual ${(event.priceNow * 100).toFixed(1)}% (${event.windowHours}h)${
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
    Footer(timestamp, 'POLYMARKET', handle),
  ]);
}
