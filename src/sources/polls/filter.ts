/**
 * Filtro grueso barato (sin LLM) para descartar tweets que claramente
 * no son encuestas. La lógica es laxa: false-positivos OK (después
 * los filtra el classifier LLM), false-negativos caros (perdemos data).
 */

const POLL_KEYWORDS = [
  'encuesta',
  'medicion',
  'medición',
  'intención de voto',
  'intencion de voto',
  'imagen positiva',
  'imagen negativa',
  'tracking',
  'sondeo',
  'cb consultora',
  'opinaia',
  'atlas intel',
  'synopsis',
  'zuban',
];

const CANDIDATE_NAMES = [
  'milei',
  'kicillof',
  'massa',
  'bullrich',
  'macri',
  'larreta',
  'cristina',
  'villarruel',
];

export function mightBePoll(
  text: string,
  opts: { hasMedia?: boolean } = {},
): boolean {
  const lower = text.toLowerCase();

  // Reject obvio: arranca con @ (reply directa) y no tiene media
  if (lower.trim().startsWith('@') && !opts.hasMedia) return false;

  // Match por keyword fuerte
  if (POLL_KEYWORDS.some((kw) => lower.includes(kw))) return true;

  // Match por porcentaje + nombre de candidato (típico formato)
  const hasPct = /\d{1,2}[\.,]?\d?\s*%/.test(text);
  const hasCandidate = CANDIDATE_NAMES.some((c) => lower.includes(c));
  if (hasPct && hasCandidate) return true;

  // Si tiene media adjunta + algún hint, dejarlo pasar
  if (opts.hasMedia && hasCandidate) return true;
  if (opts.hasMedia && hasPct) return true;

  // Si tiene media y el texto sugiere datos/resultados
  if (opts.hasMedia && /datos|resultados|medición|encuesta/i.test(text)) {
    return true;
  }

  return false;
}
