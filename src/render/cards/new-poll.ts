import { Ribbon } from '../components/Ribbon.js';
import { Footer } from '../components/Footer.js';
import { BarChart } from '../components/BarChart.js';
import { frame, type CardElement } from '../compose.js';
import { colors, fonts, sizes } from '../tokens.js';

export function newPollCard(input: {
  pollsterDisplayName: string;
  fechaCampo: string | null;
  sampleSize: number | null;
  results: Array<{ candidato: string; pct: number }>;
  timestamp: string;
  handle: string;
}): CardElement {
  const { pollsterDisplayName, fechaCampo, sampleSize, results, timestamp, handle } = input;
  const top5 = results.slice(0, 5).map((r) => ({ label: r.candidato, pct: r.pct }));

  const sub = [
    pollsterDisplayName,
    fechaCampo ? `Campo ${fechaCampo}` : null,
    sampleSize ? `n=${sampleSize}` : null,
  ].filter(Boolean).join(' · ');

  return frame([
    Ribbon('NUEVA ENCUESTA'),
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
              children: sub,
            },
          },
          BarChart(top5),
        ],
      },
    },
    Footer(timestamp, pollsterDisplayName.toUpperCase(), handle),
  ]);
}
