# Política Bot — Fase 3: Trigger Engine + Content Generation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detectar eventos relevantes (movimientos de Polymarket, encuestas nuevas, noticias hot) y generar posts (cards visuales en estilo WIRED + captions con number guardrail) hacia la tabla `bot_posts` con estado `draft`. Sin publicar — eso es Fase 4.

**Architecture:** Watchers leen el estado actualizado del DB (market_prices, polls, news) y emiten eventos a la tabla `events`. Un trigger orchestrator consume eventos cumpliendo caps + cooldowns + quiet hours, llama a generadores de card (Satori → PNG) y caption (LLM Haiku + linter regex), y persiste el resultado en `bot_posts(status='draft', source_snapshot, llm_metadata)`. Generación on-demand sin sistema de mensajería externo.

**Tech Stack:** TypeScript, Drizzle, `satori` + `@resvg/resvg-js` para card rendering, Claude CLI transport para captions (mismo del Fase 1-2), Google Fonts bundleadas.

**Tiempo estimado:** 2-4 semanas a 8-10 hs/semana.

**Pre-requisitos:**
- Fase 2 completa y mergeada
- DB con datos: al menos `markets`, `market_prices`, `news` populados
- (Útil pero no bloqueante) handles correctos de pollsters cargados, para que `polls` tenga rows

---

## Estructura de archivos al final de la Fase 3

```
src/
├── lib/
│   ├── http.ts                    (sin cambios)
│   ├── env.ts                     (boot-time validations)
│   ├── logger.ts                  (sin cambios)
│   └── llm-json.ts                ★ nuevo (extractFirstJsonObject consolidado)
├── db/
│   ├── schema.ts                  (+ bot_posts + last_seen_tweet_id en pollsters)
│   └── migrations/0002_*.sql      ★ nueva
├── sources/
│   ├── polymarket/                (sin cambios)
│   ├── news/
│   │   └── tagger.ts              (usa lib/llm-json)
│   └── polls/
│       ├── classifier.ts          (usa lib/llm-json)
│       ├── extractor.ts           (usa lib/llm-json)
│       └── ingest.ts              (since_id checkpointing)
├── trigger/                       ★ nueva carpeta
│   ├── events.ts                  (helpers: emit, claim, mark)
│   ├── watchers/
│   │   ├── market-move.ts
│   │   ├── new-poll.ts
│   │   ├── hot-news.ts
│   │   └── morning-brief.ts       (cron-driven, no event)
│   ├── caps.ts                    (cooldowns + quiet hours + daily cap)
│   ├── orchestrator.ts            (consume events → generate post → insert bot_posts)
│   └── types.ts                   (event payload schemas)
├── render/                        ★ nueva carpeta
│   ├── fonts.ts                   (load + register Google Font sustitutos)
│   ├── tokens.ts                  (WIRED design tokens en TS)
│   ├── components/
│   │   ├── Ribbon.tsx             (header bar negro con kicker mono)
│   │   ├── Footer.tsx             (timestamp + source line)
│   │   └── BarChart.tsx           (chart simple para los 4 shapes)
│   ├── cards/
│   │   ├── morning-brief.tsx
│   │   ├── market-move.tsx
│   │   ├── new-poll.tsx
│   │   └── hot-news.tsx
│   └── compose.ts                 (data → JSX → SVG → PNG)
├── caption/                       ★ nueva carpeta
│   ├── prompts.ts                 (prompt template per shape)
│   ├── linter.ts                  (number guardrail regex)
│   ├── fallback.ts                (Bloomberg-style fallback)
│   └── generate.ts                (LLM call → linter → fallback)
└── workers/
    └── orchestrator.ts            (+ trigger orchestrator schedule)
public/
└── fonts/                         ★ binarios bundleados
    ├── PlayfairDisplay-Regular.ttf
    ├── Inter-Bold.ttf
    ├── JetBrainsMono-Regular.ttf
    └── Lora-Regular.ttf
storage/
└── cards/                         ★ runtime (gitignored)
    └── <bot_post_id>.png
tests/
├── trigger/
│   ├── caps.test.ts
│   ├── events.test.ts
│   └── watchers/
│       ├── market-move.test.ts
│       ├── new-poll.test.ts
│       └── hot-news.test.ts
├── render/
│   └── compose.test.ts
└── caption/
    └── linter.test.ts
```

---

## Bloque A — Hardening de Fase 2

### Task 1: Consolidar `extractFirstJsonObject` en helper compartido

Tres copias actuales: `news/tagger.ts`, `polls/classifier.ts`, `polls/extractor.ts`. Final reviewer Fase 2 lo flagueó como Important.

**Files:**
- Create: `src/lib/llm-json.ts`
- Modify: `src/sources/news/tagger.ts`
- Modify: `src/sources/polls/classifier.ts`
- Modify: `src/sources/polls/extractor.ts`
- Modify: `tests/sources/news/tagger.test.ts` (import path)

- [ ] **Step 1: Crear el helper consolidado**

```bash
cat > src/lib/llm-json.ts <<'EOF'
/**
 * Extrae el primer objeto JSON balanceado de la respuesta del LLM.
 * Tolera prosa antes/después y bloques ```json ... ``` con markdown.
 *
 * Si no encuentra `{` y `}` balanceados, lanza Error con el inicio del raw
 * para diagnóstico (truncado a 200 chars).
 */
export function extractFirstJsonObject(raw: string, contextHint = 'llm'): unknown {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`${contextHint}: no JSON in output: ${trimmed.slice(0, 200)}`);
  }
  return JSON.parse(trimmed.slice(start, end + 1));
}
EOF
```

- [ ] **Step 2: Reemplazar la copia local en news/tagger.ts**

Read `src/sources/news/tagger.ts`. Find and remove the local `extractJson` function definition (~10 lines at the bottom or middle of the file). Add `import { extractFirstJsonObject } from '../../lib/llm-json.js';` to the top imports. Replace internal call sites: `extractJson(raw)` → `extractFirstJsonObject(raw, 'tagger')`.

Note: The function was previously `export function extractJson(...)` (Fase 2 made it exported for tests). Update `tests/sources/news/tagger.test.ts` to import from the new location:
```ts
import { extractFirstJsonObject as extractJson } from '../../../src/lib/llm-json.js';
```

(The alias `as extractJson` keeps the existing test code unchanged.)

- [ ] **Step 3: Idem en polls/classifier.ts**

Replace the local `extractFirstJsonObject` (lines ~52-63) with import:
```ts
import { extractFirstJsonObject } from '../../lib/llm-json.js';
```

Update internal call: `extractFirstJsonObject(raw)` → `extractFirstJsonObject(raw, 'classifier')`.

- [ ] **Step 4: Idem en polls/extractor.ts**

Same pattern. Update internal call: `extractFirstJsonObject(raw, 'extractor')`.

- [ ] **Step 5: Run tests**

```bash
pnpm typecheck && pnpm test
```

Expected: 26 tests pass (no behavior change). typecheck limpio.

- [ ] **Step 6: Commit**

