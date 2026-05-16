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
    discardReason: text('discard_reason'),                // populated cuando status = 'discarded'
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => ({
    pendingIdx: index('events_pending_idx').on(t.status, t.createdAt),
  }),
);

// ──────────────────────────────────────────────────────────────────
// Pollsters (encuestadoras y analistas que monitoreamos)
// ──────────────────────────────────────────────────────────────────

export const pollsters = pgTable('pollsters', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),         // 'opinaia' | 'cb_consultora' | etc.
  displayName: text('display_name').notNull(),   // 'Opinaia'
  xHandle: text('x_handle').notNull().unique(),  // 'opinaiagency' (sin @)
  xUserId: text('x_user_id'),                    // populated después del primer fetch
  lastSeenTweetId: text('last_seen_tweet_id'),
  active: boolean('active').notNull().default(true),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ──────────────────────────────────────────────────────────────────
// Polls (encuestas extraídas)
// ──────────────────────────────────────────────────────────────────

export const pollConfidenceEnum = pgEnum('poll_confidence', ['alto', 'medio', 'bajo']);
export const pollStatusEnum = pgEnum('poll_status', [
  'pending_review',
  'approved',
  'auto_approved',
  'rejected',
]);

export const polls = pgTable(
  'polls',
  {
    id: serial('id').primaryKey(),
    pollsterId: integer('pollster_id').notNull().references(() => pollsters.id),
    sourceUrl: text('source_url').notNull(),
    sourceTweetId: text('source_tweet_id').notNull(),
    fechaCampo: timestamp('fecha_campo', { withTimezone: true }),
    sampleSize: integer('sample_size'),
    metodologia: text('metodologia'),
    results: jsonb('results').$type<Array<{ candidato: string; pct: number }>>().notNull(),
    confidence: pollConfidenceEnum('confidence').notNull(),
    status: pollStatusEnum('status').notNull().default('pending_review'),
    rawClassifierOutput: text('raw_classifier_output'),
    rawExtractorOutput: text('raw_extractor_output'),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).defaultNow().notNull(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  },
  (t) => ({
    sourceTweetUq: uniqueIndex('polls_source_tweet_uq').on(t.sourceTweetId),
    pendingIdx: index('polls_pending_idx').on(t.status, t.ingestedAt),
    pollsterIdx: index('polls_pollster_idx').on(t.pollsterId, t.ingestedAt),
  }),
);

// ──────────────────────────────────────────────────────────────────
// Admin state (singleton key-value para runtime toggles)
// ──────────────────────────────────────────────────────────────────

export const adminState = pgTable('admin_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ──────────────────────────────────────────────────────────────────
// Bot posts (cards + captions generadas por el trigger engine)
// ──────────────────────────────────────────────────────────────────

export const botPostShapeEnum = pgEnum('bot_post_shape', [
  'morning_brief',
  'market_move',
  'new_poll',
  'hot_news',
  'weekly_recap',
  'duelo_crossover',
]);

export const botPostStatusEnum = pgEnum('bot_post_status', [
  'draft',
  'approved',
  'scheduled',
  'published',
  'killed',
]);

export const botPosts = pgTable(
  'bot_posts',
  {
    id: serial('id').primaryKey(),
    shape: botPostShapeEnum('shape').notNull(),
    status: botPostStatusEnum('status').notNull().default('draft'),
    caption: text('caption').notNull(),
    cardPath: text('card_path').notNull(),
    sourceSnapshot: jsonb('source_snapshot').notNull(),
    llmMetadata: jsonb('llm_metadata').notNull(),
    eventId: integer('event_id').references(() => events.id),
    candidateFocus: text('candidate_focus'),
    generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    xPostId: text('x_post_id'),
    metrics: jsonb('metrics'),
    // Para shape='weekly_recap' u otros threads: array de replies después del tweet principal.
    // null o [] = single tweet (comportamiento existente). Cada entry: { caption, cardPath?, xPostId? }.
    thread: jsonb('thread'),
  },
  (t) => ({
    statusIdx: index('bot_posts_status_idx').on(t.status, t.generatedAt),
    candidateIdx: index('bot_posts_candidate_idx').on(t.candidateFocus, t.generatedAt),
    eventIdx: index('bot_posts_event_idx').on(t.eventId),
  }),
);
