/**
 * Extrae el primer objeto JSON balanceado de la respuesta del LLM.
 * Tolera prosa antes/después y bloques ```json ... ``` con markdown.
 *
 * Si no encuentra `{` y `}` balanceados, lanza Error con el inicio del raw
 * para diagnóstico (truncado a 200 chars).
 */
export function extractFirstJsonObject(raw: string, contextHint = 'llm'): unknown {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`${contextHint}: no JSON in output: ${trimmed.slice(0, 200)}`);
  }
  return JSON.parse(trimmed.slice(start, end + 1));
}
