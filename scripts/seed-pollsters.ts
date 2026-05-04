/**
 * Seed idempotente. Inserta o actualiza cada pollster por slug.
 * Run: pnpm tsx scripts/seed-pollsters.ts
 */
import { db, pool } from '../src/db/client.js';
import { pollsters } from '../src/db/schema.js';
import { POLLSTERS } from '../src/sources/polls/pollsters.js';
import { logger } from '../src/lib/logger.js';

let upserted = 0;

for (const p of POLLSTERS) {
  await db
    .insert(pollsters)
    .values({
      slug: p.slug,
      displayName: p.displayName,
      xHandle: p.xHandle,
      notes: p.notes ?? null,
    })
    .onConflictDoUpdate({
      target: pollsters.slug,
      set: {
        displayName: p.displayName,
        xHandle: p.xHandle,
        notes: p.notes ?? null,
      },
    });
  upserted++;
}

logger.info({ upserted, total: POLLSTERS.length }, 'pollsters: seed complete');
await pool.end();
