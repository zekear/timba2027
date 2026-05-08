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
 *
 * IMPORTANTE: para cada número en [0, 1] (precios raw de Polymarket),
 * también incluimos su versión en porcentaje (×100, redondeada a 1
 * decimal). El prompt instruye al LLM a convertir 0.16 → 16%, así que
 * "16" debe estar en el allowed-set para que el linter no lo bloquee.
 *
 * También para cada número en [0, 100] (porcentajes), incluimos varias
 * representaciones para dar tolerancia: 16, 16.0, 15.0 (round down al
 * integer cercano), redondeo a 1 decimal, etc.
 */
export function collectNumbers(obj: unknown, out: number[] = []): number[] {
  if (typeof obj === 'number') {
    out.push(obj);
    expandRepresentations(obj, out);
  } else if (typeof obj === 'string') {
    const matches = obj.match(NUMBER_RX) ?? [];
    for (const m of matches) {
      const n = Number(m.replace(',', '.'));
      if (!Number.isNaN(n)) {
        out.push(n);
        expandRepresentations(n, out);
      }
    }
  } else if (Array.isArray(obj)) {
    for (const x of obj) collectNumbers(x, out);
  } else if (obj && typeof obj === 'object') {
    for (const v of Object.values(obj)) collectNumbers(v, out);
  }
  return out;
}

/**
 * Para un número, agrega representaciones equivalentes que el LLM
 * podría usar legítimamente (conversión raw→%, redondeos, etc).
 */
function expandRepresentations(n: number, out: number[]): void {
  // Precio raw [0, 1] → porcentaje (×100)
  if (n > 0 && n < 1) {
    const pct = n * 100;
    out.push(pct);
    out.push(Math.round(pct * 10) / 10);
    out.push(Math.round(pct));
  }
  // Versión absoluta (delta -8.4 → 8.4; el LLM puede decir "bajó 8.4pp" sin signo)
  if (n !== 0) {
    const abs = Math.abs(n);
    out.push(abs);
    out.push(Math.round(abs));
    out.push(Math.round(abs * 10) / 10);
  }
  // Redondeo al entero (LLM puede simplificar 8.4 → 8)
  if (Math.abs(n) <= 100) {
    out.push(Math.round(n));
    out.push(Math.round(n * 10) / 10);
  }
}
