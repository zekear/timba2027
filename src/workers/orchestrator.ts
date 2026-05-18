import cron from 'node-cron';
import { sql, eq } from 'drizzle-orm';
import { db, pool } from '../db/client.js';
import { pollsters } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { env } from '../lib/env.js';
import { runPolymarketIngest } from '../sources/polymarket/ingest.js';
import { runNewsIngest } from '../sources/news/ingest.js';
import { runNewsTagger } from '../sources/news/tagger.js';
import { runPollsIngest } from '../sources/polls/ingest.js';
import { runMarketMoveWatcher } from '../trigger/watchers/market-move.js';
import { runNewPollWatcher } from '../trigger/watchers/new-poll.js';
import { runHotNewsWatcher } from '../trigger/watchers/hot-news.js';
import { runCrossoverWatcher } from '../trigger/watchers/duelo-crossover.js';
import { runMilestoneWatcher } from '../trigger/watchers/milestone.js';
import { runTriggerOrchestrator } from '../trigger/orchestrator.js';
import { runMorningBrief } from '../trigger/morning-brief.js';
import { runWeeklyRecap } from '../trigger/weekly-recap.js';
import { runPublisher } from '../publish/publisher.js';
import { schedulePost } from '../publish/transitions.js';

/**
 * Wrapper para que un cron job no se solape con sí mismo si tarda más de
 * lo esperado. Si la ejecución previa todavía corre, esta tick se descarta.
 */
function singleflight(name: string, fn: () => Promise<unknown>) {
  let running = false;
  return async () => {
    if (running) {
      logger.debug({ job: name }, 'job: skipped (previous still running)');
      return;
    }
    running = true;
    const start = Date.now();
    try {
      await fn();
      logger.debug({ job: name, ms: Date.now() - start }, 'job: ok');
    } catch (err) {
      logger.error({ job: name, err: (err as Error).message }, 'job: failed');
    } finally {
      running = false;
    }
  };
}

async function main() {
  logger.info('orchestrator: starting');

  // Boot-time validation — warn early on missing optional secrets
  // que se vuelven obligatorios en runtime cuando hay pollsters activos.
  if (!env.X_API_BEARER_TOKEN) {
    const activeCount = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(pollsters)
      .where(eq(pollsters.active, true));
    const count = activeCount[0]?.count ?? 0;
    if (count > 0) {
      logger.warn(
        { activePollsters: count },
        'orchestrator: X_API_BEARER_TOKEN missing — polls ingest will fail at next 6h tick',
      );
    }
  }

  // Run once at boot para validar que todo el wiring funciona.
  await runPolymarketIngest();
  await runNewsIngest();

  // Polymarket cada N min
  cron.schedule(`*/${env.POLYMARKET_POLL_INTERVAL_MIN} * * * *`, singleflight('polymarket-ingest', async () => {
    await runPolymarketIngest();
  }));

  // News ingest cada N min
  cron.schedule(`*/${env.NEWS_POLL_INTERVAL_MIN} * * * *`, singleflight('news-ingest', runNewsIngest));

  // News tagger cada 5 min (batches de 20)
  cron.schedule('*/5 * * * *', singleflight('news-tagger', runNewsTagger));

  // Polls cada N horas (X API es caro, no apuramos)
  cron.schedule(`0 */${env.POLLS_POLL_INTERVAL_HOURS} * * *`, singleflight('polls-ingest', runPollsIngest));

  // Watchers cada 5 min — emiten events si hay novedades
  cron.schedule('*/5 * * * *', singleflight('market-move-watcher', () =>
    runMarketMoveWatcher({
      thresholdPct: env.MARKET_MOVE_THRESHOLD_PCT,
      windowHours: env.MARKET_MOVE_WINDOW_HOURS,
    }).then(() => undefined)));
  cron.schedule('*/5 * * * *', singleflight('new-poll-watcher', () =>
    runNewPollWatcher().then(() => undefined)));
  cron.schedule('*/5 * * * *', singleflight('hot-news-watcher', () =>
    runHotNewsWatcher({ relevanceThreshold: 0.7 }).then(() => undefined)));
  // Crossover watcher cada 30 min (overtakes son raros, no vale chequear más seguido)
  cron.schedule('*/30 * * * *', singleflight('crossover-watcher', () =>
    runCrossoverWatcher().then(() => undefined)));
  // Milestone watcher cada 6h (los precios cambian gradual, no vale chequear más seguido)
  cron.schedule('0 */6 * * *', singleflight('milestone-watcher', () =>
    runMilestoneWatcher().then(() => undefined)));

  // Trigger orchestrator: cada 2 min consume events y genera drafts
  cron.schedule('*/2 * * * *', singleflight('trigger-orchestrator', () =>
    runTriggerOrchestrator().then(() => undefined)));

  // Morning brief diario a las 9am ARG (12:00 UTC)
  cron.schedule('0 12 * * *', singleflight('morning-brief', () =>
    runMorningBrief().then(() => undefined)));

  // Weekly recap thread: domingo 21:00 ART
  cron.schedule(
    '0 21 * * 0',
    singleflight('weekly-recap', () => runWeeklyRecap().then(() => undefined)),
    { timezone: 'America/Argentina/Buenos_Aires' },
  );

  // Soft-launch delay: approved → scheduled tras SOFT_LAUNCH_DELAY_SEC.
  // Cron cada 30s. Cap implícito por LIMIT 10.
  cron.schedule('*/30 * * * * *', singleflight('soft-launch-delay', async () => {
    const result = await db.execute(sql`
      SELECT id FROM bot_posts
      WHERE status = 'approved'
        AND generated_at <= NOW() - (${env.SOFT_LAUNCH_DELAY_SEC} || ' seconds')::interval
      LIMIT 10
    `);
    for (const row of result.rows as Array<{ id: number }>) {
      try {
        await schedulePost(row.id);
      } catch (err) {
        logger.warn({ postId: row.id, err: (err as Error).message }, 'soft-launch: schedule failed');
      }
    }
  }));

  // Publisher: cada minuto consume scheduled posts hacia X (cuando mode lo permite).
  cron.schedule('* * * * *', singleflight('publisher', () => runPublisher().then(() => undefined)));

  logger.info(
    {
      polymarket_min: env.POLYMARKET_POLL_INTERVAL_MIN,
      news_min: env.NEWS_POLL_INTERVAL_MIN,
      polls_hours: env.POLLS_POLL_INTERVAL_HOURS,
      publish_mode: env.PUBLISH_MODE,
      kill_switch: env.KILL_SWITCH,
      soft_launch_delay_sec: env.SOFT_LAUNCH_DELAY_SEC,
    },
    'orchestrator: schedules registered',
  );
}

main().catch((err) => {
  logger.fatal({ err: (err as Error).message }, 'orchestrator: fatal');
  process.exit(1);
});

// Graceful shutdown — drena el pool antes de exit y maneja SIGTERM + SIGINT.
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'orchestrator: signal received, shutting down');
  try {
    await pool.end();
    logger.info('orchestrator: pool drained');
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'orchestrator: pool drain failed');
  }
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
