import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { loadFonts } from './fonts.js';
import { colors, sizes } from './tokens.js';

export interface CardElement {
  type: string;
  key?: string;
  props: { style?: Record<string, unknown>; children?: unknown };
}

const STORAGE_DIR = resolve(process.cwd(), 'storage', 'cards');

/**
 * Envuelve los children en el frame estándar (paper white, 1200x675).
 */
export function frame(children: CardElement[]): CardElement {
  return {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: sizes.cardWidth,
        height: sizes.cardHeight,
        background: colors.paperWhite,
      },
      children,
    },
  };
}

/**
 * Renderiza un element-tree de Satori a PNG y lo escribe a storage/cards/<id>.png.
 * Devuelve el path absoluto y el path relativo (para guardar en DB).
 *
 * Default 1200×675 (Twitter card). Override width/height via opts para
 * logos cuadrados, banners, etc. Width/height del CardElement deben
 * coincidir con los pasados acá (sino aparecen letterbox/clipping).
 */
export async function renderToPng(
  card: CardElement,
  filenameWithoutExt: string,
  opts: { width?: number; height?: number } = {},
): Promise<{ absPath: string; relPath: string }> {
  const width = opts.width ?? sizes.cardWidth;
  const height = opts.height ?? sizes.cardHeight;
  const fonts = loadFonts() as unknown as Parameters<typeof satori>[1]['fonts'];
  const svg = await satori(card as unknown as Parameters<typeof satori>[0], {
    width,
    height,
    fonts,
  });
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: width } });
  const pngBuffer = resvg.render().asPng();

  const absPath = resolve(STORAGE_DIR, `${filenameWithoutExt}.png`);
  const relPath = `storage/cards/${filenameWithoutExt}.png`;
  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, pngBuffer);
  return { absPath, relPath };
}
