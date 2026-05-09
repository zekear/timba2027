import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { botPosts, polls, pollsters } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { claimNextPendingEvent, markEventProcessed, markEventDiscarded } from './events.js';
import { canPostNow } from './caps.js';
import { marketMoveEventSchema, newPollEventSchema, hotNewsEventSchema } from './types.js';
import { renderToPng } from '../render/compose.js';
import { marketMoveCard } from '../render/cards/market-move.js';
import { newPollCard } from '../render/cards/new-poll.js';
import { hotNewsCard } from '../render/cards/hot-news.js';
import { generateCaption } from '../caption/generate.js';
import { env } from '../lib/env.js';

const HANDLE = env.BOT_HANDLE;

function nowStr(): string {
  const d = new Date();
  const h = (d.getUTCHours() + 24 - 3) % 24;
  const m = d.getUTCMinutes();
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} GMT-3`;
}

export interface OrchestratorStats {
  claimed: number;
  drafted: number;
  discarded: Record<string, number>;
}

export async function runTriggerOrchestrator(): Promise<OrchestratorStats> {
  const stats: OrchestratorStats = { claimed: 0, drafted: 0, discarded: {} };
  const MAX_PER_RUN = 5;

  for (let i = 0; i < MAX_PER_RUN; i++) {
    const ev = await claimNextPendingEvent();
    if (!ev) break;
    stats.claimed++;

    try {
      let result: { ok: true; postId: number } | { ok: false; reason: string };

      switch (ev.type) {
        case 'MARKET_MOVE': {
          const payload = marketMoveEventSchema.parse(ev.payload);
          result = await handleMarketMove(ev.id, payload);
          break;
        }
        case 'NEW_POLL': {
          const payload = newPollEventSchema.parse(ev.payload);
          result = await handleNewPoll(ev.id, payload);
          break;
        }
        case 'HOT_NEWS': {
          const payload = hotNewsEventSchema.parse(ev.payload);
          result = await handleHotNews(ev.id, payload);
          break;
        }
        default:
          result = { ok: false, reason: `unknown_event_type:${ev.type}` };
      }

      if (result.ok) {
        await markEventProcessed(ev.id);
        stats.drafted++;
      } else {
        await markEventDiscarded(ev.id, result.reason);
        stats.discarded[result.reason] = (stats.discarded[result.reason] ?? 0) + 1;
      }
    } catch (err) {
      logger.error({ eventId: ev.id, err: (err as Error).message }, 'orchestrator: handler failed');
      await markEventDiscarded(ev.id, `handler_error:${(err as Error).message.slice(0, 80)}`);
    }
  }

  logger.info({ ...stats }, 'trigger: orchestrator run complete');
  return stats;
}

async function handleMarketMove(
  eventId: number,
  payload: ReturnType<typeof marketMoveEventSchema.parse>,
): Promise<{ ok: true; postId: number } | { ok: false; reason: string }> {
  // bypassQuietHours: drafts pueden generarse 24/7. Quiet hours
  // solo aplican en publish (publisher.ts → policyForMode + caps).
  const cap = await canPostNow({ now: new Date(), candidateFocus: payload.candidate, bypassQuietHours: true, bypassDailyCap: true });
  if (!cap.ok) return { ok: false, reason: cap.reason ?? 'cap_unknown' };

  const card = marketMoveCard({
    event: payload,
    timestamp: nowStr(),
    handle: HANDLE,
  });

  const filename = `event-${eventId}-market-move`;
  const { relPath } = await renderToPng(card, filename);

  const cap_ = await generateCaption({
    shape: 'market_move',
    data: { event: payload },
  });

  const inserted = await db.insert(botPosts).values({
    shape: 'market_move',
    status: 'draft',
    caption: cap_.caption,
    cardPath: relPath,
    sourceSnapshot: { event: payload },
    llmMetadata: {
      source: cap_.source,
      attempts: cap_.attempts,
      lintViolations: cap_.lintViolations,
      rawOutputs: cap_.rawOutputs,
    },
    eventId,
    candidateFocus: payload.candidate,
  }).returning({ id: botPosts.id });

  return { ok: true, postId: inserted[0].id };
}

async function handleNewPoll(
  eventId: number,
  payload: ReturnType<typeof newPollEventSchema.parse>,
): Promise<{ ok: true; postId: number } | { ok: false; reason: string }> {
  const cap = await canPostNow({ now: new Date(), candidateFocus: payload.topCandidate, bypassQuietHours: true, bypassDailyCap: true });
  if (!cap.ok) return { ok: false, reason: cap.reason ?? 'cap_unknown' };

  const [poll] = await db.select().from(polls).where(eq(polls.id, payload.pollId));
  if (!poll) return { ok: false, reason: 'poll_not_found' };
  const [pollster] = await db.select().from(pollsters).where(eq(pollsters.id, poll.pollsterId));

  const card = newPollCard({
    pollsterDisplayName: pollster?.displayName ?? payload.pollsterSlug,
    fechaCampo: poll.fechaCampo ? poll.fechaCampo.toISOString().slice(0, 10) : null,
    sampleSize: poll.sampleSize,
    results: poll.results,
    timestamp: nowStr(),
    handle: HANDLE,
  });

  const filename = `event-${eventId}-new-poll`;
  const { relPath } = await renderToPng(card, filename);

  const captionData = {
    pollsterSlug: payload.pollsterSlug,
    pollsterDisplayName: pollster?.displayName ?? payload.pollsterSlug,
    topCandidate: payload.topCandidate,
    topCandidatePct: payload.topCandidatePct,
    sampleSize: poll.sampleSize,
  };
  const cap_ = await generateCaption({ shape: 'new_poll', data: captionData });

  const inserted = await db.insert(botPosts).values({
    shape: 'new_poll',
    status: 'draft',
    caption: cap_.caption,
    cardPath: relPath,
    sourceSnapshot: captionData,
    llmMetadata: {
      source: cap_.source,
      attempts: cap_.attempts,
      lintViolations: cap_.lintViolations,
      rawOutputs: cap_.rawOutputs,
    },
    eventId,
    candidateFocus: payload.topCandidate,
  }).returning({ id: botPosts.id });

  return { ok: true, postId: inserted[0].id };
}

async function handleHotNews(
  eventId: number,
  payload: ReturnType<typeof hotNewsEventSchema.parse>,
): Promise<{ ok: true; postId: number } | { ok: false; reason: string }> {
  const focusCandidate = payload.candidatesMentioned[0] ?? null;
  const cap = await canPostNow({ now: new Date(), candidateFocus: focusCandidate, bypassQuietHours: true, bypassDailyCap: true });
  if (!cap.ok) return { ok: false, reason: cap.reason ?? 'cap_unknown' };

  const card = hotNewsCard({
    source: payload.source,
    headline: payload.headline,
    candidatesMentioned: payload.candidatesMentioned,
    correlatedMove: payload.correlatedMove,
    timestamp: nowStr(),
    handle: HANDLE,
  });

  const filename = `event-${eventId}-hot-news`;
  const { relPath } = await renderToPng(card, filename);

  const cap_ = await generateCaption({ shape: 'hot_news', data: payload });

  const inserted = await db.insert(botPosts).values({
    shape: 'hot_news',
    status: 'draft',
    caption: cap_.caption,
    cardPath: relPath,
    sourceSnapshot: payload,
    llmMetadata: {
      source: cap_.source,
      attempts: cap_.attempts,
      lintViolations: cap_.lintViolations,
      rawOutputs: cap_.rawOutputs,
    },
    eventId,
    candidateFocus: focusCandidate,
  }).returning({ id: botPosts.id });

  return { ok: true, postId: inserted[0].id };
}
