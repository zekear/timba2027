/**
 * Logo + Banner para la cuenta de X.
 * Mismo design system que las cards: paper white + ink + serif display + mono kicker.
 */
import { type CardElement } from '../compose.js';
import { colors, fonts } from '../tokens.js';

export interface BrandOpts {
  handle: string;     // ej '@Timba2027' (con @, se muestra tal cual)
  domain: string;     // ej 'timba2027.com' (sin protocolo)
}

const LOGO_SIZE = 400;       // X profile picture
const BANNER_W = 1500;       // X header banner
const BANNER_H = 500;

/**
 * Logo cuadrado 400×400. Diseño minimal:
 *   - Paper white background
 *   - Borde 6px ink alrededor (visible incluso recortado en círculo)
 *   - "T" gigantesca centrada (serif display)
 *   - "2027" mono debajo
 *
 * Nota: X recorta a círculo. El borde grueso da legibilidad post-recorte.
 */
export function logoCard(opts: BrandOpts): CardElement {
  return {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: LOGO_SIZE,
        height: LOGO_SIZE,
        background: colors.paperWhite,
        border: `6px solid ${colors.ink}`,
        alignItems: 'center',
        justifyContent: 'center',
      },
      children: [
        {
          type: 'div',
          props: {
            style: {
              fontFamily: fonts.display,
              fontSize: 280,
              lineHeight: 0.85,
              color: colors.ink,
              marginTop: -20,
            },
            children: 'T',
          },
        },
        {
          type: 'div',
          props: {
            style: {
              fontFamily: fonts.mono,
              fontSize: 28,
              fontWeight: 700,
              color: colors.ink,
              letterSpacing: '4px',
              marginTop: -10,
            },
            children: '2027',
          },
        },
      ],
    },
  };
}

/**
 * Banner 1500×500. Layout broadsheet con headline serif gigante a la izquierda
 * y lateral mono uppercase con fuentes / disclosures a la derecha.
 */
export function bannerCard(opts: BrandOpts): CardElement {
  return {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        width: BANNER_W,
        height: BANNER_H,
        background: colors.paperWhite,
      },
      children: [
        // Lado izquierdo (60%): headline + sub
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              flex: 3,
              padding: 56,
              justifyContent: 'space-between',
              borderRight: `2px solid ${colors.ink}`,
            },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    fontFamily: fonts.mono,
                    fontSize: 18,
                    fontWeight: 700,
                    color: colors.ink,
                    textTransform: 'uppercase',
                    letterSpacing: '2px',
                  },
                  children: 'BUENOS AIRES · ARGENTINA',
                },
              },
              {
                type: 'div',
                props: {
                  style: {
                    fontFamily: fonts.display,
                    fontSize: 96,
                    lineHeight: 0.95,
                    color: colors.ink,
                  },
                  children: 'la timba electoral',
                },
              },
              {
                type: 'div',
                props: {
                  style: {
                    fontFamily: fonts.body,
                    fontSize: 22,
                    color: colors.pageInk,
                    lineHeight: 1.3,
                  },
                  children: 'Polymarket · encuestas · noticias · datos automatizados del 2027.',
                },
              },
            ],
          },
        },
        // Lado derecho (40%): año gigante + handle
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              flex: 2,
              padding: 56,
              justifyContent: 'space-between',
              alignItems: 'flex-end',
            },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    fontFamily: fonts.mono,
                    fontSize: 16,
                    fontWeight: 700,
                    color: colors.caption,
                    textTransform: 'uppercase',
                    letterSpacing: '2px',
                  },
                  children: 'BOT · AUTOMATIZADO',
                },
              },
              {
                type: 'div',
                props: {
                  style: {
                    fontFamily: fonts.display,
                    fontSize: 280,
                    lineHeight: 0.9,
                    color: colors.ink,
                    textAlign: 'right',
                  },
                  children: '2027',
                },
              },
              {
                type: 'div',
                props: {
                  style: {
                    fontFamily: fonts.mono,
                    fontSize: 18,
                    color: colors.linkBlue,
                    letterSpacing: '1px',
                  },
                  children: opts.domain,
                },
              },
            ],
          },
        },
      ],
    },
  };
}

export const brandSizes = {
  logo: { width: LOGO_SIZE, height: LOGO_SIZE },
  banner: { width: BANNER_W, height: BANNER_H },
};
