/**
 * Design tokens del sistema WIRED-inspired (ver DESIGN.md).
 * Solo subset usado en cards de bot. La fuente canónica es DESIGN.md.
 */

export const colors = {
  paperWhite: '#ffffff',
  ink: '#000000',
  pageInk: '#1a1a1a',
  caption: '#757575',
  hairline: '#e2e8f0',
  linkBlue: '#057dbc',
};

export const fonts = {
  display: 'PlayfairDisplay',
  body: 'Lora',
  ui: 'Inter',
  mono: 'JetBrainsMono',
};

export const sizes = {
  // Card output: 1200x675 (Twitter card large, 16:9)
  cardWidth: 1200,
  cardHeight: 675,

  ribbonHeight: 56,
  footerHeight: 60,
  padding: 48,

  // Type scale (px)
  display: 64,
  headline: 40,
  bodyLarge: 24,
  body: 18,
  kicker: 14,
  meta: 13,
};

export const tracking = {
  kickerLetterSpacing: '1.1px',
  metaLetterSpacing: '1.0px',
};
