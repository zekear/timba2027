import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface SatoriFont {
  name: string;
  data: Buffer;
  weight: number;
  style: 'normal' | 'italic';
}

const FONT_DIR = resolve(process.cwd(), 'public/fonts');

let cache: SatoriFont[] | null = null;

export function loadFonts(): SatoriFont[] {
  if (cache) return cache;
  const files: Array<{ name: string; file: string; weight: number }> = [
    { name: 'PlayfairDisplay', file: 'PlayfairDisplay-Variable.ttf', weight: 400 },
    { name: 'Lora',            file: 'Lora-Variable.ttf',            weight: 400 },
    { name: 'Inter',           file: 'Inter-Variable.ttf',           weight: 700 },
    { name: 'JetBrainsMono',   file: 'JetBrainsMono-Variable.ttf',   weight: 400 },
  ];
  cache = files.map(({ name, file, weight }) => ({
    name,
    data: readFileSync(resolve(FONT_DIR, file)),
    weight,
    style: 'normal',
  }));
  return cache;
}