```bash
git add src/lib/llm-json.ts src/sources/news/tagger.ts src/sources/polls/classifier.ts src/sources/polls/extractor.ts tests/sources/news/tagger.test.ts
git commit -m "$(cat <<'COMMIT'
refactor: consolidar extractFirstJsonObject en src/lib/llm-json.ts

Tres copias verbatim en tagger/classifier/extractor consolidadas en
un solo helper. Cada caller pasa un contextHint para que el error
diagnostique de qué llamada vino. Final reviewer de Fase 2 flagueó
esta duplicación como Important.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

### Task 2: `since_id` checkpointing para polls ingest

Actualmente cada cron tick re-fetchea los mismos 10 tweets/cuenta y desperdicia ~90% de calls al classifier. Final reviewer Fase 2 lo flagueó como Important.

**Files:**
- Modify: `src/db/schema.ts` (agregar `lastSeenTweetId` en pollsters)
- Create: `src/db/migrations/0002_*.sql` (auto)
- Modify: `src/sources/polls/ingest.ts` (usar + actualizar lastSeenTweetId)

- [ ] **Step 1: Agregar columna al schema**

Read `src/db/schema.ts`. Find the pollsters table. Add a new column:
```ts
lastSeenTweetId: text('last_seen_tweet_id'),
```

Place it after `xUserId`. Final pollsters block:
```ts
export const pollsters = pgTable('pollsters', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  displayName: text('display_name').notNull(),
  xHandle: text('x_handle').notNull().unique(),
  xUserId: text('x_user_id'),
  lastSeenTweetId: text('last_seen_tweet_id'),
  active: boolean('active').notNull().default(true),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
```

- [ ] **Step 2: Generar y aplicar migración**

```bash
pnpm db:generate
pnpm db:migrate
docker exec politica-pg psql -U politica -d politica -c "\d pollsters"
```

Expected: nueva columna `last_seen_tweet_id text` (nullable).

- [ ] **Step 3: Modificar ingest para usar y actualizar el checkpoint**

Read `src/sources/polls/ingest.ts`. Modify the loop to:
1. Pass `sinceId: p.lastSeenTweetId ?? undefined` to `getUserTimeline`.
2. After a successful timeline fetch, find the highest tweet id in the returned page (lexicographic comparison works for X snowflake IDs since they're monotonic) and update `pollsters.lastSeenTweetId` to it.

Replace the body of the per-pollster try block:

```ts
    try {
      // Resolve x_user_id si no está cacheado
      let xUserId = p.xUserId;
      if (!xUserId) {
        const user = await getUserByUsername(p.xHandle);
        xUserId = user.id;
        await db.update(pollsters).set({ xUserId }).where(eq(pollsters.id, p.id));
        logger.info({ pollster: p.slug, handle: p.xHandle, xUserId }, 'polls: resolved x_user_id');
      }

      const page = await getUserTimeline(xUserId, {
        maxResults: TWEETS_PER_POLLSTER,
        sinceId: p.lastSeenTweetId ?? undefined,
      });
      stats.tweetsSeen += page.tweets.length;

      // Update checkpoint to the highest tweet id we saw (X snowflake ids are
      // lexicographically ordered with numeric strings of equal length)
      if (page.tweets.length > 0) {
        const maxId = page.tweets.reduce(
          (acc, t) => (t.id > acc ? t.id : acc),
          page.tweets[0].id,
        );
        if (!p.lastSeenTweetId || maxId > p.lastSeenTweetId) {
          await db.update(pollsters).set({ lastSeenTweetId: maxId }).where(eq(pollsters.id, p.id));
        }
      }

      for (const tweet of page.tweets) {
        const mediaKeys = tweet.attachments?.media_keys ?? [];
        const attached = mediaKeys
          .map((k) => page.media.get(k))
          .filter((m): m is NonNullable<typeof m> => !!m);

        const result: ProcessTweetResult = await processTweet({
          pollsterDbId: p.id,
          tweet,
          attachedMedia: attached,
        });

        if (result.status === 'inserted') {
          stats.inserted++;
          logger.info({ pollster: p.slug, pollId: result.pollId, tweetId: tweet.id }, 'polls: inserted');
        } else {
          stats.bySkipReason[result.status] = (stats.bySkipReason[result.status] ?? 0) + 1;
        }
      }
    } catch (err) {
      stats.pollsterErrors++;
      logger.warn({ pollster: p.slug, handle: p.xHandle, err: (err as Error).message }, 'polls: pollster ingest failed');
    }
```

- [ ] **Step 4: Smoke test (idempotency)**

Tools: assume `.env` already has the bearer token from Fase 2.

```bash
# Run once — should ingest some tweets and update checkpoint
pnpm tsx scripts/smoke-polls-ingest.ts

# Run again immediately — should fetch ZERO new tweets (since_id matches latest)
pnpm tsx scripts/smoke-polls-ingest.ts
```

Expected: second run shows `tweetsSeen: 0` for the working pollsters (their `lastSeenTweetId` now matches their latest tweet).

```bash
docker exec politica-pg psql -U politica -d politica -c "
  SELECT slug, x_user_id IS NOT NULL AS resolved, last_seen_tweet_id FROM pollsters ORDER BY id;
"
```

- [ ] **Step 5: typecheck + tests**

```bash
pnpm typecheck && pnpm test
```

Expected: 26 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts src/db/migrations/ src/sources/polls/ingest.ts
git commit -m "$(cat <<'COMMIT'
feat(polls): since_id checkpointing en ingest

Nueva columna pollsters.last_seen_tweet_id. El ingest worker la usa
para no re-fetchear tweets ya vistos y la actualiza al máximo id de
cada page. Final reviewer de Fase 2 estimó ~90% de calls desperdiciados
sin esto.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

### Task 3: Boot-time validation de env vars críticas

Actualmente el worker arranca aunque falte `X_API_BEARER_TOKEN` y falla 6 horas después en el primer cron tick.

**Files:**
- Modify: `src/workers/orchestrator.ts` (agregar boot-time check con warning explícito)

- [ ] **Step 1: Agregar function de validación al orchestrator**

Read `src/workers/orchestrator.ts`. Inside `main()`, AFTER the `logger.info('orchestrator: starting')` and BEFORE the run-once-at-boot ingests, add:

```ts
  // Boot-time validation — warn early on missing optional secrets
  // que se vuelven obligatorios en runtime cuando hay pollsters activos.
  if (!env.X_API_BEARER_TOKEN) {
    const activePollsters = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(pollsters)
      .where(eq(pollsters.active, true));
    const count = activePollsters[0]?.count ?? 0;
    if (count > 0) {
      logger.warn(
        { activePollsters: count },
        'orchestrator: X_API_BEARER_TOKEN missing — polls ingest will fail at next 6h tick',
      );
    }
  }
```

Add to imports at top of file:
```ts
import { sql, eq } from 'drizzle-orm';
import { pollsters } from '../db/schema.js';
```

(`db`, `env` should already be imported.)

- [ ] **Step 2: Smoke test (with token still present)**

```bash
pnpm worker > /tmp/boot-validation.log 2>&1 &
WORKER_PID=$!
sleep 5
kill -INT $WORKER_PID
sleep 2
grep -E "X_API_BEARER_TOKEN|schedules registered" /tmp/boot-validation.log
```

Expected: NO warning about token (since `.env` has it). Schedules registered as before.

- [ ] **Step 3: Smoke test sin token (simulando primer arranque sin config)**

```bash
# Backup .env, then run without token
mv .env .env.real
cp .env.example .env
# .env.example has X_API_BEARER_TOKEN= (empty), which Zod treats as undefined for optional()
pnpm worker > /tmp/boot-no-token.log 2>&1 &
WORKER_PID=$!
sleep 5
kill -INT $WORKER_PID
sleep 2
grep "X_API_BEARER_TOKEN" /tmp/boot-no-token.log
# Restore real .env
mv .env.real .env
```

Expected: warning visible: "X_API_BEARER_TOKEN missing — polls ingest will fail at next 6h tick".

- [ ] **Step 4: typecheck + tests**

```bash
pnpm typecheck && pnpm test
```

Expected: 26 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/workers/orchestrator.ts
git commit -m "$(cat <<'COMMIT'
feat(worker): boot-time validation de X_API_BEARER_TOKEN

Si hay pollsters activos en DB pero el token no está set, loguear
warning explícito al boot en vez de fallar 6h después en el primer
cron tick. Final reviewer Fase 2 lo flagueó como Important.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Bloque B — Schema y events helpers

### Task 4: Tabla `bot_posts` + enum + migración

**Files:**
- Modify: `src/db/schema.ts` (+ bot_posts table + enums)
- Create: `src/db/migrations/0003_*.sql` (auto)

- [ ] **Step 1: Agregar al schema (al final del archivo)**

Read `src/db/schema.ts`. Append:

```ts
// ──────────────────────────────────────────────────────────────────
// Bot posts (cards + captions generadas por el trigger engine)
// ──────────────────────────────────────────────────────────────────

export const botPostShapeEnum = pgEnum('bot_post_shape', [
  'morning_brief',
  'market_move',
  'new_poll',
  'hot_news',
]);

export const botPostStatusEnum = pgEnum('bot_post_status', [
  'draft',          // generado, no publicado
  'scheduled',      // approved, esperando ventana de publicación
  'published',      // ya en X
  'killed',         // descartado (fail del linter, kill switch, etc.)
]);

export const botPosts = pgTable(
  'bot_posts',
  {
    id: serial('id').primaryKey(),
    shape: botPostShapeEnum('shape').notNull(),
    status: botPostStatusEnum('status').notNull().default('draft'),
    caption: text('caption').notNull(),
    cardPath: text('card_path').notNull(),               // path en filesystem (relative)
    sourceSnapshot: jsonb('source_snapshot').notNull(),  // copia de los datos source
    llmMetadata: jsonb('llm_metadata').notNull(),        // { prompt, raw, lintAttempts, fallbackUsed }
    eventId: integer('event_id').references(() => events.id), // null si es morning brief
    candidateFocus: text('candidate_focus'),             // para cooldowns (ej "Milei")
    generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    xPostId: text('x_post_id'),
    metrics: jsonb('metrics'),                           // populated post-publish (likes, RT)
  },
  (t) => ({
    statusIdx: index('bot_posts_status_idx').on(t.status, t.generatedAt),
    candidateIdx: index('bot_posts_candidate_idx').on(t.candidateFocus, t.generatedAt),
    eventIdx: index('bot_posts_event_idx').on(t.eventId),
  }),
);
```

- [ ] **Step 2: Generar y aplicar migración**

```bash
pnpm db:generate
pnpm db:migrate
docker exec politica-pg psql -U politica -d politica -c "\d bot_posts"
```

Expected: tabla con todas las columnas y enums correctos.

- [ ] **Step 3: typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/db/schema.ts src/db/migrations/
git commit -m "$(cat <<'COMMIT'
feat(db): tabla bot_posts + enums shape/status

bot_posts almacena cards + captions generados. shape (morning_brief|
market_move|new_poll|hot_news) y status (draft|scheduled|published|
killed). source_snapshot + llm_metadata son audit log inmutable;
candidate_focus alimenta cooldowns por candidato; event_id es FK
opcional a events.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

### Task 5: Event helpers (emit / claim / mark)

**Files:**
- Create: `src/trigger/types.ts` (event payload schemas)
- Create: `src/trigger/events.ts` (helpers)
- Create: `tests/trigger/events.test.ts`

- [ ] **Step 1: Definir tipos**

```bash
mkdir -p src/trigger
cat > src/trigger/types.ts <<'EOF'
import { z } from 'zod';

// ─── Event payload schemas (uno por tipo) ──────────────────────────

export const marketMoveEventSchema = z.object({
  marketId: z.string(),
  candidate: z.string(),
  priceNow: z.number(),
  priceThen: z.number(),
  deltaPct: z.number(),
  windowHours: z.number(),
});
export type MarketMoveEvent = z.infer<typeof marketMoveEventSchema>;

export const newPollEventSchema = z.object({
  pollId: z.number().int().positive(),
  pollsterSlug: z.string(),
  topCandidate: z.string(),
  topCandidatePct: z.number(),
});
export type NewPollEvent = z.infer<typeof newPollEventSchema>;

export const hotNewsEventSchema = z.object({
  newsId: z.number().int().positive(),
  source: z.string(),
  headline: z.string(),
  candidatesMentioned: z.array(z.string()),
  relevanceScore: z.number(),
  correlatedMove: z.object({
    candidate: z.string(),
    deltaPct: z.number(),
  }).nullable(),
});
export type HotNewsEvent = z.infer<typeof hotNewsEventSchema>;

export const EVENT_TYPES = ['MARKET_MOVE', 'NEW_POLL', 'HOT_NEWS'] as const;
export type EventType = typeof EVENT_TYPES[number];
EOF
```

- [ ] **Step 2: Test para events helpers (failing)**

```bash
mkdir -p tests/trigger
cat > tests/trigger/events.test.ts <<'EOF'
import { describe, it, expect, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../../src/db/client.js';
import { events } from '../../src/db/schema.js';
import { emitEvent, claimNextPendingEvent, markEventProcessed } from '../../src/trigger/events.js';

beforeEach(async () => {
  await db.execute(sql`DELETE FROM events WHERE type LIKE 'TEST_%'`);
});

describe('emitEvent', () => {
  it('inserts a new pending event', async () => {
    const id = await emitEvent('TEST_X', { foo: 'bar' });
    expect(id).toBeGreaterThan(0);
    const rows = await db.select().from(events).where(sql`${events.id} = ${id}`);
    expect(rows[0]?.status).toBe('pending');
    expect((rows[0]?.payload as { foo?: string }).foo).toBe('bar');
  });
});

describe('claimNextPendingEvent', () => {
  it('returns the oldest pending event and marks it as processing', async () => {
    const a = await emitEvent('TEST_A', { v: 1 });
    const b = await emitEvent('TEST_B', { v: 2 });
    const claimed = await claimNextPendingEvent();
    expect(claimed?.id).toBe(a);
    expect(claimed?.type).toBe('TEST_A');
  });

  it('returns null when no pending events', async () => {
    const result = await claimNextPendingEvent();
    expect(result).toBeNull();
  });
});

describe('markEventProcessed', () => {
  it('moves status from processing to processed', async () => {
    const id = await emitEvent('TEST_DONE', {});
    await claimNextPendingEvent();
    await markEventProcessed(id);
    const rows = await db.select().from(events).where(sql`${events.id} = ${id}`);
    expect(rows[0]?.status).toBe('processed');
    expect(rows[0]?.processedAt).not.toBeNull();
  });
});
EOF
```

- [ ] **Step 3: Run RED**

```bash
pnpm test tests/trigger/events.test.ts
```

Expected: FAIL "Cannot find module".

- [ ] **Step 4: Implementar events.ts**

```bash
cat > src/trigger/events.ts <<'EOF'
import { sql, asc } from 'drizzle-orm';
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
 * Usa UPDATE ... RETURNING con FOR UPDATE SKIP LOCKED-style via single statement,
 * para que múltiples workers no se pisen.
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
EOF
```

- [ ] **Step 5: Run GREEN**

```bash
pnpm test tests/trigger/events.test.ts
```

Expected: 3 tests passed.

- [ ] **Step 6: Commit**

```bash
git add src/trigger/types.ts src/trigger/events.ts tests/trigger/events.test.ts
git commit -m "$(cat <<'COMMIT'
feat(trigger): event queue helpers (emit/claim/mark)

claimNextPendingEvent usa FOR UPDATE SKIP LOCKED para evitar
double-processing si múltiples workers corren. types.ts define
zod schemas por tipo de evento.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Bloque C — Watchers

### Task 6: Market move watcher

Usa `detectMoves` (ya existe) y emite events `MARKET_MOVE` para cada movimiento detectado.

**Files:**
- Create: `src/trigger/watchers/market-move.ts`
- Create: `tests/trigger/watchers/market-move.test.ts`

- [ ] **Step 1: Test failing**

```bash
mkdir -p tests/trigger/watchers
cat > tests/trigger/watchers/market-move.test.ts <<'EOF'
import { describe, it, expect, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../../../src/db/client.js';
import { markets, marketPrices, events } from '../../../src/db/schema.js';
import { runMarketMoveWatcher } from '../../../src/trigger/watchers/market-move.js';

const TEST_MARKET_ID = 'test-watcher-market';

beforeEach(async () => {
  await db.execute(sql`DELETE FROM market_prices WHERE market_id = ${TEST_MARKET_ID}`);
  await db.execute(sql`DELETE FROM markets WHERE id = ${TEST_MARKET_ID}`);
  await db.execute(sql`DELETE FROM events WHERE type = 'MARKET_MOVE' AND payload->>'marketId' = ${TEST_MARKET_ID}`);
  await db.insert(markets).values({
    id: TEST_MARKET_ID,
    slug: 'test',
    question: 'Test',
    candidates: ['Alice'],
    status: 'open',
  });
  const sixHoursAgo = new Date(Date.now() - 6 * 3600 * 1000);
  await db.insert(marketPrices).values([
    { marketId: TEST_MARKET_ID, candidate: 'Alice', price: '0.4000', ts: sixHoursAgo },
    { marketId: TEST_MARKET_ID, candidate: 'Alice', price: '0.5000', ts: new Date() },
  ]);
});

describe('runMarketMoveWatcher', () => {
  it('emits a MARKET_MOVE event for the detected move', async () => {
    const stats = await runMarketMoveWatcher({ thresholdPct: 2, windowHours: 6 });
    expect(stats.emitted).toBe(1);
    const rows = await db.execute(sql`
      SELECT type, payload FROM events
      WHERE type = 'MARKET_MOVE' AND payload->>'marketId' = ${TEST_MARKET_ID}
    `);
    expect(rows.rows.length).toBe(1);
  });

  it('is idempotent — re-running does not re-emit if no new prices arrive', async () => {
    await runMarketMoveWatcher({ thresholdPct: 2, windowHours: 6 });
    const stats2 = await runMarketMoveWatcher({ thresholdPct: 2, windowHours: 6 });
    expect(stats2.emitted).toBe(0);
  });
});
EOF
```

- [ ] **Step 2: Run RED**

```bash
pnpm test tests/trigger/watchers/market-move.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement watcher**

```bash
mkdir -p src/trigger/watchers
cat > src/trigger/watchers/market-move.ts <<'EOF'
import { sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import { detectMoves } from '../../sources/polymarket/moves.js';
import { emitEvent } from '../events.js';
import type { MarketMoveEvent } from '../types.js';

export interface WatcherStats {
  detected: number;
  emitted: number;
  dedupedAlreadyEmitted: number;
}

/**
 * Detecta movimientos vía detectMoves() y emite events MARKET_MOVE.
 * Dedupes: si ya hay un MARKET_MOVE event en últimas N horas para el mismo
 * (marketId, candidate), no emitir uno nuevo (el orchestrator decide cooldowns).
 */
export async function runMarketMoveWatcher(opts: {
  thresholdPct: number;
  windowHours: number;
  dedupeHours?: number;
}): Promise<WatcherStats> {
  const { thresholdPct, windowHours } = opts;
  const dedupeHours = opts.dedupeHours ?? 4;
  const moves = await detectMoves({ thresholdPct, windowHours });

  const stats: WatcherStats = { detected: moves.length, emitted: 0, dedupedAlreadyEmitted: 0 };

  for (const move of moves) {
    // Dedupe: ¿ya emitimos un evento similar en últimas N horas?
    const existing = await db.execute(sql`
      SELECT 1 FROM events
      WHERE type = 'MARKET_MOVE'
        AND payload->>'marketId' = ${move.marketId}
        AND payload->>'candidate' = ${move.candidate}
        AND created_at > NOW() - (${dedupeHours} || ' hours')::interval
      LIMIT 1
    `);
    if (existing.rows.length > 0) {
      stats.dedupedAlreadyEmitted++;
      continue;
    }

    const payload: MarketMoveEvent = {
      marketId: move.marketId,
      candidate: move.candidate,
      priceNow: move.priceNow,
      priceThen: move.priceThen,
      deltaPct: move.deltaPct,
      windowHours: move.windowHours,
    };
    await emitEvent('MARKET_MOVE', payload);
    stats.emitted++;
    logger.info({ ...payload }, 'watcher: emitted MARKET_MOVE');
  }
  return stats;
}
EOF
```

- [ ] **Step 4: Run GREEN**

```bash
pnpm test tests/trigger/watchers/market-move.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/trigger/watchers/market-move.ts tests/trigger/watchers/market-move.test.ts
git commit -m "$(cat <<'COMMIT'
feat(trigger): market-move watcher

Llama detectMoves(), filtra por dedupe window (4h por defecto contra
events) y emite MARKET_MOVE events. Dedupe es separado del cooldown
del orchestrator — esto solo evita double-emit, no es policy.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

### Task 7: New poll watcher

Detecta polls que pasaron a `approved` o `auto_approved` (es decir, que un humano aprobó o el sistema confió) y emite `NEW_POLL`.

**Files:**
- Create: `src/trigger/watchers/new-poll.ts`
- Create: `tests/trigger/watchers/new-poll.test.ts`

- [ ] **Step 1: Test failing**

```bash
cat > tests/trigger/watchers/new-poll.test.ts <<'EOF'
import { describe, it, expect, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../../../src/db/client.js';
import { polls, pollsters, events } from '../../../src/db/schema.js';
import { runNewPollWatcher } from '../../../src/trigger/watchers/new-poll.js';

const TEST_SLUG = 'test_pollster_npw';

beforeEach(async () => {
  await db.execute(sql`DELETE FROM events WHERE type = 'NEW_POLL'`);
  await db.execute(sql`DELETE FROM polls WHERE source_tweet_id LIKE 'test-npw-%'`);
  await db.execute(sql`DELETE FROM pollsters WHERE slug = ${TEST_SLUG}`);
  await db.insert(pollsters).values({ slug: TEST_SLUG, displayName: 'Test', xHandle: 'testhandle_npw' });
});

describe('runNewPollWatcher', () => {
  it('emits NEW_POLL for approved polls only', async () => {
    const [pollster] = await db.select().from(pollsters).where(sql`slug = ${TEST_SLUG}`);
    await db.insert(polls).values([
      {
        pollsterId: pollster.id,
        sourceUrl: 'https://x.com/i/status/test-npw-1',
        sourceTweetId: 'test-npw-1',
        results: [{ candidato: 'Milei', pct: 45 }, { candidato: 'Kicillof', pct: 28 }],
        confidence: 'alto',
        status: 'approved',
      },
      {
        pollsterId: pollster.id,
        sourceUrl: 'https://x.com/i/status/test-npw-2',
        sourceTweetId: 'test-npw-2',
        results: [{ candidato: 'Milei', pct: 47 }],
        confidence: 'alto',
        status: 'pending_review', // no debería emitir
      },
    ]);

    const stats = await runNewPollWatcher();
    expect(stats.emitted).toBe(1);
    const rows = await db.execute(sql`SELECT * FROM events WHERE type = 'NEW_POLL'`);
    expect(rows.rows.length).toBe(1);
  });

  it('is idempotent — same approved poll does not re-emit', async () => {
    const [pollster] = await db.select().from(pollsters).where(sql`slug = ${TEST_SLUG}`);
    await db.insert(polls).values({
      pollsterId: pollster.id,
      sourceUrl: 'https://x.com/i/status/test-npw-3',
      sourceTweetId: 'test-npw-3',
      results: [{ candidato: 'Milei', pct: 45 }, { candidato: 'Kicillof', pct: 28 }],
      confidence: 'alto',
      status: 'auto_approved',
    });
    await runNewPollWatcher();
    const second = await runNewPollWatcher();
    expect(second.emitted).toBe(0);
  });
});
EOF
```

- [ ] **Step 2: Run RED**

```bash
pnpm test tests/trigger/watchers/new-poll.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement watcher**

```bash
cat > src/trigger/watchers/new-poll.ts <<'EOF'
import { sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import { emitEvent } from '../events.js';
import type { NewPollEvent } from '../types.js';

export interface WatcherStats {
  candidates: number;
  emitted: number;
  dedupedAlreadyEmitted: number;
}

/**
 * Detecta polls con status approved/auto_approved que aún no han sido
 * convertidas a un NEW_POLL event. Idempotente vía LEFT JOIN contra events.
 */
export async function runNewPollWatcher(): Promise<WatcherStats> {
  // Polls aprobadas en últimas 7 días que no tienen evento NEW_POLL
  const candidates = await db.execute(sql`
    SELECT p.id, p.results, ps.slug AS pollster_slug
    FROM polls p
    JOIN pollsters ps ON ps.id = p.pollster_id
    LEFT JOIN events e ON e.type = 'NEW_POLL'
                       AND (e.payload->>'pollId')::int = p.id
    WHERE p.status IN ('approved', 'auto_approved')
      AND p.ingested_at > NOW() - INTERVAL '7 days'
      AND e.id IS NULL
  `);

  const stats: WatcherStats = {
    candidates: candidates.rows.length,
    emitted: 0,
    dedupedAlreadyEmitted: 0,
  };

  for (const row of candidates.rows as Array<{ id: number; results: unknown; pollster_slug: string }>) {
    const results = row.results as Array<{ candidato: string; pct: number }>;
    if (!results.length) continue;
    // Top candidate = mayor pct
    const top = results.reduce((acc, r) => (r.pct > acc.pct ? r : acc), results[0]);
    const payload: NewPollEvent = {
      pollId: row.id,
      pollsterSlug: row.pollster_slug,
      topCandidate: top.candidato,
      topCandidatePct: top.pct,
    };
    await emitEvent('NEW_POLL', payload);
    stats.emitted++;
    logger.info({ ...payload }, 'watcher: emitted NEW_POLL');
  }
  return stats;
}
EOF
```

- [ ] **Step 4: Run GREEN**

```bash
pnpm test tests/trigger/watchers/new-poll.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/trigger/watchers/new-poll.ts tests/trigger/watchers/new-poll.test.ts
git commit -m "$(cat <<'COMMIT'
feat(trigger): new-poll watcher

Detecta polls approved/auto_approved en últimos 7 días que aún no
generaron evento. LEFT JOIN contra events garantiza idempotencia
sin necesidad de tabla auxiliar.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

### Task 8: Hot news watcher

Detecta noticias high-relevance + candidato mencionado que correlacionan con un movimiento de Polymarket reciente.

**Files:**
- Create: `src/trigger/watchers/hot-news.ts`
- Create: `tests/trigger/watchers/hot-news.test.ts`

- [ ] **Step 1: Test failing**

```bash
cat > tests/trigger/watchers/hot-news.test.ts <<'EOF'
import { describe, it, expect, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../../../src/db/client.js';
import { news, events } from '../../../src/db/schema.js';
import { runHotNewsWatcher } from '../../../src/trigger/watchers/hot-news.js';

beforeEach(async () => {
  await db.execute(sql`DELETE FROM events WHERE type = 'HOT_NEWS'`);
  await db.execute(sql`DELETE FROM news WHERE url LIKE 'https://test.example/hnw-%'`);
});

describe('runHotNewsWatcher', () => {
  it('emits HOT_NEWS only for high relevance + candidate mentioned', async () => {
    await db.insert(news).values([
      {
        source: 'test',
        url: 'https://test.example/hnw-1',
        headline: 'Milei pivotó en política exterior',
        publishedAt: new Date(),
        candidatesMentioned: ['Milei'],
        category: 'gobierno',
        relevanceScore: '0.85',
        taggedAt: new Date(),
      },
      {
        source: 'test',
        url: 'https://test.example/hnw-2',
        headline: 'Color: chocolate del día',
        publishedAt: new Date(),
        candidatesMentioned: [],
        category: 'otro',
        relevanceScore: '0.20',
        taggedAt: new Date(),
      },
      {
        source: 'test',
        url: 'https://test.example/hnw-3',
        headline: 'Análisis del mercado financiero',
        publishedAt: new Date(),
        candidatesMentioned: [],
        category: 'economia',
        relevanceScore: '0.85', // alto pero sin candidato
        taggedAt: new Date(),
      },
    ]);

    const stats = await runHotNewsWatcher({ relevanceThreshold: 0.7 });
    expect(stats.emitted).toBe(1);
  });

  it('is idempotent — same article does not re-emit', async () => {
    await db.insert(news).values({
      source: 'test',
      url: 'https://test.example/hnw-4',
      headline: 'Milei: noticia X',
      publishedAt: new Date(),
      candidatesMentioned: ['Milei'],
      category: 'gobierno',
      relevanceScore: '0.90',
      taggedAt: new Date(),
    });
    await runHotNewsWatcher({ relevanceThreshold: 0.7 });
    const second = await runHotNewsWatcher({ relevanceThreshold: 0.7 });
    expect(second.emitted).toBe(0);
  });
});
EOF
```

- [ ] **Step 2: Run RED**

```bash
pnpm test tests/trigger/watchers/hot-news.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement watcher**

```bash
cat > src/trigger/watchers/hot-news.ts <<'EOF'
import { sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import { emitEvent } from '../events.js';
import type { HotNewsEvent } from '../types.js';

export interface WatcherStats {
  candidates: number;
  emitted: number;
}

/**
 * Detecta noticias relevanceScore > threshold + al menos un candidato top
 * mencionado, que aún no generaron evento. Si en las últimas 24h hubo un
 * movimiento de Polymarket >2% para alguno de esos candidatos, lo
 * adjuntamos como `correlatedMove`.
 */
export async function runHotNewsWatcher(opts: {
  relevanceThreshold: number;
}): Promise<WatcherStats> {
  const { relevanceThreshold } = opts;
  const threshold = relevanceThreshold.toFixed(2);
  const candidates = await db.execute(sql`
    SELECT n.id, n.source, n.headline, n.candidates_mentioned AS candidates_mentioned,
           n.relevance_score::float AS relevance_score
    FROM news n
    LEFT JOIN events e ON e.type = 'HOT_NEWS'
                       AND (e.payload->>'newsId')::int = n.id
    WHERE n.tagged_at IS NOT NULL
      AND n.relevance_score IS NOT NULL
      AND n.relevance_score >= ${threshold}::numeric
      AND jsonb_array_length(n.candidates_mentioned) > 0
      AND n.published_at > NOW() - INTERVAL '48 hours'
      AND e.id IS NULL
  `);

  const stats: WatcherStats = { candidates: candidates.rows.length, emitted: 0 };

  for (const row of candidates.rows as Array<{
    id: number;
    source: string;
    headline: string;
    candidates_mentioned: string[];
    relevance_score: number;
  }>) {
    const candidates = row.candidates_mentioned ?? [];
    if (!candidates.length) continue;

    // Buscar correlación con un market move reciente (24h) para el primer candidato listado
    const corr = await db.execute(sql`
      SELECT candidate, ((latest.price - earlier.price) * 100)::float AS delta_pct
      FROM (
        SELECT DISTINCT ON (candidate) candidate, price::float AS price
        FROM market_prices
        WHERE candidate = ANY(${candidates})
        ORDER BY candidate, ts DESC
      ) latest
      JOIN (
        SELECT DISTINCT ON (candidate) candidate, price::float AS price
        FROM market_prices
        WHERE candidate = ANY(${candidates})
          AND ts <= NOW() - INTERVAL '24 hours'
        ORDER BY candidate, ts DESC
      ) earlier USING (candidate)
      WHERE ABS(latest.price - earlier.price) * 100 >= 2
      LIMIT 1
    `);

    const correlatedMove = corr.rows.length
      ? {
          candidate: (corr.rows[0] as { candidate: string }).candidate,
          deltaPct: (corr.rows[0] as { delta_pct: number }).delta_pct,
        }
      : null;

    const payload: HotNewsEvent = {
      newsId: row.id,
      source: row.source,
      headline: row.headline,
      candidatesMentioned: candidates,
      relevanceScore: row.relevance_score,
      correlatedMove,
    };
    await emitEvent('HOT_NEWS', payload);
    stats.emitted++;
    logger.info({ newsId: row.id, source: row.source, hasCorrelation: !!correlatedMove }, 'watcher: emitted HOT_NEWS');
  }
  return stats;
}
EOF
```

- [ ] **Step 4: Run GREEN**

```bash
pnpm test tests/trigger/watchers/hot-news.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/trigger/watchers/hot-news.ts tests/trigger/watchers/hot-news.test.ts
git commit -m "$(cat <<'COMMIT'
feat(trigger): hot-news watcher

Detecta noticias high-relevance + candidato top mencionado, opcional-
mente correlacionando con movimientos de Polymarket en últimas 24h.
LEFT JOIN contra events para idempotencia. Window de 48h para no
emitir noticias viejas que recién taggea el LLM.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Bloque D — Card rendering

### Task 9: Setup Satori + fonts + tokens

**Files:**
- Modify: `package.json` (agregar satori + @resvg/resvg-js)
- Create: `public/fonts/` con 4 archivos TTF de Google Fonts
- Create: `src/render/fonts.ts` (load + register)
- Create: `src/render/tokens.ts` (WIRED design tokens en TS)

- [ ] **Step 1: Instalar deps**

```bash
pnpm add satori @resvg/resvg-js
```

- [ ] **Step 2: Descargar Google Fonts**

```bash
mkdir -p public/fonts

# Playfair Display (display serif)
curl -sL "https://github.com/google/fonts/raw/main/ofl/playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf" -o public/fonts/PlayfairDisplay-Variable.ttf

# Inter (UI sans)
curl -sL "https://github.com/rsms/inter/raw/master/docs/font-files/Inter-Bold.otf" -o public/fonts/Inter-Bold.ttf || \
  curl -sL "https://github.com/google/fonts/raw/main/ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf" -o public/fonts/Inter-Variable.ttf

# JetBrains Mono (mono kicker)
curl -sL "https://github.com/google/fonts/raw/main/ofl/jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf" -o public/fonts/JetBrainsMono-Variable.ttf

# Lora (body serif)
curl -sL "https://github.com/google/fonts/raw/main/ofl/lora/Lora%5Bwght%5D.ttf" -o public/fonts/Lora-Variable.ttf

ls -la public/fonts/
```

Expected: 4 archivos .ttf en public/fonts/. Si alguno falla con 404, intentar URLs alternativas en https://fonts.google.com/ — bajar manualmente.

- [ ] **Step 3: Tokens WIRED**

```bash
mkdir -p src/render
cat > src/render/tokens.ts <<'EOF'
/**
 * Design tokens del sistema WIRED-inspired (ver DESIGN.md).
 * Solo subset usado en cards de bot. La fuente canónica es DESIGN.md.
 */

export const colors = {
  paperWhite: '#ffffff',
  ink: '#000000',
  pageInk: '#1a1a1a',
  caption: '#757575',
  hairline: '#e2e8f0',
  linkBlue: '#057dbc',
};

export const fonts = {
  display: 'PlayfairDisplay',  // serif para headlines grandes
  body: 'Lora',                // serif para texto largo
  ui: 'Inter',                 // sans para UI labels y bold
  mono: 'JetBrainsMono',       // mono para kickers + timestamps
};

export const sizes = {
  // Card output: 1200x675 (Twitter card large, 16:9)
  cardWidth: 1200,
  cardHeight: 675,

  ribbonHeight: 56,
  footerHeight: 60,
  padding: 48,

  // Type scale (px)
  display: 64,
  headline: 40,
  bodyLarge: 24,
  body: 18,
  kicker: 14,
  meta: 13,
};

export const tracking = {
  kickerLetterSpacing: '1.1px',
  metaLetterSpacing: '1.0px',
};
EOF
```

- [ ] **Step 4: Font loader**

```bash
cat > src/render/fonts.ts <<'EOF'
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface SatoriFont {
  name: string;
  data: Buffer;
  weight: number;
  style: 'normal' | 'italic';
}

const FONT_DIR = resolve(process.cwd(), 'public/fonts');

let cache: SatoriFont[] | null = null;

export function loadFonts(): SatoriFont[] {
  if (cache) return cache;
  const files: Array<{ name: string; file: string; weight: number }> = [
    { name: 'PlayfairDisplay', file: 'PlayfairDisplay-Variable.ttf', weight: 400 },
    { name: 'Lora',            file: 'Lora-Variable.ttf',            weight: 400 },
    { name: 'Inter',           file: 'Inter-Variable.ttf',           weight: 700 },
    { name: 'JetBrainsMono',   file: 'JetBrainsMono-Variable.ttf',   weight: 400 },
  ];
  cache = files.map(({ name, file, weight }) => ({
    name,
    data: readFileSync(resolve(FONT_DIR, file)),
    weight,
    style: 'normal',
  }));
  return cache;
}
EOF
```

- [ ] **Step 5: Update .gitignore para storage runtime**

Append to `.gitignore`:

```bash
cat >> .gitignore <<'EOF'

# Runtime storage (cards generadas)
storage/
EOF
```

- [ ] **Step 6: Smoke load fonts**

```bash
pnpm tsx -e "import { loadFonts } from './src/render/fonts.js'; const fs = loadFonts(); console.log(fs.map(f => ({ name: f.name, bytes: f.data.length })));"
```

Expected: array de 4 objetos con bytes > 0. Si un archivo no existe, error claro de readFileSync.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml public/fonts/ src/render/fonts.ts src/render/tokens.ts .gitignore
git commit -m "$(cat <<'COMMIT'
feat(render): Satori + fonts + WIRED tokens

@satori-html para JSX→SVG y @resvg/resvg-js para SVG→PNG.
Bundleamos 4 fuentes de Google Fonts (Playfair Display, Lora,
Inter, JetBrains Mono) — sustitutos sugeridos en DESIGN.md de
las propietarias de WIRED. tokens.ts es subset usado en cards.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

### Task 10: Card components base + Compose helper

**Files:**
- Create: `src/render/components/Ribbon.tsx`
- Create: `src/render/components/Footer.tsx`
- Create: `src/render/components/BarChart.tsx`
- Create: `src/render/compose.ts`
- Create: `tests/render/compose.test.ts`

- [ ] **Step 1: Configurar TS para JSX en src/render/**

Read `tsconfig.json`. Add to `compilerOptions`:

```json
"jsx": "react-jsx",
"jsxImportSource": "satori"
```

If `jsxImportSource` causes issues with vitest, alternative: use `jsx: "preserve"` and write components as plain `createElement` calls. We'll go with `react-jsx` + `satori` import source.

Actually since Satori expects React-like elements but doesn't ship a `jsx-runtime`, the simplest path is to write components as plain JS that returns the element-shaped object Satori expects. **Use Satori's element format directly (no JSX) to avoid build-tooling complexity.**

Update tsconfig.json: NO change to JSX config. Components return objects shaped like:
```ts
{ type: 'div', props: { style: {...}, children: [...] } }
```

- [ ] **Step 2: Ribbon component**

```bash
mkdir -p src/render/components
cat > src/render/components/Ribbon.tsx <<'EOF'
import { colors, fonts, sizes, tracking } from '../tokens.js';

export function Ribbon(text: string) {
  return {
    type: 'div',
    key: 'ribbon',
    props: {
      style: {
        display: 'flex',
        alignItems: 'center',
        height: sizes.ribbonHeight,
        background: colors.ink,
        color: colors.paperWhite,
        paddingLeft: sizes.padding,
        paddingRight: sizes.padding,
        fontFamily: fonts.mono,
        fontSize: sizes.kicker,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: tracking.kickerLetterSpacing,
      },
      children: text,
    },
  };
}
EOF
```

- [ ] **Step 3: Footer component**

```bash
cat > src/render/components/Footer.tsx <<'EOF'
import { colors, fonts, sizes, tracking } from '../tokens.js';

export function Footer(timestamp: string, source: string, handle: string) {
  return {
    type: 'div',
    key: 'footer',
    props: {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        height: sizes.footerHeight,
        paddingLeft: sizes.padding,
        paddingRight: sizes.padding,
        borderTop: `2px solid ${colors.ink}`,
        fontFamily: fonts.mono,
        fontSize: sizes.meta,
        textTransform: 'uppercase',
        letterSpacing: tracking.metaLetterSpacing,
        color: colors.pageInk,
      },
      children: [
        {
          type: 'div',
          key: 'src',
          props: { children: `${timestamp} · ${source}` },
        },
        {
          type: 'div',
          key: 'h',
          props: {
            style: { color: colors.linkBlue },
            children: handle,
          },
        },
      ],
    },
  };
}
EOF
```

- [ ] **Step 4: BarChart component**

```bash
cat > src/render/components/BarChart.tsx <<'EOF'
import { colors, fonts, sizes } from '../tokens.js';

export interface Bar {
  label: string;
  pct: number;        // 0-100
}

const MAX_BAR_WIDTH = 600;

export function BarChart(bars: Bar[]) {
  const maxPct = Math.max(...bars.map((b) => b.pct), 1);
  return {
    type: 'div',
    key: 'chart',
    props: {
      style: { display: 'flex', flexDirection: 'column', gap: 16 },
      children: bars.map((b, i) => ({
        type: 'div',
        key: `bar-${i}`,
        props: {
          style: { display: 'flex', alignItems: 'center', gap: 16 },
          children: [
            {
              type: 'div',
              key: 'label',
              props: {
                style: {
                  width: 220,
                  fontFamily: fonts.ui,
                  fontSize: sizes.body,
                  fontWeight: 700,
                  color: colors.pageInk,
                },
                children: b.label,
              },
            },
            {
              type: 'div',
              key: 'bar',
              props: {
                style: {
                  width: (b.pct / maxPct) * MAX_BAR_WIDTH,
                  height: 28,
                  background: colors.ink,
                },
                children: '',
              },
            },
            {
              type: 'div',
              key: 'pct',
              props: {
                style: {
                  fontFamily: fonts.mono,
                  fontSize: sizes.body,
                  fontWeight: 700,
                  color: colors.pageInk,
                },
                children: `${b.pct.toFixed(1)}%`,
              },
            },
          ],
        },
      })),
    },
  };
}
EOF
```

- [ ] **Step 5: Compose helper (JSX-shaped → SVG → PNG)**

```bash
cat > src/render/compose.ts <<'EOF'
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { loadFonts } from './fonts.js';
import { colors, sizes } from './tokens.js';

export interface CardElement {
  type: string;
  key?: string;
  props: { style?: Record<string, unknown>; children?: unknown };
}

const STORAGE_DIR = resolve(process.cwd(), 'storage', 'cards');

/**
 * Envuelve los children en el frame estándar (paper white, 1200x675).
 */
export function frame(children: CardElement[]): CardElement {
  return {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: sizes.cardWidth,
        height: sizes.cardHeight,
        background: colors.paperWhite,
      },
      children,
    },
  };
}

/**
 * Renderiza un element-tree de Satori a PNG y lo escribe a storage/cards/<id>.png.
 * Devuelve el path absoluto y el path relative (para guardar en DB).
 */
export async function renderToPng(
  card: CardElement,
  filenameWithoutExt: string,
): Promise<{ absPath: string; relPath: string }> {
  const fonts = loadFonts();
  const svg = await satori(card as unknown as Parameters<typeof satori>[0], {
    width: sizes.cardWidth,
    height: sizes.cardHeight,
    fonts,
  });
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: sizes.cardWidth } });
  const pngBuffer = resvg.render().asPng();

  const absPath = resolve(STORAGE_DIR, `${filenameWithoutExt}.png`);
  const relPath = `storage/cards/${filenameWithoutExt}.png`;
  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, pngBuffer);
  return { absPath, relPath };
}
EOF
```

- [ ] **Step 6: Test (smoke render de un card simple)**

```bash
mkdir -p tests/render
cat > tests/render/compose.test.ts <<'EOF'
import { describe, it, expect } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { Ribbon } from '../../src/render/components/Ribbon.js';
import { Footer } from '../../src/render/components/Footer.js';
import { frame, renderToPng } from '../../src/render/compose.js';

