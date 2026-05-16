import { Ribbon } from '../components/Ribbon.js';
import { Footer } from '../components/Footer.js';
import { frame, type CardElement } from '../compose.js';
import { colors, fonts, sizes } from '../tokens.js';
import type { MarketMoveEvent } from '../../trigger/types.js';

export interface InflationBucket {
  label: string;       // e.g. "30.0-34.9%"
  pctNow: number;      // 0-100
  deltaPct?: number;   // pp respecto a la ventana (signo incluido)
}

/**
 * Sparkline inline — segmentos con rotate (Satori no soporta SVG path).
 */
function sparkline(points: number[], width: number, height: number): CardElement | null {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const stepX = width / (points.length - 1);
  const segments: CardElement[] = [];
  for (let i = 1; i < points.length; i++) {
    const x1 = (i - 1) * stepX;
    const y1 = height - ((points[i - 1] - min) / range) * height;
    const x2 = i * stepX;
    const y2 = height - ((points[i] - min) / range) * height;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    segments.push({
      type: 'div',
      props: {
        style: {
          position: 'absolute',
          left: x1,
          top: y1,
          width: len,
          height: 2,
          background: colors.pageInk,
          transform: `rotate(${angle}deg)`,
          transformOrigin: '0 50%',
        },
      },
    });
  }
  return {
    type: 'div',
    props: {
      style: { position: 'relative', width, height, display: 'flex' },
      children: segments,
    },
  };
}

/**
 * Limpia el label del bucket para display:
 *   "30.0-34.9%" → "30.0–34.9"
 *   "4.0%+"      → "4.0+"
 *   "< 2.5%"     → "< 2.5"
 * El "%" se omite porque el ribbon ya da el contexto ("INFLACIÓN ...").
 */
function prettifyRange(label: string): string {
  return label
    .replace(/%/g, '')
    .replace(/(\d)\s*-\s*(\d)/g, '$1–$2')
    .trim();
}

function fmtDelta(delta: number): string {
  return `${delta >= 0 ? '▲ +' : '▼ '}${delta.toFixed(1)}pp`;
}

/**
 * Card de inflación: el protagonista es el CONSENSO (rango con mayor
 * probabilidad). El bucket disparador del alert aparece en la lista
 * de todos los escenarios, con su delta al lado.
 */
