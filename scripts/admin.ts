/**
 * CLI admin para bot_posts. Uso:
 *   pnpm tsx scripts/admin.ts list                    — drafts pending
 *   pnpm tsx scripts/admin.ts show <id>               — detalle
 *   pnpm tsx scripts/admin.ts approve <id>
 *   pnpm tsx scripts/admin.ts kill <id>
 *   pnpm tsx scripts/admin.ts publish-now <id>        — bypass soft-launch
 *   pnpm tsx scripts/admin.ts mode <shadow|soft|full>
 *   pnpm tsx scripts/admin.ts kill-switch <on|off>
 */
import { eq, desc } from 'drizzle-orm';
import { db, pool } from '../src/db/client.js';
import { botPosts, adminState } from '../src/db/schema.js';
import { approveDraft, killPost, schedulePost } from '../src/publish/transitions.js';

const cmd = process.argv[2];
const arg1 = process.argv[3];

async function list(): Promise<void> {
  const rows = await db
    .select({
      id: botPosts.id, shape: botPosts.shape, status: botPosts.status,
      caption: botPosts.caption, generatedAt: botPosts.generatedAt,
      candidateFocus: botPosts.candidateFocus,
    })
    .from(botPosts)
    .where(eq(botPosts.status, 'draft'))
    .orderBy(desc(botPosts.generatedAt))
    .limit(50);

  console.log(`\n${rows.length} drafts pending:\n`);
  for (const r of rows) {
    console.log(`#${r.id} [${r.shape}] ${r.candidateFocus ?? '-'} @ ${r.generatedAt.toISOString()}`);
    console.log(`  ${r.caption.slice(0, 100)}${r.caption.length > 100 ? '…' : ''}\n`);
  }
}

async function show(id: number): Promise<void> {
  const [r] = await db.select().from(botPosts).where(eq(botPosts.id, id));
  if (!r) { console.error(`No bot_post ${id}`); process.exit(1); }
  console.log(JSON.stringify(r, null, 2));
}

async function setMode(value: string): Promise<void> {
  if (!['shadow', 'soft', 'full'].includes(value)) {
    console.error('mode must be shadow|soft|full');
    process.exit(1);
  }
  await db.insert(adminState).values({ key: 'publish_mode', value })
    .onConflictDoUpdate({ target: adminState.key, set: { value, updatedAt: new Date() } });
  console.log(`mode → ${value}`);
}

async function setKillSwitch(value: string): Promise<void> {
  if (!['on', 'off'].includes(value)) {
    console.error('kill-switch must be on|off');
    process.exit(1);
  }
  const v = value === 'on' ? 'true' : 'false';
  await db.insert(adminState).values({ key: 'kill_switch', value: v })
    .onConflictDoUpdate({ target: adminState.key, set: { value: v, updatedAt: new Date() } });
  console.log(`kill_switch → ${v}`);
}

async function publishNow(id: number): Promise<void> {
  const [p] = await db.select().from(botPosts).where(eq(botPosts.id, id));
  if (!p) { console.error(`No bot_post ${id}`); process.exit(1); }
  if (p.status === 'draft') await approveDraft(id);
  if (p.status === 'approved' || p.status === 'draft') await schedulePost(id);
  console.log(`#${id} → scheduled (publisher worker lo enviará en próximo tick)`);
}

try {
  const id = arg1 ? Number(arg1) : NaN;
  switch (cmd) {
    case 'list': await list(); break;
    case 'show': await show(id); break;
    case 'approve': await approveDraft(id); console.log(`#${id} → approved`); break;
    case 'kill': await killPost(id); console.log(`#${id} → killed`); break;
    case 'publish-now': await publishNow(id); break;
    case 'mode': await setMode(arg1); break;
    case 'kill-switch': await setKillSwitch(arg1); break;
    default:
      console.error(`Usage: admin.ts {list|show|approve|kill|publish-now|mode|kill-switch} [arg]`);
      process.exit(1);
  }
} finally {
  await pool.end();
}