describe('renderToPng', () => {
  it('produces a non-empty PNG file from a minimal card', async () => {
    const card = frame([
      Ribbon('TEST RENDER'),
      {
        type: 'div',
        props: {
          style: { flex: 1, padding: 48, fontSize: 64, fontFamily: 'PlayfairDisplay' },
          children: 'Smoke test',
        },
      },
      Footer('00:00 GMT-3', 'TEST', '@politica'),
    ]);

    const { absPath, relPath } = await renderToPng(card, 'test-smoke');
    expect(existsSync(absPath)).toBe(true);
    expect(statSync(absPath).size).toBeGreaterThan(1000); // at least 1KB
    expect(relPath).toBe('storage/cards/test-smoke.png');
  }, 15_000);
});
EOF
```

- [ ] **Step 7: Run test**

```bash
pnpm test tests/render/compose.test.ts
```

Expected: 1 test pass. Si falla con error de Satori sobre fonts, verificar que las fuentes están en public/fonts/. Si falla con "JSX is not allowed" — confirmar que los componentes NO usan JSX sintaxis, solo objetos.

- [ ] **Step 8: Verificar el PNG manualmente**

```bash
open storage/cards/test-smoke.png
```

(Tu Mac debería abrirlo en Preview. Verificá que se ve "TEST RENDER" arriba en una barra negra, "Smoke test" en serif grande, y un footer.)

- [ ] **Step 9: Suite + typecheck**

```bash
pnpm typecheck && pnpm test
```

Expected: 31 tests pass (26 anteriores + 1 events + 2 market-move + 2 new-poll + 2 hot-news + 1 compose = 34 actually). Type check clean.

(Counting: 26 base + 3 events + 2 market-move + 2 new-poll + 2 hot-news + 1 compose = 36 — depends on prior task counts.)

- [ ] **Step 10: Commit**

```bash
git add src/render/components/ src/render/compose.ts tests/render/
git commit -m "$(cat <<'COMMIT'
feat(render): card frame + Ribbon/Footer/BarChart components

