/**
 * Dry-run del crossover watcher: corre la detección contra la DB real
 * pero NO emite eventos. Imprime los pares detectados.
 *
 * Run: pnpm tsx scripts/dry-run-crossover.ts
 */
import { sql } from 'drizzle-orm';
import { db } from '../src/db/client.js';

const MARKET_SLUG = 'argentina-presidential-election-winner';

const nowRows = await db.execute(sql`
  SELECT DISTINCT ON (candidate) candidate, (price::float * 100) AS pct
  FROM market_prices mp JOIN markets m ON m.id = mp.market_id
  WHERE m.slug = ${MARKET_SLUG}
  ORDER BY candidate, ts DESC
`);
const beforeRows = await db.execute(sql`
  SELECT DISTINCT ON (candidate) candidate, (price::float * 100) AS pct
  FROM market_prices mp JOIN markets m ON m.id = mp.market_id
  WHERE m.slug = ${MARKET_SLUG}
    AND ts <= NOW() - INTERVAL '24 hours'
  ORDER BY candidate, ts DESC
`);

function rankTop5(rows: Array<{ candidate: string; pct: number }>) {
  return rows
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 5)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

const top5Now = rankTop5(nowRows.rows as Array<{ candidate: string; pct: number }>);
const top5Before = rankTop5(beforeRows.rows as Array<{ candidate: string; pct: number }>);
const beforeMap = new Map(top5Before.map((r) => [r.candidate, r]));

console.log('\n=== TOP 5 AHORA ===');
top5Now.forEach((r) => console.log(`  ${r.rank}º  ${r.candidate.padEnd(28)} ${r.pct.toFixed(1)}%`));
console.log('\n=== TOP 5 HACE 24h ===');
top5Before.forEach((r) => console.log(`  ${r.rank}º  ${r.candidate.padEnd(28)} ${r.pct.toFixed(1)}%`));

const pairs: Array<{ passer: string; passed: string; rankBefore: number; rankNow: number; passerDelta: number; passedDelta: number }> = [];
for (const a of top5Now) {
  const aBefore = beforeMap.get(a.candidate);
  if (!aBefore) continue;
  for (const b of top5Now) {
    if (a.candidate === b.candidate) continue;
    const bBefore = beforeMap.get(b.candidate);
    if (!bBefore) continue;
    if (a.rank < b.rank && aBefore.rank > bBefore.rank) {
      pairs.push({
        passer: a.candidate,
        passed: b.candidate,
        rankBefore: aBefore.rank,
        rankNow: a.rank,
        passerDelta: a.pct - aBefore.pct,
        passedDelta: b.pct - bBefore.pct,
      });
    }
  }
}

console.log(`\n=== CROSSOVERS DETECTADOS (${pairs.length}) ===`);
if (pairs.length === 0) {
  console.log('  (ningún overtake en el top 5 vs hace 24h)');
} else {
  pairs.forEach((p) => {
    const sign = (x: number): string => (x >= 0 ? '+' : '');
    console.log(
      `  ${p.passer} (${p.rankBefore}º→${p.rankNow}º, ${sign(p.passerDelta)}${p.passerDelta.toFixed(1)}pp) pasa a ${p.passed} (${sign(p.passedDelta)}${p.passedDelta.toFixed(1)}pp)`,
    );
  });
}

process.exit(0);
