import cron from 'node-cron';
import { pool } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { env } from '../lib/env.js';
import { runPolymarketIngest } from '../sources/polymarket/ingest.js';
import { detectMoves } from '../sources/polymarket/moves.js';
import { runNewsIngest } from '../sources/news/ingest.js';
import { runNewsTagger } from '../sources/news/tagger.js';

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

  // Run once at boot para validar que todo el wiring funciona.
  await runPolymarketIngest();
  await runNewsIngest();

  // Polymarket cada N min
  cron.schedule(`*/${env.POLYMARKET_POLL_INTERVAL_MIN} * * * *`, singleflight('polymarket-ingest', async () => {
    await runPolymarketIngest();
    const moves = await detectMoves({
      thresholdPct: env.MARKET_MOVE_THRESHOLD_PCT,
      windowHours: 6,
    });
    if (moves.length) logger.info({ moves }, 'orchestrator: market moves');
    // En fase 3 aquí se emiten events a la cola. Por ahora solo logueamos.
  }));

  // News ingest cada N min
  cron.schedule(`*/${env.NEWS_POLL_INTERVAL_MIN} * * * *`, singleflight('news-ingest', runNewsIngest));

  // News tagger cada 5 min (batches de 20)
  cron.schedule('*/5 * * * *', singleflight('news-tagger', runNewsTagger));

  logger.info(
    {
      polymarket_min: env.POLYMARKET_POLL_INTERVAL_MIN,
      news_min: env.NEWS_POLL_INTERVAL_MIN,
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