Compose helper: element-tree → satori SVG → resvg PNG → escribe a
storage/cards/<id>.png. Componentes son objetos plain (no JSX) para
evitar tooling extra. Tests producen y verifican un PNG real con
Ribbon + headline + Footer.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

### Task 11: Cards por shape (Market Move, New Poll, Hot News, Morning Brief)

**Files:**
- Create: `src/render/cards/market-move.ts`
- Create: `src/render/cards/new-poll.ts`
- Create: `src/render/cards/hot-news.ts`
- Create: `src/render/cards/morning-brief.ts`

- [ ] **Step 1: Market Move card**

```bash
mkdir -p src/render/cards
cat > src/render/cards/market-move.ts <<'EOF'
import { Ribbon } from '../components/Ribbon.js';
import { Footer } from '../components/Footer.js';
import { frame, type CardElement } from '../compose.js';
import { colors, fonts, sizes } from '../tokens.js';
import type { MarketMoveEvent } from '../../trigger/types.js';

export function marketMoveCard(input: {
  event: MarketMoveEvent;
  context?: { latestPollPct?: number; latestPollSource?: string };
  timestamp: string;
  handle: string;
}): CardElement {
  const { event, context, timestamp, handle } = input;
  const sign = event.deltaPct >= 0 ? '+' : '';
  const arrow = event.deltaPct >= 0 ? '↑' : '↓';

  return frame([
    Ribbon('POLYMARKET MOVE'),
    {
      type: 'div',
      props: {
        style: {
          flex: 1,
          padding: sizes.padding,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        },
        children: [
          {
            type: 'div',
            props: {
              style: {
                fontFamily: fonts.display,
                fontSize: sizes.display,
                lineHeight: 1.0,
                color: colors.pageInk,
              },
              children: `${event.candidate} ${arrow} ${sign}${event.deltaPct.toFixed(1)}pp`,
            },
          },
          {
            type: 'div',
            props: {
              style: {
                fontFamily: fonts.body,
                fontSize: sizes.bodyLarge,
                color: colors.pageInk,
                lineHeight: 1.4,
              },
              children: `Mercado actual ${(event.priceNow * 100).toFixed(1)}% (${event.windowHours}h)${
                context?.latestPollPct != null
                  ? ` · Encuesta más cercana: ${context.latestPollPct.toFixed(1)}%${
                      context.latestPollSource ? ` (${context.latestPollSource})` : ''
                    }`
                  : ''
              }`,
            },
          },
        ],
      },
    },
    Footer(timestamp, 'POLYMARKET', handle),
  ]);
}
EOF
```

