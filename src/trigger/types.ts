import { z } from 'zod';

// ─── Event payload schemas (uno por tipo) ──────────────────────────

export const marketMoveEventSchema = z.object({
  marketId: z.string(),
  marketSlug: z.string().optional(),       // ej: 'argentina-presidential-election-winner'
  marketQuestion: z.string().optional(),   // ej: 'Who will win the 2027 Argentine presidential election?'
  candidate: z.string(),
  priceNow: z.number(),
  priceThen: z.number(),
  deltaPct: z.number(),
  windowHours: z.number(),
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
