export interface CaptionContext {
  shape: 'morning_brief' | 'market_move' | 'new_poll' | 'hot_news';
  data: Record<string, unknown>;
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

  return `
Estás escribiendo un tweet para una cuenta automatizada que reporta datos electorales argentinos.
Tono: factual, conciso, en español rioplatense, sin opinión política, sin partidismo.

Tipo de post: ${shapeHint}.

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
