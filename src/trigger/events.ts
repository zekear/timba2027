import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { events } from '../db/schema.js';
import { logger } from '../lib/logger.js';

export interface ClaimedEvent {
  id: number;
  type: string;
  payload: unknown;
}

/**
 * Inserta un evento nuevo con status='pending'. Devuelve el id.
 */
export async function emitEvent(type: string, payload: unknown): Promise<number> {
  const result = await db
    .insert(events)
    .values({ type, payload, status: 'pending' })
    .returning({ id: events.id });
  return result[0].id;
}

/**
 * Atomically reclama el evento pending más viejo y lo marca como 'processing'.
 * Usa FOR UPDATE SKIP LOCKED para que múltiples workers no se pisen.
 */
export async function claimNextPendingEvent(): Promise<ClaimedEvent | null> {
  const result = await db.execute(sql`
    UPDATE events
    SET status = 'processing'
    WHERE id = (
      SELECT id FROM events
      WHERE status = 'pending'
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, type, payload;
  `);
  const row = (result.rows as Array<{ id: number; type: string; payload: unknown }>)[0];
  if (!row) return null;
  return { id: row.id, type: row.type, payload: row.payload };
}

/**
 * Marca un evento como procesado.
 */
export async function markEventProcessed(id: number): Promise<void> {
  await db.execute(sql`
    UPDATE events SET status = 'processed', processed_at = NOW() WHERE id = ${id};
  `);
}

/**
 * Marca un evento como descartado (no se va a procesar — viola caps, etc.).
 */
export async function markEventDiscarded(id: number, reason: string): Promise<void> {
  logger.info({ eventId: id, reason }, 'event: discarded');
  await db.execute(sql`
    UPDATE events SET status = 'discarded', processed_at = NOW() WHERE id = ${id};
  `);
}
