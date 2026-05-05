const FORBIDDEN_PHRASES = [
  'sin duda',
  'sin dudas',
  'ganará',
  'perderá',
  'va a ganar',
  'va a perder',
];

export interface LintResult {
  ok: boolean;
  violations: string[];
}

const NUMBER_RX = /-?\d+(?:[\.,]\d+)?/g;

export function lintCaption(
  caption: string,
  allowed: { numbers: number[] },
): LintResult {
  const violations: string[] = [];
  const lower = caption.toLowerCase();

  for (const phrase of FORBIDDEN_PHRASES) {
    if (lower.includes(phrase)) {
      violations.push(`forbidden phrase: ${phrase}`);
    }
  }

  const matches = caption.match(NUMBER_RX) ?? [];
  for (const m of matches) {
    const n = Number(m.replace(',', '.'));
    if (Number.isNaN(n)) continue;
    const allowedHit = allowed.numbers.some((a) => Math.abs(a - n) < 0.05);
    if (!allowedHit) violations.push(m);
  }

  return { ok: violations.length === 0, violations };
}

/**
 * Helper: extrae todos los numbers (recursivamente) de un objeto plain.
 */
export function collectNumbers(obj: unknown, out: number[] = []): number[] {
  if (typeof obj === 'number') out.push(obj);
  else if (typeof obj === 'string') {
    const matches = obj.match(NUMBER_RX) ?? [];
    for (const m of matches) {
      const n = Number(m.replace(',', '.'));
      if (!Number.isNaN(n)) out.push(n);
    }
  } else if (Array.isArray(obj)) {
    for (const x of obj) collectNumbers(x, out);
  } else if (obj && typeof obj === 'object') {
    for (const v of Object.values(obj)) collectNumbers(v, out);
  }
  return out;
}
