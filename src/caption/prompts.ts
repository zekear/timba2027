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
  // Para market_move también extraemos slug/question si están
  const event = shape === 'market_move' ? (data.event as { marketSlug?: string; marketQuestion?: string; priceNow?: number; siblings?: unknown[] } | undefined) : undefined;
  const marketSlug = event?.marketSlug;
  const isInflationMonthly = marketSlug ? /monthly/i.test(marketSlug) : false;
  const isInflationAnnual = marketSlug ? /inflation/i.test(marketSlug) && !isInflationMonthly : false;
  const isPresidential = marketSlug ? /presidential|president|election/i.test(marketSlug) : false;
  const priceNowPct = event?.priceNow != null ? (event.priceNow * 100).toFixed(1) : null;
  const siblingsCount = event?.siblings?.length ?? 0;

  const marketTypeHint =
    marketType === 'inflation'
      ? `

IMPORTANTE — Mercado de INFLACIÓN${isInflationMonthly ? ' MENSUAL (abril)' : isInflationAnnual ? ' ANUAL 2026' : ''}.
El campo "candidate" es un RANGO de inflación (ej: "30-34.9%", "≤2.1%"), NO una persona.
El precio (priceNow) es la PROBABILIDAD que el mercado le asigna a que la inflación ${isInflationMonthly ? 'mensual de abril' : isInflationAnnual ? 'anual 2026' : ''} caiga en ese rango.
Convertir precio raw a porcentaje: priceNow=0.191 → 19.1%${priceNowPct ? ` (en este caso: ${priceNowPct}%)` : ''}.

Vocabulario CORRECTO: "rango", "tramo", "probabilidad", "el mercado le asigna X%".
Vocabulario PROHIBIDO: "candidato", "apuestas para [rango]", "votos", "ganar".
Ejemplo bueno: "🔔 Polymarket — Inflación anual 2026: la probabilidad del rango 30-34.9% subió de 29% a 33% en 6h."
Ejemplo MALO: "Apuestas para candidato 30-34.9%" / "subió a 0.33" (usa formato decimal, no porcentaje).`
      : marketType === 'electoral'
      ? `

Mercado ELECTORAL${isPresidential ? ' — Presidencial 2027' : ''}.
El "candidate" es una persona (Milei, Kicillof, Bullrich, etc).
El precio (priceNow) es la probabilidad de victoria que el mercado le asigna.
Convertir precio raw a porcentaje: priceNow=0.52 → 52%${priceNowPct ? ` (en este caso: ${priceNowPct}%)` : ''}.

Usá formato porcentaje (52%), NO decimal (0.52).`
      : '';

  const siblingsHint =
    siblingsCount > 0
      ? `

CO-MOVIMIENTOS: este mercado tiene ${siblingsCount} ${siblingsCount === 1 ? 'otro candidato/rango' : 'candidatos/rangos'} co-moviéndose (campo "siblings"). Mencioná el principal Y el más relevante de los siblings (mayor |deltaPct|) en una frase. Ej: "X subió App y Z bajó Bpp" o "X +App, Y -Bpp en el mismo mercado".`
      : '';

  return `
Estás escribiendo un tweet para una cuenta automatizada que reporta datos políticos argentinos.
Tono: factual, conciso, en español rioplatense, sin opinión política, sin partidismo.

Tipo de post: ${shapeHint}.${marketTypeHint}${siblingsHint}

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