export function inflationCard(input: {
  event: MarketMoveEvent;
  allBuckets: InflationBucket[];
  timestamp: string;
  handle: string;
  priceHistoryConsenso?: number[];
}): CardElement {
  const { event, allBuckets, timestamp, handle, priceHistoryConsenso } = input;

  const monthly = event.marketSlug ? /monthly/i.test(event.marketSlug) : false;
  const ribbon = monthly ? 'INFLACIÓN MENSUAL · ABRIL' : 'INFLACIÓN ANUAL · 2026';

  const sorted = [...allBuckets].sort((a, b) => b.pctNow - a.pctNow);
  const consenso = sorted[0];
  // Para la lista mostramos hasta 4 escenarios totales (consenso + 3) para no
  // pasarnos del card. Si el bucket que disparó queda fuera del top 4, lo
  // metemos forzosamente al final.
  const top4 = sorted.slice(0, 4);
  const triggerLabel = event.candidate;
  const hasTrigger = top4.some((b) => b.label === triggerLabel);
  const list = hasTrigger
    ? top4
    : [...top4.slice(0, 3), sorted.find((b) => b.label === triggerLabel)].filter(Boolean) as InflationBucket[];

  const maxPct = Math.max(...list.map((b) => b.pctNow), 1);
  const consensoDelta = consenso?.deltaPct;

  const spark =
    priceHistoryConsenso && priceHistoryConsenso.length >= 2
      ? sparkline(priceHistoryConsenso, 220, 60)
      : null;

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
          gap: 18,
        },
        children: [
          // Header: kicker + delta24h a la derecha
          {
            type: 'div',
            props: {
              style: {
                display: 'flex',
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'baseline',
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
                      letterSpacing: '1.1px',
                    },
                    children: 'Escenario más probable',
                  },
                },
                ...(consensoDelta != null
                  ? [
                      {
                        type: 'div',
                        props: {
                          style: {
                            fontFamily: fonts.mono,
                            fontSize: sizes.kicker,
                            color: colors.pageInk,
                            letterSpacing: '0.8px',
                          },
                          children: `${fmtDelta(consensoDelta)} 24h`,
                        },
                      } as CardElement,
                    ]
                  : []),
              ],
            },
          },
          // Big number + sparkline
          {
            type: 'div',
            props: {
              style: {
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'flex-end',
                justifyContent: 'space-between',
                gap: 24,
              },
              children: [
                {
                  type: 'div',
                  props: {
                    style: { display: 'flex', flexDirection: 'column', gap: 18 },
                    children: [
                      {
                        type: 'div',
                        props: {
                          style: {
                            fontFamily: fonts.display,
                            fontSize: 140,
                            lineHeight: 1.0,
                            color: colors.pageInk,
                          },
                          children: prettifyRange(consenso.label),
                        },
                      },
                      {
                        type: 'div',
                        props: {
                          style: {
                            fontFamily: fonts.body,
                            fontSize: sizes.bodyLarge,
                            color: colors.pageInk,
                          },
                          children: `${consenso.pctNow.toFixed(0)}% de probabilidad`,
                        },
                      },
                    ],
                  },
                },
                ...(spark
                  ? [
                      {
                        type: 'div',
                        props: {
                          style: {
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 14,
                            alignItems: 'flex-end',
                          },
                          children: [
                            {
                              type: 'div',
                              props: {
                                style: {
                                  fontFamily: fonts.mono,
                                  fontSize: sizes.kicker - 1,
                                  color: colors.caption,
                                  textTransform: 'uppercase',
                                  letterSpacing: '1.0px',
                                },
                                children: 'Últimos 7 días',
                              },
                            },
                            spark,
                          ],
                        },
                      } as CardElement,
                    ]
                  : []),
              ],
            },
          },
          // Todos los escenarios (incluyendo consenso)
          {
            type: 'div',
            props: {
              style: {
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                paddingTop: 14,
                borderTop: `1px solid ${colors.hairline}`,
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
                      marginBottom: 2,
                    },
                    children: 'Todos los escenarios',
                  },
                },
                ...list.map((b) => {
                  const isConsenso = b.label === consenso.label;
                  const isTrigger = b.label === triggerLabel;
                  const fillPct = Math.min(100, (b.pctNow / Math.max(maxPct, 1)) * 100);
                  const deltaStr =
                    isTrigger && b.deltaPct != null && !isConsenso ? `  ${fmtDelta(b.deltaPct)}` : '';
                  return {
                    type: 'div',
                    props: {
                      style: {
                        display: 'flex',
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 16,
                      },
                      children: [
                        {
                          type: 'div',
                          props: {
                            style: {
                              fontFamily: fonts.body,
                              fontSize: sizes.body,
                              color: colors.pageInk,
                              fontWeight: isConsenso ? 700 : 400,
                              width: 140,
                              flexShrink: 0,
                            },
                            children: prettifyRange(b.label),
                          },
                        },
                        {
                          type: 'div',
                          props: {
                            style: { flex: 1, display: 'flex', height: 16 },
                            children: [
                              {
                                type: 'div',
                                props: {
                                  style: {
                                    background: colors.pageInk,
                                    width: `${fillPct}%`,
                                    minWidth: 4,
                                    height: 16,
                                  },
                                },
                              },
                            ],
                          },
                        },
                        {
                          type: 'div',
                          props: {
                            style: {
                              fontFamily: fonts.mono,
                              fontSize: sizes.body,
                              color: colors.pageInk,
                              fontWeight: isConsenso ? 700 : 400,
                              width: 180,
                              textAlign: 'right',
                              flexShrink: 0,
                            },
                            children: `${b.pctNow.toFixed(0)}%${deltaStr}`,
                          },
                        },
                      ],
                    },
                  } satisfies CardElement;
                }),
              ],
            },
          },
        ],
      },
    },
    Footer(timestamp, 'POLYMARKET', handle),
  ]);
}
