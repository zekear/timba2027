import { z } from 'zod';

// ─── Event payload schemas (uno por tipo) ──────────────────────────

/**
 * Un MARKET_MOVE event representa cambios significativos en UN mercado.
 *
 * - El move "principal" (mayor |deltaPct|) sale en los campos top-level
 *   (candidate, priceNow, priceThen, deltaPct) — esto preserva compat con
 *   código existente y se usa para candidate_focus / cooldown.
 * - Los siblings son co-moves en el mismo mercado por encima del threshold,
 *   ordenados por |deltaPct| desc. Vacío cuando solo se movió un candidato.
 *
 * Caso típico: inflación (varios buckets co-mueven) → 1 evento con N siblings.
 * Caso simple: presidencial donde solo Milei subió → 1 evento, siblings vacío.
 */
export const marketMoveEventSchema = z.object({
  marketId: z.string(),
  marketSlug: z.string().optional(),
  marketQuestion: z.string().optional(),
  candidate: z.string(),
  priceNow: z.number(),
  priceThen: z.number(),
  deltaPct: z.number(),
  windowHours: z.number(),
  siblings: z
    .array(
      z.object({
        candidate: z.string(),
        priceNow: z.number(),
        priceThen: z.number(),
        deltaPct: z.number(),
      }),
    )
    .default([]),
});
export type MarketMoveEvent = z.infer<typeof marketMoveEventSchema>;

export const newPollEventSchema = z.object({
  pollId: z.number().int().positive(),
  pollsterSlug: z.string(),
  topCandidate: z.string(),
  topCandidatePct: z.number(),
});
export type NewPollEvent = z.infer<typeof newPollEventSchema>;

export const hotNewsEventSchema = z.object({
  newsId: z.number().int().positive(),
  source: z.string(),
  headline: z.string(),
  url: z.string().url().optional(),
  candidatesMentioned: z.array(z.string()),
  relevanceScore: z.number(),
  correlatedMove: z.object({
    candidate: z.string(),
    deltaPct: z.number(),
  }).nullable(),
});
export type HotNewsEvent = z.infer<typeof hotNewsEventSchema>;

export const EVENT_TYPES = ['MARKET_MOVE', 'NEW_POLL', 'HOT_NEWS'] as const;
export type EventType = typeof EVENT_TYPES[number];