- [ ] **Step 2: New Poll card (con BarChart)**

```bash
cat > src/render/cards/new-poll.ts <<'EOF'
import { Ribbon } from '../components/Ribbon.js';
import { Footer } from '../components/Footer.js';
import { BarChart } from '../components/BarChart.js';
import { frame, type CardElement } from '../compose.js';
import { colors, fonts, sizes } from '../tokens.js';

export function newPollCard(input: {
  pollsterDisplayName: string;
  fechaCampo: string | null;
  sampleSize: number | null;
  results: Array<{ candidato: string; pct: number }>;
  timestamp: string;
  handle: string;
}): CardElement {
  const { pollsterDisplayName, fechaCampo, sampleSize, results, timestamp, handle } = input;
  const top5 = results.slice(0, 5).map((r) => ({ label: r.candidato, pct: r.pct }));

  const sub = [
    pollsterDisplayName,
    fechaCampo ? `Campo ${fechaCampo}` : null,
    sampleSize ? `n=${sampleSize}` : null,
  ].filter(Boolean).join(' · ');

  return frame([
    Ribbon('NUEVA ENCUESTA'),
    {
      type: 'div',
      props: {
        style: {
          flex: 1,
          padding: sizes.padding,
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
        },
        children: [
          {
            type: 'div',
            props: {
              style: {
                fontFamily: fonts.body,
                fontSize: sizes.body,
                color: colors.caption,
                textTransform: 'uppercase',
                letterSpacing: '1px',
              },
              children: sub,
            },
          },
          BarChart(top5),
        ],
      },
    },
    Footer(timestamp, pollsterDisplayName.toUpperCase(), handle),
  ]);
}
EOF
```

- [ ] **Step 3: Hot News card**

```bash
cat > src/render/cards/hot-news.ts <<'EOF'
import { Ribbon } from '../components/Ribbon.js';
import { Footer } from '../components/Footer.js';
import { frame, type CardElement } from '../compose.js';
import { colors, fonts, sizes } from '../tokens.js';

export function hotNewsCard(input: {
  source: string;
  headline: string;
  candidatesMentioned: string[];
  correlatedMove: { candidate: string; deltaPct: number } | null;
  timestamp: string;
  handle: string;
}): CardElement {
  const { source, headline, candidatesMentioned, correlatedMove, timestamp, handle } = input;
  const subline = correlatedMove
    ? `Polymarket ${correlatedMove.candidate} ${correlatedMove.deltaPct >= 0 ? '+' : ''}${correlatedMove.deltaPct.toFixed(1)}pp en 24h`
    : `Menciona: ${candidatesMentioned.slice(0, 3).join(', ')}`;

  return frame([
    Ribbon(`HOT NEWS · ${source.toUpperCase()}`),
    {
      type: 'div',
      props: {
        style: {
          flex: 1,
          padding: sizes.padding,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        },
        children: [
          {
            type: 'div',
            props: {
              style: {
                fontFamily: fonts.display,
                fontSize: sizes.headline,
                lineHeight: 1.1,
                color: colors.pageInk,
              },
              children: headline.length > 100 ? `${headline.slice(0, 97)}...` : headline,
            },
          },
          {
            type: 'div',
            props: {
              style: {
                fontFamily: fonts.body,
                fontSize: sizes.bodyLarge,
                color: colors.caption,
              },
              children: subline,
            },
          },
        ],
      },
    },
    Footer(timestamp, source.toUpperCase(), handle),
  ]);
}
EOF
```

- [ ] **Step 4: Morning Brief card (top 5 actuales de Polymarket)**

```bash
cat > src/render/cards/morning-brief.ts <<'EOF'
import { Ribbon } from '../components/Ribbon.js';
import { Footer } from '../components/Footer.js';
import { BarChart } from '../components/BarChart.js';
import { frame, type CardElement } from '../compose.js';
import { colors, fonts, sizes } from '../tokens.js';

export function morningBriefCard(input: {
  topCandidates: Array<{ candidato: string; pct: number; deltaPct?: number }>;
  marketDate: string;
  timestamp: string;
  handle: string;
}): CardElement {
  const { topCandidates, marketDate, timestamp, handle } = input;
  const bars = topCandidates.slice(0, 5).map((c) => ({
    label: c.deltaPct != null
      ? `${c.candidato}  ${c.deltaPct >= 0 ? '↑' : '↓'}${Math.abs(c.deltaPct).toFixed(1)}`
      : c.candidato,
    pct: c.pct,
  }));

  return frame([
    Ribbon('MORNING BRIEF · POLYMARKET 2027'),
    {
      type: 'div',
      props: {
        style: {
          flex: 1,
          padding: sizes.padding,
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
        },
        children: [
          {
            type: 'div',
            props: {
              style: {
                fontFamily: fonts.body,
                fontSize: sizes.body,
                color: colors.caption,
                textTransform: 'uppercase',
                letterSpacing: '1px',
              },
              children: `Top 5 · ${marketDate}`,
            },
          },
          BarChart(bars),
        ],
      },
    },
    Footer(timestamp, 'POLYMARKET', handle),
  ]);
}
EOF
```

