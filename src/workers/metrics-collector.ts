/**
 * Cron worker que recolecta métricas de engagement (likes, RTs, replies,
 * impressions) de X para los tweets publicados en los últimos N días.
 *
 * Estrategia: 1 batch (bulk endpoint) que cubre todos los posts recientes
 * en una sola read op de X (~$0.005). Costo ~$0.12/día corriendo cada hora.
 */
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { fetchPostMetrics } from '../sources/x-metrics.js';

const RECENT_DAYS = 7;

export interface CollectorStats {
  tracked: number;
  updated: number;
  notFound: number;
}

export async function runMetricsCollector(): Promise<CollectorStats> {
  const stats: CollectorStats = { tracked: 0, updated: 0, notFound: 0 };

  // Targets: published posts con x_post_id dentro de la ventana de recolección.
  // Limit duro de 100 para que entre en 1 batch de X API (1 read op).
  const rows = await db.execute(sql`
    SELECT id, x_post_id FROM bot_posts
    WHERE status = 'published'
      AND x_post_id IS NOT NULL
      AND published_at > NOW() - INTERVAL '${sql.raw(String(RECENT_DAYS))} days'
    ORDER BY published_at DESC
    LIMIT 100
  `);
  const targets = (rows.rows as Array<{ id: number; x_post_id: string }>);
  stats.tracked = targets.length;
  if (targets.length === 0) return stats;

  const idToPostId = new Map<string, number>();
  for (const r of targets) idToPostId.set(r.x_post_id, r.id);
  const metrics = await fetchPostMetrics(targets.map((r) => r.x_post_id));

  // Actualizar bot_posts.metrics con snapshot fresh.
  // Guardamos también el timestamp de update para auditar staleness.
  const now = new Date().toISOString();
  for (const [tweetId, m] of metrics) {
    const postId = idToPostId.get(tweetId);
    if (!postId) continue;
    await db.execute(sql`
      UPDATE bot_posts
      SET metrics = ${sql.raw(`'${JSON.stringify({ ...m, updated_at: now }).replace(/'/g, "''")}'::jsonb`)}
      WHERE id = ${postId}
    `);
    stats.updated++;
  }
  stats.notFound = targets.length - metrics.size;

  logger.info({ ...stats }, 'metrics-collector: run complete');
  return stats;
}
