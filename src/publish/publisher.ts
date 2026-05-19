import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';
import { uploadMedia, createTweet } from './x-write-client.js';
import { markPublished, approveDraft, schedulePost } from './transitions.js';
import { policyForMode, type PublishMode } from './modes.js';
import { adminState } from '../db/schema.js';

async function loadAdminOverrides(): Promise<{ mode?: string; killSwitch?: boolean }> {
  const rows = await db.select().from(adminState);
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  return {
    mode: map.publish_mode,
    killSwitch: map.kill_switch === 'true' ? true : map.kill_switch === 'false' ? false : undefined,
  };
}

async function isKillSwitchActive(): Promise<boolean> {
  const overrides = await loadAdminOverrides();
  if (overrides.killSwitch !== undefined) return overrides.killSwitch;
  if (process.env.KILL_SWITCH !== undefined) return process.env.KILL_SWITCH === 'true';
  return env.KILL_SWITCH;
}

const MAX_PER_RUN = 3;
// Tras N fallos consecutivos publicando el mismo post, marcarlo como killed
// para evitar retry loops (e.g. media inválido, URL alucinada). El usuario
// puede investigar el post y, si tiene fix, resetearlo manualmente.
const MAX_PUBLISH_FAILURES = 3;

/**
 * Registra un fallo de publicación para el post. Si supera MAX_PUBLISH_FAILURES,
 * marca el post como killed automáticamente.
 */
async function recordPublishFailure(postId: number, reason: string): Promise<void> {
  const rows = await db.execute(sql`
    UPDATE bot_posts
    SET publish_failures = jsonb_build_object(
      'count', COALESCE((publish_failures->>'count')::int, 0) + 1,
      'lastAt', NOW()::text,
      'lastReason', ${reason.slice(0, 500)}
    )
    WHERE id = ${postId}
    RETURNING (publish_failures->>'count')::int AS count
  `);
  const count = (rows.rows[0] as { count: number } | undefined)?.count ?? 0;
  if (count >= MAX_PUBLISH_FAILURES) {
    await db.execute(sql`UPDATE bot_posts SET status = 'killed' WHERE id = ${postId}`);
    logger.warn({ postId, count, reason: reason.slice(0, 200) }, 'publisher: auto-killed after max failures');
  }
}

type ThreadEntry = { caption: string; cardPath?: string };

interface SchedulableRow {
  id: number;
  caption: string;
  card_path: string;
  thread: ThreadEntry[] | null;
}

/**
 * Publica un post scheduled (o ya marcado para publish) a X: sube media,
 * postea tweet principal, postea replies del thread si hay, marca published.
 * No verifica window ni cap — los chequea quien llama (usado tanto por el
 * cron como por el botón "publish now" del admin).
 */
function mimeForCardPath(p: string): 'image/png' | 'image/gif' {
  return extname(p).toLowerCase() === '.gif' ? 'image/gif' : 'image/png';
}

async function publishRow(row: SchedulableRow): Promise<string> {
  const cardBuf = await readFile(resolve(process.cwd(), row.card_path));
  const mediaId = await uploadMedia(cardBuf, mimeForCardPath(row.card_path));
  const headTweetId = await createTweet({ text: row.caption, mediaIds: [mediaId] });

  let prevId = headTweetId;
  const thread = Array.isArray(row.thread) ? row.thread : [];
  for (const entry of thread) {
    const mediaIds: string[] = [];
    if (entry.cardPath) {
      const buf = await readFile(resolve(process.cwd(), entry.cardPath));
      mediaIds.push(await uploadMedia(buf, mimeForCardPath(entry.cardPath)));
    }
    prevId = await createTweet({ text: entry.caption, mediaIds, replyToTweetId: prevId });
  }

  await markPublished(row.id, headTweetId);
  if (thread.length > 0) {
    logger.info({ postId: row.id, threadLength: thread.length, headTweetId }, 'publisher: thread posted');
  }
  return headTweetId;
}

/**
 * Publica un post específico AHORA, bypassing window/mode pero respetando
 * kill switch. Usado por el endpoint admin "publish now".
 */
export async function publishOneNow(
  postId: number,
): Promise<{ ok: true; xPostId: string } | { ok: false; reason: string }> {
  if (await isKillSwitchActive()) {
    return { ok: false, reason: 'kill_switch_active' };
  }

  const r = await db.execute(sql`
    SELECT id, status, caption, card_path, thread FROM bot_posts WHERE id = ${postId}
  `);
  if (r.rows.length === 0) return { ok: false, reason: 'not_found' };
  const row = r.rows[0] as unknown as SchedulableRow & { status: string };

  if (row.status === 'published') {
    return { ok: false, reason: 'already_published' };
  }
  if (row.status === 'killed') {
    return { ok: false, reason: 'killed' };
  }
  // Asegurar que esté en scheduled antes de publicar — re-usamos las
  // transitions para que el log y los timestamps queden consistentes con
  // los publishes automáticos.
  if (row.status === 'draft') {
    await approveDraft(postId);
    await schedulePost(postId);
  } else if (row.status === 'approved') {
    await schedulePost(postId);
  }

  try {
    const xPostId = await publishRow(row);
    logger.info({ postId, xPostId }, 'publisher: published via publishOneNow');
    return { ok: true, xPostId };
  } catch (err) {
    logger.error({ postId, err: (err as Error).message }, 'publisher: publishOneNow failed');
    await recordPublishFailure(postId, (err as Error).message);
    return { ok: false, reason: (err as Error).message };
  }
}

export interface PublisherStats {
  scheduled: number;
  published: number;
  failed: number;
  skippedShadow: number;
  skippedKillSwitch: number;
  skippedMode: number;
}

export async function runPublisher(): Promise<PublisherStats> {
  const stats: PublisherStats = {
    scheduled: 0,
    published: 0,
    failed: 0,
    skippedShadow: 0,
    skippedKillSwitch: 0,
    skippedMode: 0,
  };

  // admin_state overrides env vars (allows runtime toggle from /admin)
  const overrides = await loadAdminOverrides();
  const mode = (overrides.mode ?? process.env.PUBLISH_MODE ?? env.PUBLISH_MODE) as PublishMode;

  if (await isKillSwitchActive()) {
    stats.skippedKillSwitch = await countScheduled();
    logger.warn({ mode }, 'publisher: KILL_SWITCH active — skipping');
    return stats;
  }

  const policy = policyForMode(mode);
  if (mode === 'shadow') {
    stats.skippedShadow = await countScheduled();
    return stats;
  }
  if (!policy.canPublish(new Date())) {
    stats.skippedMode = await countScheduled();
    logger.debug({ mode }, 'publisher: outside publish window for current mode');
    return stats;
  }

  const scheduled = await db.execute(sql`
    SELECT id, caption, card_path, thread FROM bot_posts
    WHERE status = 'scheduled'
    ORDER BY generated_at ASC
    LIMIT ${MAX_PER_RUN}
  `);
  stats.scheduled = scheduled.rows.length;

  for (const row of scheduled.rows as unknown as SchedulableRow[]) {
    try {
      await publishRow(row);
      stats.published++;
    } catch (err) {
      stats.failed++;
      logger.error(
        { postId: row.id, err: (err as Error).message },
        'publisher: failed to publish',
      );
      await recordPublishFailure(row.id, (err as Error).message);
    }
  }

  logger.info({ ...stats, mode }, 'publisher: run complete');
  return stats;
}

async function countScheduled(): Promise<number> {
  const r = await db.execute(sql`SELECT COUNT(*)::int AS c FROM bot_posts WHERE status = 'scheduled'`);
  return (r.rows[0] as { c: number }).c;
}