- [ ] **Step 5: Smoke render de los 4 shapes**

```bash
pnpm tsx -e "
import { renderToPng } from './src/render/compose.js';
import { marketMoveCard } from './src/render/cards/market-move.js';
import { newPollCard } from './src/render/cards/new-poll.js';
import { hotNewsCard } from './src/render/cards/hot-news.js';
import { morningBriefCard } from './src/render/cards/morning-brief.js';

const ts = '14:32 GMT-3';

await renderToPng(marketMoveCard({
  event: { marketId: 'm1', candidate: 'Milei', priceNow: 0.52, priceThen: 0.48, deltaPct: 4.2, windowHours: 6 },
  context: { latestPollPct: 45.2, latestPollSource: 'Opinaia' },
  timestamp: ts, handle: '@politica',
}), 'smoke-market-move');

await renderToPng(newPollCard({
  pollsterDisplayName: 'Opinaia',
  fechaCampo: '2026-04-28', sampleSize: 1200,
  results: [
    { candidato: 'Milei', pct: 45.2 },
    { candidato: 'Kicillof', pct: 28.5 },
    { candidato: 'Bullrich', pct: 12.0 },
    { candidato: 'Massa', pct: 8.5 },
    { candidato: 'Otros', pct: 5.8 },
  ],
  timestamp: ts, handle: '@politica',
}), 'smoke-new-poll');

await renderToPng(hotNewsCard({
  source: 'CLARÍN',
  headline: 'Diputados aprobó la reforma jubilatoria que impulsó Milei',
  candidatesMentioned: ['Milei', 'Bullrich'],
  correlatedMove: { candidate: 'Milei', deltaPct: 3.2 },
  timestamp: ts, handle: '@politica',
}), 'smoke-hot-news');

await renderToPng(morningBriefCard({
  topCandidates: [
    { candidato: 'Milei', pct: 51.5, deltaPct: 1.2 },
    { candidato: 'Kicillof', pct: 29.5, deltaPct: -0.8 },
    { candidato: 'Bullrich', pct: 9.2, deltaPct: 0 },
    { candidato: 'Massa', pct: 5.1 },
    { candidato: 'Villarruel', pct: 4.7 },
  ],
  marketDate: '4 may 2026',
  timestamp: ts, handle: '@politica',
}), 'smoke-morning-brief');

console.log('Done. Open storage/cards/ to inspect.');
"
```

Expected: 4 PNGs en `storage/cards/`.

```bash
ls -la storage/cards/
open storage/cards/smoke-*.png
```

Inspeccioná visualmente los 4 cards. Si alguno se ve mal (texto cortado, layout overflow), iteramos en Fase 4 — esto es Phase 3 baseline.

- [ ] **Step 6: typecheck + tests**

```bash
pnpm typecheck && pnpm test
```

Expected: tests siguen pasando.

- [ ] **Step 7: Commit**

```bash
git add src/render/cards/
git commit -m "$(cat <<'COMMIT'
feat(render): cards por shape (market-move/new-poll/hot-news/morning-brief)

4 funciones puras (data → CardElement). Cada una compone Ribbon +
contenido + Footer. Smoke render produce 4 PNGs visualmente
inspeccionables. Polish visual queda para Fase 4 cuando empecemos
a publicar.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Bloque E — Caption generation

### Task 12: Caption prompts + LLM + linter

**Files:**
- Create: `src/caption/prompts.ts`
- Create: `src/caption/linter.ts`
- Create: `src/caption/fallback.ts`
- Create: `src/caption/generate.ts`
- Create: `tests/caption/linter.test.ts`

- [ ] **Step 1: Prompts**

```bash
mkdir -p src/caption
cat > src/caption/prompts.ts <<'EOF'
export interface CaptionContext {
  shape: 'morning_brief' | 'market_move' | 'new_poll' | 'hot_news';
  data: Record<string, unknown>;
}

export function captionPrompt(ctx: CaptionContext): string {
  const { shape, data } = ctx;
  const dataLines = Object.entries(data)
    .map(([k, v]) => `- ${k}: ${JSON.stringify(v)}`)
    .join('\n');

  const shapeHint = {
    morning_brief: 'resumen matutino del mercado de elecciones',
    market_move: 'alerta de movimiento en Polymarket',
    new_poll: 'nueva encuesta detectada',
    hot_news: 'noticia política de alto impacto',
  }[shape];

  return `
Estás escribiendo un tweet para una cuenta automatizada que reporta datos electorales argentinos.
Tono: factual, conciso, en español rioplatense, sin opinión política, sin partidismo.

Tipo de post: ${shapeHint}.

Datos source (los únicos números que podés mencionar):
${dataLines}

Generá UN tweet de máximo 220 caracteres.
- NO inventes números — solo podés usar números que aparecen literalmente en los datos source.
- NO repitas verbatim los datos (la card ya los muestra) — enfocate en *qué pasó* y *contexto*.
- Sin hashtags. Sin emojis (excepto un solo 🔔 al inicio si es alerta de movimiento).
- No uses palabras como "ganará", "perderá", "sin duda" — somos descriptivos, no predictivos.

Devolvé EXCLUSIVAMENTE el texto del tweet, sin prefijos, sin comillas.
`.trim();
}
EOF
```

- [ ] **Step 2: Linter (number guardrail) — TDD**

```bash
mkdir -p tests/caption
cat > tests/caption/linter.test.ts <<'EOF'
import { describe, it, expect } from 'vitest';
import { lintCaption } from '../../src/caption/linter.js';

describe('lintCaption', () => {
  const allowed = { numbers: [45.2, 28.5, 6, 142000] };

  it('passes when all numbers in caption are in allowed set', () => {
    const r = lintCaption('Milei 45.2% en encuesta. Spread 28.5pp.', allowed);
    expect(r.ok).toBe(true);
  });

  it('passes when caption has no numbers', () => {
    const r = lintCaption('Milei consolida liderazgo según relevamiento reciente.', allowed);
    expect(r.ok).toBe(true);
  });

  it('fails when caption contains a hallucinated number', () => {
    const r = lintCaption('Milei 99.9% — récord histórico.', allowed);
    expect(r.ok).toBe(false);
    expect(r.violations).toContain('99.9');
  });

  it('treats integer literal differently from decimal', () => {
    const r = lintCaption('Sample n=1500.', allowed);
    expect(r.ok).toBe(false); // 1500 no está en allowed
  });

  it('matches with small numeric tolerance', () => {
    // 45.2 está allowed; "45.20" debería matchear
    const r = lintCaption('Milei 45.20% según Opinaia.', allowed);
    expect(r.ok).toBe(true);
  });

  it('flags forbidden words', () => {
    const r = lintCaption('Milei sin duda gana.', allowed);
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.includes('sin duda'))).toBe(true);
  });
});
EOF
```

- [ ] **Step 3: Implement linter**

```bash
cat > src/caption/linter.ts <<'EOF'
const FORBIDDEN_PHRASES = [
  'sin duda',
  'sin dudas',
  'ganará',
  'perderá',
  'va a ganar',
  'va a perder',
];

export interface LintResult {
  ok: boolean;
  violations: string[];
}

const NUMBER_RX = /-?\d+(?:[\.,]\d+)?/g;

export function lintCaption(
  caption: string,
  allowed: { numbers: number[] },
): LintResult {
  const violations: string[] = [];
  const lower = caption.toLowerCase();

  for (const phrase of FORBIDDEN_PHRASES) {
    if (lower.includes(phrase)) {
      violations.push(`forbidden phrase: ${phrase}`);
    }
  }

  const matches = caption.match(NUMBER_RX) ?? [];
  for (const m of matches) {
    const n = Number(m.replace(',', '.'));
    if (Number.isNaN(n)) continue;
    const allowedHit = allowed.numbers.some((a) => Math.abs(a - n) < 0.05);
    if (!allowedHit) violations.push(m);
  }

  return { ok: violations.length === 0, violations };
}

/**
 * Helper: extrae todos los numbers (recursivamente) de un objeto plain.
 */
export function collectNumbers(obj: unknown, out: number[] = []): number[] {
  if (typeof obj === 'number') out.push(obj);
  else if (typeof obj === 'string') {
    const matches = obj.match(NUMBER_RX) ?? [];
    for (const m of matches) {
      const n = Number(m.replace(',', '.'));
      if (!Number.isNaN(n)) out.push(n);
    }
  } else if (Array.isArray(obj)) {
    for (const x of obj) collectNumbers(x, out);
  } else if (obj && typeof obj === 'object') {
    for (const v of Object.values(obj)) collectNumbers(v, out);
  }
  return out;
}
EOF
```

- [ ] **Step 4: Run linter tests**

```bash
pnpm test tests/caption/linter.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 5: Fallback Bloomberg-style**

```bash
cat > src/caption/fallback.ts <<'EOF'
import type { MarketMoveEvent, NewPollEvent, HotNewsEvent } from '../trigger/types.js';

export function fallbackCaption(
  shape: 'morning_brief' | 'market_move' | 'new_poll' | 'hot_news',
  data: Record<string, unknown>,
): string {
  switch (shape) {
    case 'market_move': {
      const e = data.event as MarketMoveEvent;
      const sign = e.deltaPct >= 0 ? '+' : '';
      return `${e.candidate} ${sign}${e.deltaPct.toFixed(1)}pp en Polymarket (${e.windowHours}h). Precio actual: ${(e.priceNow * 100).toFixed(1)}%.`;
    }
    case 'new_poll': {
      const e = data as unknown as NewPollEvent & { pollsterDisplayName?: string };
      const psName = e.pollsterDisplayName ?? e.pollsterSlug;
      return `Nueva encuesta de ${psName}: ${e.topCandidate} ${e.topCandidatePct.toFixed(1)}% (#1).`;
    }
    case 'hot_news': {
      const e = data as unknown as HotNewsEvent;
      const move = e.correlatedMove
        ? ` · Polymarket ${e.correlatedMove.candidate} ${e.correlatedMove.deltaPct >= 0 ? '+' : ''}${e.correlatedMove.deltaPct.toFixed(1)}pp/24h`
        : '';
      return `${e.source}: ${e.headline.slice(0, 150)}${move}`;
    }
    case 'morning_brief': {
      const top = data.topCandidates as Array<{ candidato: string; pct: number }>;
      const t = top.slice(0, 3).map((c) => `${c.candidato} ${c.pct.toFixed(1)}%`).join(' · ');
      return `Polymarket 2027 — top 3: ${t}`;
    }
  }
}
EOF
```

- [ ] **Step 6: generate.ts (LLM call → linter → fallback)**

```bash
cat > src/caption/generate.ts <<'EOF'
import { llm } from '../llm/index.js';
import { logger } from '../lib/logger.js';
import { captionPrompt, type CaptionContext } from './prompts.js';
import { collectNumbers, lintCaption } from './linter.js';
import { fallbackCaption } from './fallback.js';

export interface GenerateResult {
  caption: string;
  source: 'llm' | 'fallback';
  attempts: number;
  rawOutputs: string[];      // todos los outputs del LLM probados
  lintViolations: string[][];
}

const MAX_ATTEMPTS = 2;

