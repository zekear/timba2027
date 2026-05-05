/**
 * Seed idempotente. Estrategia:
 *   1. Marcar TODOS los pollsters existentes como active=false.
 *   2. Upsertar los del array POLLSTERS con active=true.
 *
 * Resultado: lo que aparece en pollsters.ts queda activo; lo que se quitó del
 * array queda inactive (no se borra para preservar FK con polls).
 *
 * Run: pnpm tsx scripts/seed-pollsters.ts
 */
import { sql } from 'drizzle-orm';
import { db, pool } from '../src/db/client.js';
import { pollsters } from '../src/db/schema.js';
import { POLLSTERS } from '../src/sources/polls/pollsters.js';
import { logger } from '../src/lib/logger.js';

// 1. Deactivate all existing
await db.execute(sql`UPDATE pollsters SET active = false`);

// 2. Upsert + activate the ones in the canonical list
let upserted = 0;
for (const p of POLLSTERS) {
  await db
    .insert(pollsters)
    .values({
      slug: p.slug,
      displayName: p.displayName,
      xHandle: p.xHandle,
      notes: p.notes ?? null,
      active: true,
    })
    .onConflictDoUpdate({
      target: pollsters.slug,
      set: {
        displayName: p.displayName,
        xHandle: p.xHandle,
        notes: p.notes ?? null,
        active: true,
      },
    });
  upserted++;
}

// Reportar el delta para visibilidad
const r = await db.execute(sql`
  SELECT COUNT(*) FILTER (WHERE active) AS active,
         COUNT(*) FILTER (WHERE NOT active) AS inactive,
         COUNT(*) AS total
  FROM pollsters
`);
const row = r.rows[0] as { active: number; inactive: number; total: number };
logger.info(
  { upserted, ...row },
  'pollsters: seed complete',
);
await pool.end();
