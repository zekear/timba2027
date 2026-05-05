import { colors, fonts, sizes, tracking } from '../tokens.js';

export function Footer(timestamp: string, source: string, handle: string) {
  return {
    type: 'div',
    key: 'footer',
    props: {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        height: sizes.footerHeight,
        paddingLeft: sizes.padding,
        paddingRight: sizes.padding,
        borderTop: `2px solid ${colors.ink}`,
        fontFamily: fonts.mono,
        fontSize: sizes.meta,
        textTransform: 'uppercase',
        letterSpacing: tracking.metaLetterSpacing,
        color: colors.pageInk,
      },
      children: [
        {
          type: 'div',
          key: 'src',
          props: { children: `${timestamp} · ${source}` },
        },
        {
          type: 'div',
          key: 'h',
          props: {
            style: { color: colors.linkBlue },
            children: handle,
          },
        },
      ],
    },
  };
}
