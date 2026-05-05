import { colors, fonts, sizes, tracking } from '../tokens.js';

export function Ribbon(text: string) {
  return {
    type: 'div',
    key: 'ribbon',
    props: {
      style: {
        display: 'flex',
        alignItems: 'center',
        height: sizes.ribbonHeight,
        background: colors.ink,
        color: colors.paperWhite,
        paddingLeft: sizes.padding,
        paddingRight: sizes.padding,
        fontFamily: fonts.mono,
        fontSize: sizes.kicker,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: tracking.kickerLetterSpacing,
      },
      children: text,
    },
  };
}
