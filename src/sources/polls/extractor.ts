import { z } from 'zod';
import { llm } from '../../llm/index.js';
import { extractFirstJsonObject } from '../../lib/llm-json.js';

export const extractedPollSchema = z.object({
  pollster_hint: z.string().nullable(),       // ej: "Opinaia" si la imagen lo dice
  fecha_campo: z.string().nullable(),         // ISO date si está claro, null si no
  sample_size: z.number().int().positive().nullable(),
  metodologia: z.enum(['online', 'telefonica', 'mixta', 'cara_a_cara', 'desconocida']).nullable(),
  results: z.array(
    z.object({
      candidato: z.string().min(1),
      pct: z.number().min(0).max(100),
    }),
  ).min(2),                                   // si la imagen tiene <2 filas no es una encuesta
});

export type ExtractedPoll = z.infer<typeof extractedPollSchema>;

const PROMPT = `
Sos un extractor estructurado de encuestas políticas argentinas. Recibís una imagen
que contiene una tabla, gráfico o texto con resultados de una encuesta de intención
de voto o imagen política.

Devolvé EXCLUSIVAMENTE un JSON con esta forma:

{
  "pollster_hint": "string o null",          // qué encuestadora se ve en la imagen, si es claro
  "fecha_campo": "YYYY-MM-DD o null",        // fecha del campo de la encuesta (no fecha de publicación)
  "sample_size": "número entero o null",     // tamaño de muestra
  "metodologia": "online|telefonica|mixta|cara_a_cara|desconocida",
  "results": [
    {"candidato": "Nombre Apellido", "pct": número entre 0 y 100},
    ...
  ]
}

Reglas:
- "results" debe tener al menos 2 candidatos. Si la imagen no tiene una encuesta clara
  con candidatos+porcentajes, devolvé "results": [] y los demás campos null.
- "candidato": usar nombre tal como aparece (ej "Milei" o "Javier Milei"; sin "Sr.").
- "pct": número, no string. "45%" → 45. "12,5%" → 12.5.
- Si no podés leer un valor, NO inventes — preferí null para ese campo.
- Devolvé SOLO el JSON, sin texto adicional, sin markdown fences.
`.trim();

export async function extractPollFromImage(image: Buffer): Promise<ExtractedPoll> {
  const raw = await llm.extractFromImage(PROMPT, image, { model: 'sonnet' });
  const json = extractFirstJsonObject(raw, 'extractor');
  return extractedPollSchema.parse(json);
}
