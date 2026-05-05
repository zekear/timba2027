import { isNull, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { news } from '../../db/schema.js';
import { llm } from '../../llm/index.js';
import { logger } from '../../lib/logger.js';
import { extractFirstJsonObject } from '../../lib/llm-json.js';

const tagSchema = z.object({
  candidates: z.array(z.string()),  // nombres mencionados (ej: ["Milei", "Kicillof"])
  category: z.enum(['campania', 'gobierno', 'economia', 'escandalo', 'debate', 'otro']),
  relevance: z.number().min(0).max(1),
});

const PROMPT_TEMPLATE = (headline: string, excerpt: string | null) => `
Sos un clasificador de noticias políticas argentinas.
Dada una nota, devolvé EXCLUSIVAMENTE un JSON con la siguiente forma:

{
  "candidates": ["nombre1", ...],   // candidatos/políticos mencionados (apellido o nombre completo)
  "category": "campania" | "gobierno" | "economia" | "escandalo" | "debate" | "otro",
  "relevance": 0.0-1.0              // qué tan relevante es para el ciclo electoral 2027/2026
}

Reglas:
- "candidates" SOLO incluye personas con potencial electoral nacional (presidenciables, gobernadores con peso, líderes de partidos). NO incluye periodistas o funcionarios menores.
- "category": "campania" si trata de elecciones/candidatos; "gobierno" gestión/decisiones del Ejecutivo; "economia" macro/medidas económicas; "escandalo" denuncias/judicial; "debate" eventos/foros; "otro" si no encaja.
- "relevance" alto (>0.7) si la nota mueve la aguja electoral, bajo (<0.3) si es color/anecdótico.

Headline: ${headline}
Excerpt: ${excerpt ?? '(sin excerpt)'}

Devolvé SOLO el JSON, sin texto adicional, sin markdown.
`.trim();

const BATCH_SIZE = 20;

export async function runNewsTagger(): Promise<{ tagged: number; failed: number }> {
  const pending = await db
    .select({ id: news.id, headline: news.headline, excerpt: news.bodyExcerpt })
    .from(news)
    .where(isNull(news.taggedAt))
    .limit(BATCH_SIZE);

  if (!pending.length) {
    logger.debug('news: no pending items to tag');
    return { tagged: 0, failed: 0 };
  }

  let tagged = 0;
  let failed = 0;

  for (const item of pending) {
    try {
      const raw = await llm.classify(PROMPT_TEMPLATE(item.headline, item.excerpt), { model: 'haiku' });
      const json = extractFirstJsonObject(raw, 'tagger');
      const parsed = tagSchema.parse(json);

      await db
        .update(news)
        .set({
          candidatesMentioned: parsed.candidates,
          category: parsed.category,
          relevanceScore: parsed.relevance.toFixed(2),
          taggedAt: new Date(),
        })
        .where(eq(news.id, item.id));
      tagged++;
    } catch (err) {
      logger.warn({ id: item.id, err: (err as Error).message }, 'news: tag failed');
      failed++;
      // no marcamos taggedAt — se reintenta en el próximo run
    }
  }

  logger.info({ tagged, failed }, 'news: tagging batch complete');
  return { tagged, failed };
}