export async function generateCaption(ctx: CaptionContext): Promise<GenerateResult> {
  const allowedNumbers = collectNumbers(ctx.data);
  const allowed = { numbers: allowedNumbers };
  const prompt = captionPrompt(ctx);

  const rawOutputs: string[] = [];
  const lintViolations: string[][] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let raw: string;
    try {
      raw = await llm.classify(prompt, { model: 'haiku' });
    } catch (err) {
      logger.warn({ err: (err as Error).message, attempt }, 'caption: llm error');
      continue;
    }
    rawOutputs.push(raw);
    const cleaned = raw.trim().replace(/^["']|["']$/g, '');
    const lint = lintCaption(cleaned, allowed);
    if (lint.ok) {
      return { caption: cleaned, source: 'llm', attempts: attempt, rawOutputs, lintViolations };
    }
    lintViolations.push(lint.violations);
    logger.warn({ attempt, violations: lint.violations }, 'caption: lint failed, retrying');
  }

  // Fallback — siempre dentro del number guardrail (porque está hardcoded a numbers explícitos)
  const fb = fallbackCaption(ctx.shape, ctx.data);
  return { caption: fb, source: 'fallback', attempts: MAX_ATTEMPTS, rawOutputs, lintViolations };
}
EOF
```

- [ ] **Step 7: Smoke test de generate (1 call al CLI real)**

```bash
pnpm tsx -e "
import { generateCaption } from './src/caption/generate.js';
const r = await generateCaption({
  shape: 'market_move',
  data: {
    event: { marketId: 'm1', candidate: 'Milei', priceNow: 0.52, priceThen: 0.48, deltaPct: 4.2, windowHours: 6 },
    latestPollPct: 45.2,
    latestPollSource: 'Opinaia',
  },
});
console.log('Source:', r.source, '| Attempts:', r.attempts);
console.log('Caption:', r.caption);
"
```

Expected: caption en español, ≤220 chars, sin números fuera de los provistos. Si el LLM aluciona dos veces seguidas, cae al fallback.

- [ ] **Step 8: Suite + typecheck**

```bash
pnpm typecheck && pnpm test
```

Expected: tests pasan, 6 nuevos del linter.

- [ ] **Step 9: Commit**

```bash
git add src/caption/ tests/caption/
git commit -m "$(cat <<'COMMIT'
feat(caption): LLM + linter + fallback Bloomberg

Number guardrail: regex extrae números del caption y exige que
cada uno matchee (±0.05) un número del set source. Forbidden
phrases (ganará/perderá/sin duda) descartan output. 2 attempts
y caída a fallback hardcoded por shape. collectNumbers extrae
recursivamente desde objetos plain.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Bloque F — Trigger orchestrator + wiring

### Task 13: Caps + cooldowns + quiet hours

**Files:**
- Create: `src/trigger/caps.ts`
- Create: `tests/trigger/caps.test.ts`

- [ ] **Step 1: Test failing**

```bash
cat > tests/trigger/caps.test.ts <<'EOF'
import { describe, it, expect, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../../src/db/client.js';
import { botPosts } from '../../src/db/schema.js';
import { canPostNow, dailyPostCount, candidateCooldownActive, isQuietHour } from '../../src/trigger/caps.js';

beforeEach(async () => {
  await db.execute(sql`DELETE FROM bot_posts`);
});

describe('caps', () => {
  it('isQuietHour true between 1am and 7am ARG (=GMT-3)', () => {
    const t1 = new Date('2026-05-04T05:00:00-03:00'); // 5am ARG
    expect(isQuietHour(t1)).toBe(true);
    const t2 = new Date('2026-05-04T13:00:00-03:00'); // 1pm ARG
    expect(isQuietHour(t2)).toBe(false);
  });

  it('dailyPostCount returns 0 with no posts today', async () => {
    expect(await dailyPostCount()).toBe(0);
  });

  it('dailyPostCount counts published+draft within last 24h', async () => {
    await db.insert(botPosts).values({
      shape: 'market_move',
      caption: 'x',
      cardPath: 'storage/cards/x.png',
      sourceSnapshot: {},
      llmMetadata: {},
      status: 'draft',
    });
    expect(await dailyPostCount()).toBe(1);
  });

  it('candidateCooldownActive returns true when same candidate posted within window', async () => {
    await db.insert(botPosts).values({
      shape: 'market_move',
      caption: 'x',
      cardPath: 'storage/cards/x.png',
      sourceSnapshot: {},
      llmMetadata: {},
      candidateFocus: 'Milei',
      status: 'draft',
    });
    expect(await candidateCooldownActive('Milei', { hours: 4 })).toBe(true);
    expect(await candidateCooldownActive('Kicillof', { hours: 4 })).toBe(false);
  });

  it('canPostNow combines all checks', async () => {
    const noon = new Date('2026-05-04T12:00:00-03:00');
    const r = await canPostNow({ now: noon, candidateFocus: 'Milei' });
    expect(r.ok).toBe(true);
  });
});
EOF
```

- [ ] **Step 2: Implement caps**

```bash
cat > src/trigger/caps.ts <<'EOF'
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';

const DAILY_CAP = 6;
const QUIET_START_HOUR = 1; // 1am ARG
const QUIET_END_HOUR = 7;   // 7am ARG

/**
 * Convierte una Date a hora del día en ARG (UTC-3).
 */
function hourInArg(d: Date): number {
  // ARG es UTC-3. getUTCHours() + (-3) wrap-around
  const utc = d.getUTCHours();
  return (utc + 24 - 3) % 24;
}

export function isQuietHour(now: Date): boolean {
  const h = hourInArg(now);
  return h >= QUIET_START_HOUR && h < QUIET_END_HOUR;
}

export async function dailyPostCount(): Promise<number> {
  const r = await db.execute(sql`
    SELECT COUNT(*)::int AS c FROM bot_posts
    WHERE status IN ('draft', 'scheduled', 'published')
      AND generated_at > NOW() - INTERVAL '24 hours'
  `);
  return (r.rows[0] as { c: number }).c;
}

export async function candidateCooldownActive(
  candidate: string,
  opts: { hours: number },
): Promise<boolean> {
  const r = await db.execute(sql`
    SELECT 1 FROM bot_posts
    WHERE candidate_focus = ${candidate}
      AND status IN ('draft', 'scheduled', 'published')
      AND generated_at > NOW() - (${opts.hours} || ' hours')::interval
    LIMIT 1
  `);
  return r.rows.length > 0;
}

export interface CanPostResult {
  ok: boolean;
  reason?: string;
}

export async function canPostNow(opts: {
  now: Date;
  candidateFocus: string | null;
  cooldownHours?: number;
  bypassQuietHours?: boolean;
}): Promise<CanPostResult> {
  if (!opts.bypassQuietHours && isQuietHour(opts.now)) {
    return { ok: false, reason: 'quiet_hour' };
  }
  const count = await dailyPostCount();
  if (count >= DAILY_CAP) {
    return { ok: false, reason: 'daily_cap' };
  }
  if (opts.candidateFocus) {
    const cd = await candidateCooldownActive(opts.candidateFocus, {
      hours: opts.cooldownHours ?? 4,
    });
    if (cd) return { ok: false, reason: 'candidate_cooldown' };
  }
  return { ok: true };
}
EOF
```

- [ ] **Step 3: Run tests**

```bash
pnpm test tests/trigger/caps.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/trigger/caps.ts tests/trigger/caps.test.ts
git commit -m "$(cat <<'COMMIT'
feat(trigger): caps (daily 6, candidate cooldown 4h, quiet hours 1-7am ARG)

canPostNow combina los tres checks. Funciones individuales son
testables por separado.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

### Task 14: Trigger orchestrator + wiring + E2E

**Files:**
- Create: `src/trigger/orchestrator.ts`
- Create: `src/trigger/morning-brief.ts` (cron-driven, no via event)
- Modify: `src/workers/orchestrator.ts` (wire all watchers + trigger orchestrator)

- [ ] **Step 1: Trigger orchestrator (consume events → genera + persiste post)**

```bash
cat > src/trigger/orchestrator.ts <<'EOF'
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { botPosts, polls, pollsters, news, marketPrices, markets } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { claimNextPendingEvent, markEventProcessed, markEventDiscarded } from './events.js';
import { canPostNow } from './caps.js';
import { marketMoveEventSchema, newPollEventSchema, hotNewsEventSchema } from './types.js';
import { renderToPng } from '../render/compose.js';
import { marketMoveCard } from '../render/cards/market-move.js';
import { newPollCard } from '../render/cards/new-poll.js';
import { hotNewsCard } from '../render/cards/hot-news.js';
import { generateCaption } from '../caption/generate.js';

const HANDLE = '@politica'; // TODO: cuando reservemos handle real, sacarlo a env

function nowStr(): string {
  // 14:32 GMT-3 style
  const d = new Date();
  const h = (d.getUTCHours() + 24 - 3) % 24;
  const m = d.getUTCMinutes();
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} GMT-3`;
}

export interface OrchestratorStats {
  claimed: number;
  drafted: number;
  discarded: Record<string, number>;
}

export async function runTriggerOrchestrator(): Promise<OrchestratorStats> {
  const stats: OrchestratorStats = { claimed: 0, drafted: 0, discarded: {} };
  const MAX_PER_RUN = 5;

  for (let i = 0; i < MAX_PER_RUN; i++) {
    const ev = await claimNextPendingEvent();
    if (!ev) break;
    stats.claimed++;

    try {
      let result: { ok: true; postId: number } | { ok: false; reason: string };

      switch (ev.type) {
        case 'MARKET_MOVE': {
          const payload = marketMoveEventSchema.parse(ev.payload);
          result = await handleMarketMove(ev.id, payload);
          break;
        }
        case 'NEW_POLL': {
          const payload = newPollEventSchema.parse(ev.payload);
          result = await handleNewPoll(ev.id, payload);
          break;
        }
        case 'HOT_NEWS': {
          const payload = hotNewsEventSchema.parse(ev.payload);
          result = await handleHotNews(ev.id, payload);
          break;
        }
        default:
          result = { ok: false, reason: `unknown_event_type:${ev.type}` };
      }

      if (result.ok) {
        await markEventProcessed(ev.id);
        stats.drafted++;
      } else {
        await markEventDiscarded(ev.id, result.reason);
        stats.discarded[result.reason] = (stats.discarded[result.reason] ?? 0) + 1;
      }
    } catch (err) {
      logger.error({ eventId: ev.id, err: (err as Error).message }, 'orchestrator: handler failed');
      await markEventDiscarded(ev.id, `handler_error:${(err as Error).message.slice(0, 80)}`);
    }
  }

  logger.info({ ...stats }, 'trigger: orchestrator run complete');
  return stats;
}

// ─── Handlers ──────────────────────────────────────────────────────

async function handleMarketMove(
  eventId: number,
  payload: ReturnType<typeof marketMoveEventSchema.parse>,
): Promise<{ ok: true; postId: number } | { ok: false; reason: string }> {
  const cap = await canPostNow({ now: new Date(), candidateFocus: payload.candidate });
  if (!cap.ok) return { ok: false, reason: cap.reason ?? 'cap_unknown' };

  // Context: encuesta más cercana para ese candidato
  const ctx = await db.execute(`
    SELECT (jsonb_array_elements(results)->>'pct')::float AS pct, pollster_id
    FROM polls p
    WHERE p.status IN ('approved','auto_approved')
    ORDER BY ingested_at DESC LIMIT 1
  `).catch(() => ({ rows: [] }));
  const latestPollPct = (ctx.rows[0] as { pct?: number } | undefined)?.pct;

  const card = marketMoveCard({
    event: payload,
    context: latestPollPct ? { latestPollPct } : undefined,
    timestamp: nowStr(),
    handle: HANDLE,
  });

  const filename = `event-${eventId}-market-move`;
  const { relPath } = await renderToPng(card, filename);

  const cap_ = await generateCaption({
    shape: 'market_move',
    data: { event: payload, latestPollPct },
  });

  const inserted = await db.insert(botPosts).values({
    shape: 'market_move',
    status: 'draft',
    caption: cap_.caption,
    cardPath: relPath,
    sourceSnapshot: { event: payload, latestPollPct },
    llmMetadata: { source: cap_.source, attempts: cap_.attempts, lintViolations: cap_.lintViolations },
    eventId,
    candidateFocus: payload.candidate,
  }).returning({ id: botPosts.id });

  return { ok: true, postId: inserted[0].id };
}

async function handleNewPoll(
  eventId: number,
  payload: ReturnType<typeof newPollEventSchema.parse>,
): Promise<{ ok: true; postId: number } | { ok: false; reason: string }> {
  const cap = await canPostNow({ now: new Date(), candidateFocus: payload.topCandidate });
  if (!cap.ok) return { ok: false, reason: cap.reason ?? 'cap_unknown' };

  const [poll] = await db.select().from(polls).where(eq(polls.id, payload.pollId));
  if (!poll) return { ok: false, reason: 'poll_not_found' };
  const [pollster] = await db.select().from(pollsters).where(eq(pollsters.id, poll.pollsterId));

  const card = newPollCard({
    pollsterDisplayName: pollster?.displayName ?? payload.pollsterSlug,
    fechaCampo: poll.fechaCampo ? poll.fechaCampo.toISOString().slice(0, 10) : null,
    sampleSize: poll.sampleSize,
    results: poll.results,
    timestamp: nowStr(),
    handle: HANDLE,
  });

  const filename = `event-${eventId}-new-poll`;
  const { relPath } = await renderToPng(card, filename);

  const captionData = {
    pollsterSlug: payload.pollsterSlug,
    pollsterDisplayName: pollster?.displayName ?? payload.pollsterSlug,
    topCandidate: payload.topCandidate,
    topCandidatePct: payload.topCandidatePct,
    sampleSize: poll.sampleSize,
  };
  const cap_ = await generateCaption({ shape: 'new_poll', data: captionData });

  const inserted = await db.insert(botPosts).values({
    shape: 'new_poll',
    status: 'draft',
    caption: cap_.caption,
    cardPath: relPath,
    sourceSnapshot: captionData,
    llmMetadata: { source: cap_.source, attempts: cap_.attempts, lintViolations: cap_.lintViolations },
    eventId,
    candidateFocus: payload.topCandidate,
  }).returning({ id: botPosts.id });

  return { ok: true, postId: inserted[0].id };
}

async function handleHotNews(
  eventId: number,
  payload: ReturnType<typeof hotNewsEventSchema.parse>,
): Promise<{ ok: true; postId: number } | { ok: false; reason: string }> {
  const focusCandidate = payload.candidatesMentioned[0] ?? null;
  const cap = await canPostNow({ now: new Date(), candidateFocus: focusCandidate });
  if (!cap.ok) return { ok: false, reason: cap.reason ?? 'cap_unknown' };

  const card = hotNewsCard({
    source: payload.source,
    headline: payload.headline,
    candidatesMentioned: payload.candidatesMentioned,
    correlatedMove: payload.correlatedMove,
    timestamp: nowStr(),
    handle: HANDLE,
  });

  const filename = `event-${eventId}-hot-news`;
  const { relPath } = await renderToPng(card, filename);

  const cap_ = await generateCaption({ shape: 'hot_news', data: payload });

  const inserted = await db.insert(botPosts).values({
    shape: 'hot_news',
    status: 'draft',
    caption: cap_.caption,
    cardPath: relPath,
    sourceSnapshot: payload,
    llmMetadata: { source: cap_.source, attempts: cap_.attempts, lintViolations: cap_.lintViolations },
    eventId,
    candidateFocus: focusCandidate,
  }).returning({ id: botPosts.id });

  return { ok: true, postId: inserted[0].id };
}
EOF
```

- [ ] **Step 2: Morning brief generator (cron, no via event)**

```bash
cat > src/trigger/morning-brief.ts <<'EOF'
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { botPosts } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { renderToPng } from '../render/compose.js';
import { morningBriefCard } from '../render/cards/morning-brief.js';
import { generateCaption } from '../caption/generate.js';
import { canPostNow } from './caps.js';

export async function runMorningBrief(): Promise<{ ok: boolean; postId?: number; reason?: string }> {
  // Permitir morning brief incluso si quiet hour: 9am ARG NO es quiet hour, así que cae OK.
  const cap = await canPostNow({ now: new Date(), candidateFocus: null });
  if (!cap.ok) return { ok: false, reason: cap.reason };

  // Top 5 candidatos del mercado AR 2027 con delta últimas 7 días
  const rows = await db.execute(sql`
    WITH latest AS (
      SELECT DISTINCT ON (candidate) candidate, price::float AS price
      FROM market_prices mp JOIN markets m ON m.id = mp.market_id
      WHERE m.slug = 'argentina-presidential-election-winner'
      ORDER BY candidate, ts DESC
    ),
    week_ago AS (
      SELECT DISTINCT ON (candidate) candidate, price::float AS price
      FROM market_prices mp JOIN markets m ON m.id = mp.market_id
      WHERE m.slug = 'argentina-presidential-election-winner'
        AND ts <= NOW() - INTERVAL '7 days'
      ORDER BY candidate, ts DESC
    )
    SELECT l.candidate, l.price * 100 AS pct, (l.price - COALESCE(w.price, l.price)) * 100 AS delta_pct
    FROM latest l LEFT JOIN week_ago w USING (candidate)
    ORDER BY l.price DESC LIMIT 5;
  `);

  if (rows.rows.length < 3) {
    logger.warn({ count: rows.rows.length }, 'morning-brief: not enough data');
    return { ok: false, reason: 'insufficient_data' };
  }

  const top = (rows.rows as Array<{ candidate: string; pct: number; delta_pct: number }>).map((r) => ({
    candidato: r.candidate,
    pct: r.pct,
    deltaPct: r.delta_pct,
  }));

  const date = new Date();
  const dateStr = `${date.getUTCDate()} ${['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'][date.getUTCMonth()]} ${date.getUTCFullYear()}`;

  const card = morningBriefCard({
    topCandidates: top,
    marketDate: dateStr,
    timestamp: '09:00 GMT-3',
    handle: '@politica',
  });

  const filename = `morning-brief-${date.toISOString().slice(0, 10)}`;
  const { relPath } = await renderToPng(card, filename);

  const captionData = { topCandidates: top };
  const cap_ = await generateCaption({ shape: 'morning_brief', data: captionData });

  const inserted = await db.insert(botPosts).values({
    shape: 'morning_brief',
    status: 'draft',
    caption: cap_.caption,
    cardPath: relPath,
    sourceSnapshot: captionData,
    llmMetadata: { source: cap_.source, attempts: cap_.attempts, lintViolations: cap_.lintViolations },
  }).returning({ id: botPosts.id });

  logger.info({ postId: inserted[0].id, source: cap_.source }, 'morning-brief: drafted');
  return { ok: true, postId: inserted[0].id };
}
EOF
```

- [ ] **Step 3: Wire al orchestrator**

Read `src/workers/orchestrator.ts`. Add to imports:

```ts
import { runMarketMoveWatcher } from '../trigger/watchers/market-move.js';
import { runNewPollWatcher } from '../trigger/watchers/new-poll.js';
import { runHotNewsWatcher } from '../trigger/watchers/hot-news.js';
import { runTriggerOrchestrator } from '../trigger/orchestrator.js';
import { runMorningBrief } from '../trigger/morning-brief.js';
```

Add new schedules inside `main()`, BEFORE the final `logger.info('schedules registered')`:

```ts
  // Watchers cada 5 min — emiten events si hay novedades
  cron.schedule('*/5 * * * *', singleflight('market-move-watcher', () =>
    runMarketMoveWatcher({ thresholdPct: env.MARKET_MOVE_THRESHOLD_PCT, windowHours: 6 }).then(() => undefined)));
  cron.schedule('*/5 * * * *', singleflight('new-poll-watcher', () =>
    runNewPollWatcher().then(() => undefined)));
  cron.schedule('*/5 * * * *', singleflight('hot-news-watcher', () =>
    runHotNewsWatcher({ relevanceThreshold: 0.7 }).then(() => undefined)));

  // Trigger orchestrator: cada 2 min consume events y genera drafts
  cron.schedule('*/2 * * * *', singleflight('trigger-orchestrator', () =>
    runTriggerOrchestrator().then(() => undefined)));

  // Morning brief diario a las 9am ARG (12:00 UTC)
  cron.schedule('0 12 * * *', singleflight('morning-brief', () =>
    runMorningBrief().then(() => undefined)));
```

- [ ] **Step 4: Smoke test del orchestrator manual**

```bash
# Forzar un evento para que haya algo que procesar
pnpm tsx -e "
import { emitEvent } from './src/trigger/events.js';
const id = await emitEvent('MARKET_MOVE', {
  marketId: '0x1', candidate: 'Milei', priceNow: 0.52, priceThen: 0.48, deltaPct: 4.2, windowHours: 6,
});
console.log('Emitted event id', id);
"

# Correr el orchestrator manualmente
pnpm tsx -e "
import { runTriggerOrchestrator } from './src/trigger/orchestrator.js';
const stats = await runTriggerOrchestrator();
console.log(stats);
"
```

Expected:
- log "trigger: orchestrator run complete"
- bot_posts table tiene una nueva fila con shape='market_move', status='draft', cardPath populated
- storage/cards/event-<id>-market-move.png existe

```bash
docker exec politica-pg psql -U politica -d politica -c "
  SELECT id, shape, status, candidate_focus, card_path, left(caption, 60) AS caption_preview, llm_metadata->>'source' AS caption_src
  FROM bot_posts ORDER BY id DESC LIMIT 5;
"
ls -la storage/cards/
```

- [ ] **Step 5: Smoke test del morning brief**

```bash
pnpm tsx -e "
import { runMorningBrief } from './src/trigger/morning-brief.js';
const r = await runMorningBrief();
console.log(r);
"
```

Expected: ok=true (si DB tiene datos suficientes) + post creado.

- [ ] **Step 6: Suite + typecheck**

```bash
pnpm typecheck && pnpm test
```

Expected: 0 typecheck errors. Tests siguen pasando.

- [ ] **Step 7: Update README + commit**

Read `README.md`. Update the "Estado" section to "Fase 3 — Trigger Engine + Content Generation (en curso)" and add a "Pipeline overview" section listing the 3 watchers + trigger orchestrator + morning brief.

Then commit:

```bash
git add src/trigger/orchestrator.ts src/trigger/morning-brief.ts src/workers/orchestrator.ts README.md
git commit -m "$(cat <<'COMMIT'
feat(trigger): orchestrator + morning brief + worker wiring

runTriggerOrchestrator consume eventos pending (claim atomic),
parsea payload por tipo, valida caps, genera card + caption + escribe
bot_posts con status='draft'. Discards si caps fallan.
runMorningBrief corre 9am ARG (cron 12:00 UTC) sin pasar por events.
Watchers + orchestrator + morning brief schedulados en el worker.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Cierre de Fase 3

Al terminar todas las tareas:

- [ ] **Verificación E2E desde DB vacía**

```bash
docker compose down -v
docker compose up -d
sleep 5
pnpm db:migrate
pnpm tsx scripts/seed-pollsters.ts
pnpm worker > /tmp/e2e3.log 2>&1 &
WORKER_PID=$!
sleep 600  # 10 min permite >=2 ticks de watcher (cada 5min) y >=4 de orchestrator (cada 2min)
kill -INT $WORKER_PID
sleep 3
tail -60 /tmp/e2e3.log
```

- [ ] **Verificar bot_posts**

```bash
docker exec politica-pg psql -U politica -d politica -c "
  SELECT shape, status, count(*) FROM bot_posts GROUP BY shape, status;
"
```

- [ ] **Inspeccionar las cards generadas**

```bash
ls -la storage/cards/
open storage/cards/*.png
```

- [ ] **Notas para Fase 4 (Publisher + Admin)**:
  - Tasa de captions vía LLM vs vía fallback (si fallback > 30%, mejorar el prompt o ajustar el linter).
  - Calidad visual de las cards — anotar qué shape requiere más iteración.
  - Volumen real de events por día (cuántos MARKET_MOVE / NEW_POLL / HOT_NEWS dispara el día típico).
  - Si los caps son apropiados (¿siempre topando 6/día? ¿cooldowns matando todo?).

**Output operacional al final de Fase 3**: pipelines de ingestion + watchers + trigger engine + cards + captions corriendo en local. `bot_posts` con status='draft' acumulando contenido listo para publicar. Cards visualmente inspeccionables en `storage/cards/`. Próxima fase (4) suma el publisher a X + admin UI con kill switch + audit log + modos shadow/soft/full.
