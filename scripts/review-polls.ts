/**
 * CLI para inspeccionar y aprobar/rechazar polls en review queue.
 * Uso:
 *   pnpm tsx scripts/review-polls.ts list
 *   pnpm tsx scripts/review-polls.ts approve <id>
 *   pnpm tsx scripts/review-polls.ts reject <id>
 */
import { eq } from 'drizzle-orm';
import { db, pool } from '../src/db/client.js';
import { polls, pollsters } from '../src/db/schema.js';

const cmd = process.argv[2];
const arg = process.argv[3];

async function list(): Promise<void> {
  const rows = await db
    .select({
      id: polls.id,
      pollster: pollsters.slug,
      confidence: polls.confidence,
      status: polls.status,
      sourceUrl: polls.sourceUrl,
      results: polls.results,
      sampleSize: polls.sampleSize,
      ingestedAt: polls.ingestedAt,
    })
    .from(polls)
    .leftJoin(pollsters, eq(pollsters.id, polls.pollsterId))
    .where(eq(polls.status, 'pending_review'))
    .orderBy(polls.ingestedAt);

  console.log(`\n${rows.length} polls in pending_review:\n`);
  for (const r of rows) {
    console.log(`#${r.id} [${r.confidence}] ${r.pollster ?? 'unknown'} @ ${r.ingestedAt.toISOString()}`);
    console.log(`  URL: ${r.sourceUrl}`);
    console.log(`  Sample: ${r.sampleSize ?? '?'}`);
    for (const it of r.results) {
      console.log(`    ${it.candidato.padEnd(20)} ${it.pct.toFixed(1)}%`);
    }
    console.log('');
  }
}

async function setStatus(id: number, status: 'approved' | 'rejected'): Promise<void> {
  const result = await db
    .update(polls)
    .set({ status, reviewedAt: new Date() })
    .where(eq(polls.id, id))
    .returning({ id: polls.id });
  if (result.length === 0) {
    console.error(`No poll with id ${id}`);
    process.exit(1);
  }
  console.log(`Poll #${id} → ${status}`);
}

try {
  if (cmd === 'list') await list();
  else if (cmd === 'approve' && arg) await setStatus(Number(arg), 'approved');
  else if (cmd === 'reject' && arg) await setStatus(Number(arg), 'rejected');
  else {
    console.error('Usage: review-polls.ts {list|approve <id>|reject <id>}');
    process.exit(1);
  }
} finally {
  await pool.end();
}
