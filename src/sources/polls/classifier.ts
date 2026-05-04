import { z } from 'zod';
import { llm } from '../../llm/index.js';

const classifierSchema = z.object({
  is_poll: z.boolean(),
  confidence: z.enum(['alto', 'medio', 'bajo']),
  reason: z.string(),
});

export type ClassifierResult = z.infer<typeof classifierSchema>;

const PROMPT = (text: string, hasImage: boolean) => `
Sos un clasificador de tweets de encuestas políticas argentinas.
Recibís el texto del tweet ${hasImage ? '+ una imagen adjunta' : '(sin imagen)'}.

Decidí si el tweet contiene/es una encuesta de intención de voto, imagen política
(positiva/negativa), o tracking electoral CON DATOS NUMÉRICOS reportados.

NO clasificar como poll:
- Comentarios sobre encuestas ajenas sin datos.
- Memes o ironías sobre porcentajes.
- Anuncios de futuros estudios sin resultados.

SÍ clasificar como poll:
- Imagen de tabla de resultados con candidatos y porcentajes.
- Texto que reporta resultados de un estudio propio o ajeno con números.

Respondé EXCLUSIVAMENTE un JSON con esta forma:
{"is_poll": boolean, "confidence": "alto"|"medio"|"bajo", "reason": "string corto"}

Texto del tweet:
"""
${text}
"""
`.trim();

/**
 * Si hasImage=true, pasa la imagen al LLM (vision). Si false, solo texto.
 * El classifier usa Haiku tanto en text-only como en vision para mantener costo bajo.
 */
export async function classifyTweet(
  text: string,
  image?: Buffer,
): Promise<ClassifierResult> {
  const prompt = PROMPT(text, !!image);
  const raw = image
    ? await llm.extractFromImage(prompt, image, { model: 'haiku' })
    : await llm.classify(prompt, { model: 'haiku' });

  const json = extractFirstJsonObject(raw);
  return classifierSchema.parse(json);
}

function extractFirstJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error(`classifier: no JSON in output: ${trimmed.slice(0, 200)}`);
  }
  return JSON.parse(trimmed.slice(start, end + 1));
}
