import { Ribbon } from '../components/Ribbon.js';
import { Footer } from '../components/Footer.js';
import { BarChart } from '../components/BarChart.js';
import { frame, type CardElement } from '../compose.js';
import { colors, fonts, sizes } from '../tokens.js';

export function morningBriefCard(input: {
  topCandidates: Array<{ candidato: string; pct: number; deltaPct?: number }>;
  marketDate: string;
  timestamp: string;
  handle: string;
}): CardElement {
  const { topCandidates, marketDate, timestamp, handle } = input;
  const bars = topCandidates.slice(0, 5).map((c) => ({
    label: c.deltaPct != null
      ? `${c.candidato}  ${c.deltaPct >= 0 ? '↑' : '↓'}${Math.abs(c.deltaPct).toFixed(1)}`
      : c.candidato,
    pct: c.pct,
  }));

  return frame([
    Ribbon('MORNING BRIEF · POLYMARKET 2027'),
    {
      type: 'div',
      props: {
        style: {
          flex: 1,
          padding: sizes.padding,
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
        },
        children: [
          {
            type: 'div',
            props: {
              style: {
                fontFamily: fonts.body,
                fontSize: sizes.body,
                color: colors.caption,
                textTransform: 'uppercase',
                letterSpacing: '1px',
              },
              children: `Top 5 · ${marketDate}`,
            },
          },
          BarChart(bars),
        ],
      },
    },
    Footer(timestamp, 'POLYMARKET', handle),
  ]);
}
