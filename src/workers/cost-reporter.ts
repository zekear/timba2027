/**
 * Cron diario que agrega el costo de X API de las últimas 24h leyendo
 * /var/log/timba-worker.log y sumando los {cost} de los eventos
 * 'x-api: call'. Loguea un resumen estructurado al final del día.
 *
 * No requiere DB. Es resilient a logs faltantes (devuelve 0).
 */
import { readFile } from 'node:fs/promises';
import { logger } from '../lib/logger.js';

const LOG_PATH = '/var/log/timba-worker.log';

interface CallSummary {
  total: number;
  byType: Record<string, { count: number; cost: number }>;
  byEndpoint: Record<string, { count: number; cost: number }>;
}

export async function runCostReporter(): Promise<CallSummary> {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const summary: CallSummary = { total: 0, byType: {}, byEndpoint: {} };

  let raw: string;
  try {
    raw = await readFile(LOG_PATH, 'utf-8');
  } catch (err) {
    logger.warn({ err: (err as Error).message, path: LOG_PATH }, 'cost-reporter: log file unreachable');
    return summary;
  }

  for (const line of raw.split('\n')) {
    if (!line.includes('"x-api: call"')) continue;
    let entry: { time?: number; cost?: number; type?: string; endpoint?: string };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!entry.time || entry.time < cutoff) continue;
    const cost = Number(entry.cost ?? 0);
    const type = entry.type ?? 'unknown';
    const endpoint = entry.endpoint ?? 'unknown';

    summary.total += cost;
    const t = (summary.byType[type] ??= { count: 0, cost: 0 });
    t.count++;
    t.cost += cost;
    const e = (summary.byEndpoint[endpoint] ??= { count: 0, cost: 0 });
    e.count++;
    e.cost += cost;
  }

  logger.info(
    {
      window: '24h',
      total: Number(summary.total.toFixed(4)),
      byType: Object.fromEntries(
        Object.entries(summary.byType).map(([k, v]) => [k, { count: v.count, cost: Number(v.cost.toFixed(4)) }]),
      ),
      byEndpoint: Object.fromEntries(
        Object.entries(summary.byEndpoint).map(([k, v]) => [k, { count: v.count, cost: Number(v.cost.toFixed(4)) }]),
      ),
    },
    'cost-reporter: daily summary',
  );
  return summary;
}
