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

/**
 * Sparkline inline para Satori. Devuelve una serie de divs absolute-positioned
 * que forman un path. Si la serie es <2 puntos, devuelve null.
 */
function sparkline(points: number[], width: number, height: number): CardElement | null {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const stepX = width / (points.length - 1);

  // Render como sequence de segmentos (Satori no soporta SVG path con d="..."
  // arbitrario, pero soporta `<svg>` con children. Usamos lines absolute.)
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
      style: {
        position: 'relative',
        width,
        height,
        display: 'flex',
      },
      children: segments,
    },
  };
}

export function marketMoveCard(input: {
  event: MarketMoveEvent;
  context?: { latestPollPct?: number; latestPollSource?: string };
  timestamp: string;
  handle: string;
  /** Serie reciente del candidato principal (0-1 o pct, normalizada internamente). */
  priceHistory?: number[];
}): CardElement {
  const { event, context, timestamp, handle, priceHistory } = input;
  const sign = event.deltaPct >= 0 ? '+' : '';
  const arrow = event.deltaPct >= 0 ? '▲' : '▼';
  const { ribbon, contextLine } = marketContext(event.marketSlug, event.marketQuestion);
  const ribbonSourceLabel = ribbon.includes('PRESIDENCIA') ? 'POLYMARKET' : ribbon;

  const spark = priceHistory && priceHistory.length >= 2 ? sparkline(priceHistory, 280, 80) : null;

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
              style: { display: 'flex', flexDirection: 'column', gap: 14 },
              children: [
                // Kicker: candidato + contexto
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
                    children: contextLine || ribbon,
                  },
                },
                // Big delta protagonista + sparkline a la derecha
                {
                  type: 'div',
                  props: {
                    style: {
                      display: 'flex',
                      flexDirection: 'row',
                      alignItems: 'flex-end',
                      justifyContent: 'space-between',
                      gap: 32,
                    },
                    children: [
                      {
                        type: 'div',
                        props: {
                          style: { display: 'flex', flexDirection: 'column', gap: 6 },
                          children: [
                            {
                              type: 'div',
                              props: {
                                style: {
                                  fontFamily: fonts.mono,
                                  fontSize: sizes.kicker + 2,
                                  color: colors.pageInk,
                                  textTransform: 'uppercase',
                                  letterSpacing: '1.2px',
                                  fontWeight: 700,
                                },
                                children: event.candidate,
                              },
                            },
                            {
                              type: 'div',
                              props: {
                                style: {
                                  fontFamily: fonts.display,
                                  fontSize: 140,
                                  lineHeight: 1.0,
                                  color: colors.pageInk,
                                  display: 'flex',
                                  alignItems: 'baseline',
                                  gap: 16,
                                },
                                children: `${arrow} ${sign}${event.deltaPct.toFixed(1)}pp`,
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
                                style: { display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' },
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
                ...(event.siblings.length > 0 ? [siblingsList(event)] : []),
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
              children: `Probabilidad ahora ${(event.priceNow * 100).toFixed(1)}% · cambio en últimas ${event.windowHours}h${
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

/**
 * Lista co-moves del mismo mercado. Top 3 por |deltaPct|, formato compacto.
 */
function siblingsList(event: MarketMoveEvent): CardElement {
  const top = event.siblings.slice(0, 3);
  return {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        paddingTop: 12,
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
              marginBottom: 4,
            },
            children: 'También se movieron en este mercado',
          },
        },
        ...top.map((s) => {
          const sign = s.deltaPct >= 0 ? '+' : '';
          const arrow = s.deltaPct >= 0 ? '▲' : '▼';
          const subject = s.candidate;
          return {
            type: 'div',
            props: {
              style: {
                fontFamily: fonts.body,
                fontSize: sizes.body,
                color: colors.pageInk,
                lineHeight: 1.3,
              },
              children: `${subject} ${arrow} ${sign}${s.deltaPct.toFixed(1)}pp · ${(s.priceNow * 100).toFixed(1)}%`,
            },
          } satisfies CardElement;
        }),
      ],
    },
  };
}
