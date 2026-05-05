import { colors, fonts, sizes } from '../tokens.js';

export interface Bar {
  label: string;
  pct: number;
}

const MAX_BAR_WIDTH = 600;

export function BarChart(bars: Bar[]) {
  const maxPct = Math.max(...bars.map((b) => b.pct), 1);
  return {
    type: 'div',
    key: 'chart',
    props: {
      style: { display: 'flex', flexDirection: 'column', gap: 16 },
      children: bars.map((b, i) => ({
        type: 'div',
        key: `bar-${i}`,
        props: {
          style: { display: 'flex', alignItems: 'center', gap: 16 },
          children: [
            {
              type: 'div',
              key: 'label',
              props: {
                style: {
                  width: 220,
                  fontFamily: fonts.ui,
                  fontSize: sizes.body,
                  fontWeight: 700,
                  color: colors.pageInk,
                },
                children: b.label,
              },
            },
            {
              type: 'div',
              key: 'bar',
              props: {
                style: {
                  width: (b.pct / maxPct) * MAX_BAR_WIDTH,
                  height: 28,
                  background: colors.ink,
                },
                children: '',
              },
            },
            {
              type: 'div',
              key: 'pct',
              props: {
                style: {
                  fontFamily: fonts.mono,
                  fontSize: sizes.body,
                  fontWeight: 700,
                  color: colors.pageInk,
                },
                children: `${b.pct.toFixed(1)}%`,
              },
            },
          ],
        },
      })),
    },
  };
}
