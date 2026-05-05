import { Ribbon } from '../components/Ribbon.js';
import { Footer } from '../components/Footer.js';
import { frame, type CardElement } from '../compose.js';
import { colors, fonts, sizes } from '../tokens.js';

export function hotNewsCard(input: {
  source: string;
  headline: string;
  candidatesMentioned: string[];
  correlatedMove: { candidate: string; deltaPct: number } | null;
  timestamp: string;
  handle: string;
}): CardElement {
  const { source, headline, candidatesMentioned, correlatedMove, timestamp, handle } = input;
  const subline = correlatedMove
    ? `Polymarket ${correlatedMove.candidate} ${correlatedMove.deltaPct >= 0 ? '+' : ''}${correlatedMove.deltaPct.toFixed(1)}pp en 24h`
    : `Menciona: ${candidatesMentioned.slice(0, 3).join(', ')}`;

  return frame([
    Ribbon(`HOT NEWS · ${source.toUpperCase()}`),
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
                fontSize: sizes.headline,
                lineHeight: 1.1,
                color: colors.pageInk,
              },
              children: headline.length > 100 ? `${headline.slice(0, 97)}...` : headline,
            },
          },
          {
            type: 'div',
            props: {
              style: {
                fontFamily: fonts.body,
                fontSize: sizes.bodyLarge,
                color: colors.caption,
              },
              children: subline,
            },
          },
        ],
      },
    },
    Footer(timestamp, source.toUpperCase(), handle),
  ]);
}
