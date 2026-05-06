export interface CaptionContext {
  shape: 'morning_brief' | 'market_move' | 'new_poll' | 'hot_news';
  data: Record<string, unknown>;
}

/**
 * Detecta si una "candidate label" de Polymarket es un nombre humano (mercado
 * electoral) o un rango numérico (mercado de inflación / inflation buckets).
 * Heurística: si solo tiene caracteres tipo numérico/símbolos, es rango.
 */
function classifyCandidate(label: string): 'electoral' | 'inflation' {
  // Solo dígitos, %, ., -, +, ≤, ≥, <, >, espacios → es rango
  if (/^[\d\s.,%≤≥<>+\-–]+$/.test(label)) return 'inflation';
  return 'electoral';
}

/**
 * Si los datos contienen un campo candidate-like, devuelve el hint.
 * null si no aplica (ej: morning_brief con multi candidates).
 */
function detectMarketType(shape: string, data: Record<string, unknown>): 'electoral' | 'inflation' | null {
  if (shape === 'market_move') {
    const event = data.event as { candidate?: string } | undefined;
    if (event?.candidate) return classifyCandidate(event.candidate);
  }
  if (shape === 'new_poll') {
    const top = (data.topCandidate as string | undefined) ?? null;
    if (top) return classifyCandidate(top);
  }
  return null;
}

export function captionPrompt(ctx: CaptionContext): string {
  const { shape, data } = ctx;
  const dataLines = Object.entries(data)
    .map(([k, v]) => `- ${k}: ${JSON.stringify(v)}`)
    .join('\n');

  const shapeHint = {
    morning_brief: 'resumen matutino del mercado de elecciones',
    market_move: 'alerta de movimiento en Polymarket',
    new_poll: 'nueva encuesta detectada',
    hot_news: 'noticia política de alto impacto',
  }[shape];

  const marketType = detectMarketType(shape, data);
  const marketTypeHint =
    marketType === 'inflation'
      ? `

IMPORTANTE — tipo de mercado: INFLACIÓN, no electoral.
El campo "candidate" NO es una persona, es un rango numérico (ej: "30-34.9%", "≤2.1%").
Vocabulario CORRECTO: "rango", "tramo", "intervalo", "opción", "bucket".
Vocabulario PROHIBIDO: "candidato", "candidata", "apuestas para [nombre]", "votos".
Ejemplo bueno: "Polymarket: el rango 30-34.9% subió +5pp en 6h."
Ejemplo MALO: "Apuestas para candidato 30-34.9% subieron." (no es candidato).`
      : marketType === 'electoral'
      ? `

Tipo de mercado: ELECTORAL. El "candidate" es una persona (Milei, Kicillof, etc).`
      : '';

  return `
Estás escribiendo un tweet para una cuenta automatizada que reporta datos políticos argentinos.
Tono: factual, conciso, en español rioplatense, sin opinión política, sin partidismo.

Tipo de post: ${shapeHint}.${marketTypeHint}

Datos source (los únicos números que podés mencionar):
${dataLines}

Generá UN tweet de máximo 220 caracteres.
- NO inventes números — solo podés usar números que aparecen literalmente en los datos source.
- NO repitas verbatim los datos (la card ya los muestra) — enfocate en *qué pasó* y *contexto*.
- Sin hashtags. Sin emojis (excepto un solo 🔔 al inicio si es alerta de movimiento).
- No uses palabras como "ganará", "perderá", "sin duda" — somos descriptivos, no predictivos.

Devolvé EXCLUSIVAMENTE el texto del tweet, sin prefijos, sin comillas.
`.trim();
}
