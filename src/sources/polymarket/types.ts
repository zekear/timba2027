import { z } from 'zod';

// Schema parcial de la respuesta de Gamma API (solo los campos que usamos).
// Polymarket API devuelve mucho más; aceptamos passthrough para no romper si agregan campos.
export const polymarketEventSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string().optional(),
  endDate: z.string().datetime().optional(),
  closed: z.boolean().optional(),
  archived: z.boolean().optional(),
  markets: z.array(
    z.object({
      id: z.union([z.string(), z.number()]).transform(String),
      question: z.string(),
      outcomes: z.string().optional(),     // JSON-encoded array string, e.g. '["Yes","No"]'
      outcomePrices: z.string().optional(),// JSON-encoded array string of prices
      volume24hr: z.union([z.string(), z.number()]).optional(),
      groupItemTitle: z.string().optional(), // candidato si es multi-outcome event
    }),
  ),
});

export type PolymarketEvent = z.infer<typeof polymarketEventSchema>;
