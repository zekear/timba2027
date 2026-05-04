import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  numeric,
  boolean,
  jsonb,
  index,
  uniqueIndex,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ──────────────────────────────────────────────────────────────────
// Polymarket
// ──────────────────────────────────────────────────────────────────

export const markets = pgTable('markets', {
  id: text('id').primaryKey(),                    // polymarket market id
  slug: text('slug').notNull(),
  question: text('question').notNull(),
  candidates: jsonb('candidates').$type<string[]>().notNull(), // ["Milei", "Kicillof", ...]
  endDate: timestamp('end_date', { withTimezone: true }),
  status: text('status').notNull(),               // open | closed | resolved
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const marketPrices = pgTable(
  'market_prices',
  {
    id: serial('id').primaryKey(),
    marketId: text('market_id').notNull().references(() => markets.id),
    candidate: text('candidate').notNull(),
    price: numeric('price', { precision: 6, scale: 4 }).notNull(),  // 0.0000–1.0000
    volume24h: numeric('volume_24h', { precision: 14, scale: 2 }),
    ts: timestamp('ts', { withTimezone: true }).notNull(),
  },
  (t) => ({
    candidateTsIdx: index('market_prices_candidate_ts_idx').on(t.candidate, t.ts),
    marketCandidateTsIdx: index('market_prices_market_candidate_ts_idx').on(t.marketId, t.candidate, t.ts),
  }),
);

// ──────────────────────────────────────────────────────────────────
// News
// ──────────────────────────────────────────────────────────────────

export const newsCategoryEnum = pgEnum('news_category', [
  'campania',
  'gobierno',
  'economia',
  'escandalo',
  'debate',
  'otro',
]);

export const news = pgTable(
  'news',
  {
    id: serial('id').primaryKey(),
    source: text('source').notNull(),                    // 'clarin' | 'lanacion' | etc.
    url: text('url').notNull(),
    headline: text('headline').notNull(),
    bodyExcerpt: text('body_excerpt'),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
    candidatesMentioned: jsonb('candidates_mentioned').$type<string[]>().default([]).notNull(),
    category: newsCategoryEnum('category'),
    relevanceScore: numeric('relevance_score', { precision: 3, scale: 2 }), // 0.00–1.00
    taggedAt: timestamp('tagged_at', { withTimezone: true }),               // null = pending tag
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    urlUq: uniqueIndex('news_url_uq').on(t.url),
    publishedIdx: index('news_published_idx').on(t.publishedAt),
    pendingTagIdx: index('news_pending_tag_idx').on(t.taggedAt).where(sql`tagged_at IS NULL`),
  }),
);

// ──────────────────────────────────────────────────────────────────
// Eventos (cola para fase 3)
// ──────────────────────────────────────────────────────────────────

export const events = pgTable(
  'events',
  {
    id: serial('id').primaryKey(),
    type: text('type').notNull(),                        // MARKET_MOVE | NEW_POLL | HOT_NEWS
    payload: jsonb('payload').notNull(),
    status: text('status').notNull().default('pending'), // pending | processed | discarded
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => ({
    pendingIdx: index('events_pending_idx').on(t.status, t.createdAt),
  }),
);
