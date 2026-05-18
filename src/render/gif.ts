/**
 * Animated card rendering. Toma N CardElements (cada uno representa un frame
 * en el tiempo) y produce un GIF buffer listo para subir a X.
 *
 * Pipeline por frame: Satori (SVG) → Resvg (PNG) → Sharp (raw RGBA) → gifenc.
 *
 * Resolución sugerida: 800×450 (16:9 reducida). 1200×675 hace GIFs muy
 * pesados (>3MB) que X rechaza o degrada.
 */
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import gifenc from 'gifenc';
const { GIFEncoder, quantize, applyPalette } = gifenc;
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { loadFonts } from './fonts.js';
import type { CardElement } from './compose.js';

const STORAGE_DIR = resolve(process.cwd(), 'storage', 'cards');

export interface GifOpts {
  width?: number;
  height?: number;
  /** Delay entre frames en ms. Default 80ms (~12fps). */
  frameDelayMs?: number;
}

/**
 * Renderiza una serie de CardElements como GIF animado.
 * Devuelve el path absoluto y relativo del archivo escrito.
 */
export async function renderFramesToGif(
  frames: CardElement[],
  filenameWithoutExt: string,
  opts: GifOpts = {},
): Promise<{ absPath: string; relPath: string }> {
  const width = opts.width ?? 800;
  const height = opts.height ?? 450;
  const delay = opts.frameDelayMs ?? 80;

  const fonts = loadFonts() as unknown as Parameters<typeof satori>[1]['fonts'];
  const gif = GIFEncoder();

  for (const frame of frames) {
    const svg = await satori(frame as unknown as Parameters<typeof satori>[0], { width, height, fonts });
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng();
    // Sharp → raw RGBA
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.width !== width || info.height !== height) {
      throw new Error(`Frame dimensions mismatch: expected ${width}×${height}, got ${info.width}×${info.height}`);
    }
    const rgba = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
    const palette = quantize(rgba, 256);
    const indexed = applyPalette(rgba, palette);
    gif.writeFrame(indexed, width, height, { palette, delay });
  }
  gif.finish();
  const buffer = Buffer.from(gif.bytes());

  const absPath = resolve(STORAGE_DIR, `${filenameWithoutExt}.gif`);
  const relPath = `storage/cards/${filenameWithoutExt}.gif`;
  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, buffer);
  return { absPath, relPath };
}
