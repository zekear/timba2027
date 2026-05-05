# Política Bot — Fase 4: Publisher + Admin UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar el loop end-to-end: drafts en `bot_posts` se aprueban (CLI o web) → se publican a X con cards reales → quedan trackeados con `x_post_id`. Tres modos de publicación (shadow / soft launch / full autonomous) con kill switch global.

**Architecture:** Publisher worker consume `bot_posts(status='scheduled')` y los manda a X API v2 (media upload + tweet). Soft launch agrega 60s de delay entre `approved` y `scheduled` para permitir cancel. Kill switch es env var que bloquea cualquier publicación. Admin UI es una Next.js app dentro del mismo monorepo (mismo `package.json`, comparte `src/db`).

**Tech Stack:** TypeScript, Next.js 15 App Router, Tailwind CSS, Drizzle ORM (compartido con worker), X API v2 (write tier), basic auth via cookie.

**Tiempo estimado:** 3-4 semanas a 8-10 hs/semana.

**Pre-requisitos:**
- Fase 3 completa y mergeada
- X API write tier habilitado en la app (verificar en developer.x.com — pay-per-use generalmente lo incluye)
- Handle de X reservado (registrar la cuenta antes del primer publish; el plan asume `BOT_HANDLE` en env)
- `ADMIN_BASIC_AUTH_USER` y `ADMIN_BASIC_AUTH_PASS` en `.env` para proteger `/admin`

---

## Estructura de archivos al final de Fase 4

```
src/
├── publish/                       ★ nueva
│   ├── x-write-client.ts          (uploadMedia + createTweet)
│   ├── modes.ts                   (Shadow|Soft|Full + policies)
│   ├── transitions.ts             (state machine helpers)
│   └── publisher.ts               (worker)
├── lib/env.ts                     (+ PUBLISH_MODE, KILL_SWITCH, BOT_HANDLE, ADMIN_BASIC_AUTH_*)
├── render/cards/market-move.ts    (arrow fix: ↑/↓ → ▲/▼)
├── render/cards/morning-brief.ts  (mismo fix)
└── workers/orchestrator.ts        (+ publisher schedule + post-approval delay job)

scripts/
└── admin.ts                       ★ CLI: list-drafts/approve/kill/publish-now

app/                                ★ Next.js App Router
├── layout.tsx
├── globals.css                     (tailwind)
├── page.tsx                        (drafts list — root)
├── posts/[id]/page.tsx             (preview + actions)
├── admin/
│   ├── page.tsx                    (kill switch + mode selector)
│   └── actions.ts
├── api/
│   ├── cards/[file]/route.ts       (sirve PNGs desde storage/cards/)
│   ├── posts/[id]/approve/route.ts
│   ├── posts/[id]/kill/route.ts
│   ├── posts/[id]/publish-now/route.ts
│   └── admin/state/route.ts        (toggle kill switch + mode)
├── lib/
│   └── auth.ts                     (basic auth middleware)
└── components/
    ├── DraftCard.tsx
    ├── ActionButtons.tsx
    └── KillSwitchToggle.tsx
middleware.ts                       ★ Next.js middleware (basic auth gate)

tests/
├── publish/
│   ├── transitions.test.ts
│   ├── modes.test.ts
│   └── x-write-client.test.ts      (mocked fetch)
└── render/
    └── arrows.test.ts              (verifica que el rendering use ▲/▼)
```

---

## Bloque A — Publisher core

### Task 1: Fix arrow rendering en cards

PlayfairDisplay no tiene los glyphs `↑`/`↓` y se renderiza como una persona-esquiando. Reemplazar con `▲`/`▼` (presentes en muchas más fuentes) y verificar que JetBrainsMono o Inter tengan estos glyphs.

**Files:**
- Modify: `src/render/cards/market-move.ts`
- Modify: `src/render/cards/morning-brief.ts`

- [ ] **Step 1: Read y modificar market-move.ts**

Read `src/render/cards/market-move.ts`. Find the line:

```ts
const arrow = event.deltaPct >= 0 ? '↑' : '↓';
```

Replace with:

```ts
const arrow = event.deltaPct >= 0 ? '▲' : '▼';
```

- [ ] **Step 2: Read y modificar morning-brief.ts**

Read `src/render/cards/morning-brief.ts`. Find:

```ts
label: c.deltaPct != null
  ? `${c.candidato}  ${c.deltaPct >= 0 ? '↑' : '↓'}${Math.abs(c.deltaPct).toFixed(1)}`
  : c.candidato,
```

Replace `↑`/`↓` con `▲`/`▼`.

- [ ] **Step 3: Smoke render para validar**

```bash
pnpm tsx scripts/smoke-render-cards.ts 2>/dev/null || pnpm tsx -e "
import { renderToPng } from './src/render/compose.js';
import { marketMoveCard } from './src/render/cards/market-move.js';
import { morningBriefCard } from './src/render/cards/morning-brief.js';
await renderToPng(marketMoveCard({
  event: { marketId: 'm', candidate: 'Milei', priceNow: 0.52, priceThen: 0.48, deltaPct: 4.2, windowHours: 6 },
  timestamp: '14:00 GMT-3', handle: '@politica',
}), 'test-arrow-up');
await renderToPng(marketMoveCard({
  event: { marketId: 'm', candidate: 'Massa', priceNow: 0.05, priceThen: 0.10, deltaPct: -5.0, windowHours: 6 },
  timestamp: '14:00 GMT-3', handle: '@politica',
}), 'test-arrow-down');
console.log('Done. Open storage/cards/test-arrow-{up,down}.png');
"
```

Inspeccioná las dos PNGs — el arrow `▲`/`▼` debería renderizar correctamente como un triángulo.

- [ ] **Step 4: Commit**

```bash
git add src/render/cards/market-move.ts src/render/cards/morning-brief.ts
git commit -m "$(cat <<'COMMIT'
fix(render): reemplazar ↑/↓ por ▲/▼ en cards

PlayfairDisplay no incluye los arrows unicode ↑/↓ y se renderizaban
como persona-esquiando. ▲/▼ está en glyph-set estándar de la mayoría
de las fonts incluida Playfair.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

### Task 2: X API write client (media upload + tweet create)

**Files:**
- Create: `src/publish/x-write-client.ts`
- Create: `tests/publish/x-write-client.test.ts`

- [ ] **Step 1: Test failing con fetch mock**

```bash
mkdir -p tests/publish
cat > tests/publish/x-write-client.test.ts <<'EOF'
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { uploadMedia, createTweet } from '../../src/publish/x-write-client.js';

const originalFetch = global.fetch;

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('uploadMedia', () => {
  it('returns media_id_string from successful upload', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { id: '1234567890' } }), { status: 200 }),
    );
    const buffer = Buffer.from('fake-png');
    const id = await uploadMedia(buffer, 'image/png');
    expect(id).toBe('1234567890');
  });

  it('throws on non-2xx response', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      new Response('Unauthorized', { status: 401 }),
    );
    const buffer = Buffer.from('fake-png');
    await expect(uploadMedia(buffer, 'image/png')).rejects.toThrow(/401/);
  });
});

describe('createTweet', () => {
  it('posts tweet with media_ids and returns tweet id', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { id: '9876', text: 'Hello' } }), { status: 201 }),
    );
    const id = await createTweet({ text: 'Hello', mediaIds: ['1234567890'] });
    expect(id).toBe('9876');
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain('/2/tweets');
    const body = JSON.parse(call[1].body);
    expect(body.text).toBe('Hello');
    expect(body.media.media_ids).toEqual(['1234567890']);
  });

  it('posts tweet without media when mediaIds empty', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { id: '4567', text: 'No media' } }), { status: 201 }),
    );
    const id = await createTweet({ text: 'No media', mediaIds: [] });
    expect(id).toBe('4567');
    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.media).toBeUndefined();
  });
});
EOF
```

- [ ] **Step 2: Run RED**

```bash
pnpm test tests/publish/x-write-client.test.ts
```

Expected: FAIL "Cannot find module".

- [ ] **Step 3: Implement client**

```bash
mkdir -p src/publish
cat > src/publish/x-write-client.ts <<'EOF'
import { env } from '../lib/env.js';
import { fetchWithTimeout } from '../lib/http.js';
import { logger } from '../lib/logger.js';

const TWEET_TIMEOUT_MS = 20_000;
const MEDIA_TIMEOUT_MS = 30_000;

function authHeaders(): HeadersInit {
  if (!env.X_API_BEARER_TOKEN) {
    throw new Error('X_API_BEARER_TOKEN not set; cannot publish');
  }
  return {
    authorization: `Bearer ${env.X_API_BEARER_TOKEN}`,
    accept: 'application/json',
  };
}

/**
 * Upload de media binario a X (POST /2/media/upload). Multipart con field 'media'.
 * Devuelve el media_id_string que se usa en createTweet().
 *
 * Costo: 1 write op + bandwidth.
 */
export async function uploadMedia(
  buffer: Buffer,
  mimeType: 'image/png' | 'image/jpeg',
): Promise<string> {
  const url = `${env.X_API_BASE}/media/upload`;
  const blob = new Blob([buffer], { type: mimeType });
  const form = new FormData();
  form.append('media', blob, 'card.png');

  const res = await fetchWithTimeout(url, {
    timeoutMs: MEDIA_TIMEOUT_MS,
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`X uploadMedia failed: ${res.status} ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { data?: { id?: string } };
  const id = json.data?.id;
  if (!id) {
    throw new Error(`X uploadMedia returned no id: ${JSON.stringify(json).slice(0, 300)}`);
  }
  logger.debug({ mediaId: id, bytes: buffer.length }, 'x: media uploaded');
  return id;
}

/**
 * Crea un tweet con texto + media opcional. Devuelve el tweet id.
 * POST /2/tweets — costo: 1 write ($0.015 desde abril 2026).
 */
export async function createTweet(opts: {
  text: string;
  mediaIds: string[];
}): Promise<string> {
  const url = `${env.X_API_BASE}/tweets`;
  const body: Record<string, unknown> = { text: opts.text };
  if (opts.mediaIds.length > 0) {
    body.media = { media_ids: opts.mediaIds };
  }
  const res = await fetchWithTimeout(url, {
    timeoutMs: TWEET_TIMEOUT_MS,
    method: 'POST',
    headers: { ...authHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`X createTweet failed: ${res.status} ${errText.slice(0, 300)}`);
  }
  const json = (await res.json()) as { data?: { id?: string } };
  const id = json.data?.id;
  if (!id) {
    throw new Error(`X createTweet returned no id: ${JSON.stringify(json).slice(0, 300)}`);
  }
  logger.info({ tweetId: id, mediaCount: opts.mediaIds.length }, 'x: tweet created');
  return id;
}
EOF
```

- [ ] **Step 4: Run GREEN**

```bash
pnpm test tests/publish/x-write-client.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Suite + typecheck**

```bash
pnpm typecheck && pnpm test
```

Expected: 52 tests pass (48 + 4 new).

- [ ] **Step 6: Commit**

```bash
git add src/publish/x-write-client.ts tests/publish/x-write-client.test.ts
git commit -m "$(cat <<'COMMIT'
feat(publish): X API write client (uploadMedia + createTweet)

uploadMedia POST /2/media/upload con multipart. createTweet POST
/2/tweets con media_ids opcional. Tests usan fetch mockeado (no
hit real al API). Costo per post estimado: 1 write op (~USD 0.015).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

### Task 3: Env vars + handle + kill switch

**Files:**
- Modify: `src/lib/env.ts`
- Modify: `.env.example`

- [ ] **Step 1: Agregar al schema de env**

Read `src/lib/env.ts`. Add to the schema:

```ts
PUBLISH_MODE: z.enum(['shadow', 'soft', 'full']).default('shadow'),
KILL_SWITCH: z.coerce.boolean().default(false),
BOT_HANDLE: z.string().default('@politica'),
SOFT_LAUNCH_DELAY_SEC: z.coerce.number().int().nonnegative().default(60),
ADMIN_BASIC_AUTH_USER: z.string().optional(),
ADMIN_BASIC_AUTH_PASS: z.string().optional(),
```

- [ ] **Step 2: Append a `.env.example`** (defaults seguros para nuevos contributors)

```bash
cat >> .env.example <<'EOF'

# Publish — DEFAULTS SEGUROS (no publican hasta que vos los habilites)
PUBLISH_MODE=shadow                     # shadow | soft | full
KILL_SWITCH=true                        # global toggle: TRUE bloquea TODA publicación
BOT_HANDLE=@ezeqmina                    # cambialo cuando reserves el handle del bot
SOFT_LAUNCH_DELAY_SEC=60                # segundos entre approve y publish (en modo soft)

# Admin UI (basic auth)
ADMIN_BASIC_AUTH_USER=
ADMIN_BASIC_AUTH_PASS=
EOF
```

- [ ] **Step 3: Update tu `.env` real con doble candado**

```bash
cat >> .env <<'EOF'

# Publish — DOUBLE LOCK: shadow + kill switch ACTIVO
# Para realmente publicar:
#   1. Verificá X API write tier habilitado en developer.x.com
#   2. Cambia PUBLISH_MODE a soft (o usá la admin UI)
#   3. Bajá KILL_SWITCH a false (o desactivá vía admin UI)
PUBLISH_MODE=shadow
KILL_SWITCH=true
BOT_HANDLE=@ezeqmina
SOFT_LAUNCH_DELAY_SEC=60

# Admin (basic auth — cambia las creds antes de exponer)
ADMIN_BASIC_AUTH_USER=admin
ADMIN_BASIC_AUTH_PASS=changeme-en-produccion
EOF
```

**El bearer token actual es de la cuenta personal @ezeqmina.** Cualquier tweet que pase los 3 checks saldría desde esa cuenta. Por eso arrancamos con shadow + kill switch ON. La admin UI te permite togglear ambos en runtime cuando estés listo.

- [ ] **Step 4: typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 5: Verificar boot del worker carga las nuevas vars**

```bash
pnpm tsx -e "import { env } from './src/lib/env.js'; console.log({ mode: env.PUBLISH_MODE, kill: env.KILL_SWITCH, handle: env.BOT_HANDLE, delay: env.SOFT_LAUNCH_DELAY_SEC });"
```

Expected: imprime los 4 valores.

- [ ] **Step 6: Commit**

```bash
git add src/lib/env.ts .env.example
git commit -m "$(cat <<'COMMIT'
feat(env): publish mode, kill switch, bot handle, admin auth

PUBLISH_MODE (shadow|soft|full) default shadow para que no publique
inadvertidamente al primer arranque post-merge. KILL_SWITCH bloquea
toda publicación. SOFT_LAUNCH_DELAY_SEC default 60s.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

### Task 4: State machine + transitions helpers

**Note:** Esta tarea agrega `'approved'` al enum `bot_post_status` (en Fase 3 sólo tenía draft/scheduled/published/killed). Postgres soporta agregar valores a enums sin recrearlos.

**Files:**
- Modify: `src/db/schema.ts` (enum: agregar 'approved')
- Auto-create: `src/db/migrations/0004_*.sql`
- Create: `src/publish/transitions.ts`
- Create: `tests/publish/transitions.test.ts`

- [ ] **Step 0: Extender el enum**

Read `src/db/schema.ts`. Find the line:

```ts
export const botPostStatusEnum = pgEnum('bot_post_status', [
  'draft',
  'scheduled',
  'published',
  'killed',
]);
```

Replace with:

```ts
export const botPostStatusEnum = pgEnum('bot_post_status', [
  'draft',
  'approved',
  'scheduled',
  'published',
  'killed',
]);
```

```bash
pnpm db:generate
pnpm db:migrate
docker exec politica-pg psql -U politica -d politica -c "\dT+ bot_post_status"
```

Expected: enum incluye los 5 valores ahora. La migración generada usa `ALTER TYPE ... ADD VALUE 'approved'`.

- [ ] **Step 1: Test failing**

```bash
cat > tests/publish/transitions.test.ts <<'EOF'
import { describe, it, expect, beforeEach } from 'vitest';
import { sql, eq } from 'drizzle-orm';
import { db } from '../../src/db/client.js';
import { botPosts } from '../../src/db/schema.js';
import { approveDraft, killPost, schedulePost, markPublished } from '../../src/publish/transitions.js';

let testPostId: number;

beforeEach(async () => {
  await db.execute(sql`DELETE FROM bot_posts WHERE caption LIKE 'test-tx-%'`);
  const [p] = await db.insert(botPosts).values({
    shape: 'market_move',
    status: 'draft',
    caption: 'test-tx-' + Math.random(),
    cardPath: 'storage/cards/x.png',
    sourceSnapshot: {},
    llmMetadata: {},
  }).returning({ id: botPosts.id });
  testPostId = p.id;
});

describe('approveDraft', () => {
  it('moves draft → approved', async () => {
    await approveDraft(testPostId);
    const [p] = await db.select().from(botPosts).where(eq(botPosts.id, testPostId));
    expect(p.status).toBe('approved' as never);
  });
  it('throws if post is already published', async () => {
    await db.update(botPosts).set({ status: 'published' }).where(eq(botPosts.id, testPostId));
    await expect(approveDraft(testPostId)).rejects.toThrow(/draft/i);
  });
});

describe('killPost', () => {
  it('moves any non-published status → killed', async () => {
    await killPost(testPostId);
    const [p] = await db.select().from(botPosts).where(eq(botPosts.id, testPostId));
    expect(p.status).toBe('killed' as never);
  });
  it('refuses to kill an already published post', async () => {
    await db.update(botPosts).set({ status: 'published' }).where(eq(botPosts.id, testPostId));
    await expect(killPost(testPostId)).rejects.toThrow(/published/i);
  });
});

describe('schedulePost', () => {
  it('moves approved → scheduled', async () => {
    await db.update(botPosts).set({ status: 'approved' }).where(eq(botPosts.id, testPostId));
    await schedulePost(testPostId);
    const [p] = await db.select().from(botPosts).where(eq(botPosts.id, testPostId));
    expect(p.status).toBe('scheduled' as never);
  });
});

describe('markPublished', () => {
  it('moves scheduled → published with x_post_id', async () => {
    await db.update(botPosts).set({ status: 'scheduled' }).where(eq(botPosts.id, testPostId));
    await markPublished(testPostId, 'tweet-12345');
    const [p] = await db.select().from(botPosts).where(eq(botPosts.id, testPostId));
    expect(p.status).toBe('published' as never);
    expect(p.xPostId).toBe('tweet-12345');
    expect(p.publishedAt).not.toBeNull();
  });
});
EOF
```

- [ ] **Step 2: Run RED**

```bash
pnpm test tests/publish/transitions.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement transitions**

```bash
cat > src/publish/transitions.ts <<'EOF'
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { botPosts } from '../db/schema.js';
import { logger } from '../lib/logger.js';

export class TransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransitionError';
  }
}

async function getPost(id: number) {
  const rows = await db.select().from(botPosts).where(eq(botPosts.id, id));
  if (!rows.length) throw new TransitionError(`bot_post ${id} not found`);
  return rows[0];
}

/** draft → approved */
export async function approveDraft(id: number): Promise<void> {
  const p = await getPost(id);
  if (p.status !== 'draft') {
    throw new TransitionError(`can only approve draft posts (got status=${p.status})`);
  }
  await db.update(botPosts).set({ status: 'approved' }).where(eq(botPosts.id, id));
  logger.info({ postId: id }, 'transition: draft → approved');
}

/** approved → scheduled (post-soft-launch-delay window) */
export async function schedulePost(id: number): Promise<void> {
  const p = await getPost(id);
  if (p.status !== 'approved') {
    throw new TransitionError(`can only schedule approved posts (got status=${p.status})`);
  }
  await db.update(botPosts).set({ status: 'scheduled' }).where(eq(botPosts.id, id));
  logger.info({ postId: id }, 'transition: approved → scheduled');
}

/** scheduled → published (tras X API exitoso) */
export async function markPublished(id: number, xPostId: string): Promise<void> {
  const p = await getPost(id);
  if (p.status !== 'scheduled') {
    throw new TransitionError(`can only mark scheduled posts as published (got status=${p.status})`);
  }
  await db
    .update(botPosts)
    .set({ status: 'published', xPostId, publishedAt: new Date() })
    .where(eq(botPosts.id, id));
  logger.info({ postId: id, xPostId }, 'transition: scheduled → published');
}

/** any non-published → killed */
export async function killPost(id: number): Promise<void> {
  const p = await getPost(id);
  if (p.status === 'published') {
    throw new TransitionError(`cannot kill an already published post (id=${id}, x_post_id=${p.xPostId})`);
  }
  await db.update(botPosts).set({ status: 'killed' }).where(eq(botPosts.id, id));
  logger.info({ postId: id, prevStatus: p.status }, 'transition: → killed');
}
EOF
```

- [ ] **Step 4: Run GREEN**

```bash
pnpm test tests/publish/transitions.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Suite + typecheck**

```bash
pnpm typecheck && pnpm test
```

Expected: 57 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/publish/transitions.ts tests/publish/transitions.test.ts
git commit -m "$(cat <<'COMMIT'
feat(publish): state machine transitions (approve/schedule/publish/kill)

approveDraft, schedulePost, markPublished, killPost — cada uno
valida el estado previo y lanza TransitionError si invalido. kill
es la única transición permitida desde varios estados (todos
excepto published).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Bloque B — Modes config

### Task 5: Modes policies

**Files:**
- Create: `src/publish/modes.ts`
- Create: `tests/publish/modes.test.ts`

- [ ] **Step 1: Test failing**

```bash
cat > tests/publish/modes.test.ts <<'EOF'
import { describe, it, expect } from 'vitest';
import { policyForMode, type PublishMode } from '../../src/publish/modes.js';

describe('policyForMode', () => {
  it('shadow mode disables publication entirely', () => {
    const p = policyForMode('shadow');
    expect(p.canPublish(new Date())).toBe(false);
    expect(p.dailyCap).toBe(6);
  });

  it('soft mode allows publication only between 9 and 22 ARG', () => {
    const p = policyForMode('soft');
    const t10am = new Date('2026-05-04T10:00:00-03:00');
    const t1am = new Date('2026-05-04T01:00:00-03:00');
    const t11pm = new Date('2026-05-04T23:00:00-03:00');
    expect(p.canPublish(t10am)).toBe(true);
    expect(p.canPublish(t1am)).toBe(false);
    expect(p.canPublish(t11pm)).toBe(false);
    expect(p.dailyCap).toBe(3); // soft tiene cap reducido
  });

  it('full mode allows publication 24/7 (excepto quiet hours del orchestrator)', () => {
    const p = policyForMode('full');
    expect(p.canPublish(new Date('2026-05-04T15:00:00-03:00'))).toBe(true);
    expect(p.dailyCap).toBe(6);
  });
});
EOF
```

- [ ] **Step 2: Run RED**

```bash
pnpm test tests/publish/modes.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement modes**

```bash
cat > src/publish/modes.ts <<'EOF'
export type PublishMode = 'shadow' | 'soft' | 'full';

export interface ModePolicy {
  canPublish(now: Date): boolean;
  dailyCap: number;
  delaySeconds: number;
  description: string;
}

function hourArg(d: Date): number {
  return (d.getUTCHours() + 24 - 3) % 24;
}

const SHADOW: ModePolicy = {
  canPublish: () => false,
  dailyCap: 6,
  delaySeconds: 0,
  description: 'Shadow: no publica. Drafts quedan en queue para review manual.',
};

const SOFT: ModePolicy = {
  canPublish: (now) => {
    const h = hourArg(now);
    return h >= 9 && h < 22;
  },
  dailyCap: 3,
  delaySeconds: 60,
  description: 'Soft launch: publica 9-22 ARG, cap 3/día, delay 60s post-approve para permitir kill.',
};

const FULL: ModePolicy = {
  canPublish: () => true,    // El orchestrator-level quiet hour (1-7am) sigue aplicando vía caps.ts
  dailyCap: 6,
  delaySeconds: 0,
  description: 'Full autonomous: cap 6/día, 24/7 con quiet hours 1-7am ARG (manejados en caps.ts).',
};

export function policyForMode(mode: PublishMode): ModePolicy {
  switch (mode) {
    case 'shadow':
      return SHADOW;
    case 'soft':
      return SOFT;
    case 'full':
      return FULL;
  }
}
EOF
```

- [ ] **Step 4: Run GREEN**

```bash
pnpm test tests/publish/modes.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: typecheck + suite**

```bash
pnpm typecheck && pnpm test
```

Expected: 60 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/publish/modes.ts tests/publish/modes.test.ts
git commit -m "$(cat <<'COMMIT'
feat(publish): mode policies (shadow|soft|full)

policyForMode devuelve { canPublish, dailyCap, delaySeconds }.
Shadow nunca publica. Soft 9-22 ARG cap 3 delay 60s. Full 24/7
cap 6. Quiet hours 1-7am siguen aplicándose vía caps.ts (Fase 3).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Bloque C — Publisher worker

### Task 6: Publisher worker (consume scheduled → X → published)

**Files:**
- Create: `src/publish/publisher.ts`
- Create: `tests/publish/publisher.test.ts`

- [ ] **Step 1: Test failing (mockea X client)**

```bash
cat > tests/publish/publisher.test.ts <<'EOF'
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sql, eq } from 'drizzle-orm';
import { db } from '../../src/db/client.js';
import { botPosts } from '../../src/db/schema.js';

vi.mock('../../src/publish/x-write-client.js', () => ({
  uploadMedia: vi.fn().mockResolvedValue('media-99'),
  createTweet: vi.fn().mockResolvedValue('tweet-12345'),
}));

beforeEach(async () => {
  await db.execute(sql`DELETE FROM bot_posts WHERE caption LIKE 'test-pub-%'`);
  vi.clearAllMocks();
});

describe('runPublisher', () => {
  it('publishes scheduled posts and marks them published', async () => {
    const { runPublisher } = await import('../../src/publish/publisher.js');
    // Crear un PNG temporal pequeño
    const { writeFileSync, mkdirSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    mkdirSync(resolve(process.cwd(), 'storage/cards'), { recursive: true });
    writeFileSync(resolve(process.cwd(), 'storage/cards/test-pub.png'), Buffer.from('fakepng'));

    const [p] = await db.insert(botPosts).values({
      shape: 'market_move',
      status: 'scheduled',
      caption: 'test-pub-publish',
      cardPath: 'storage/cards/test-pub.png',
      sourceSnapshot: {},
      llmMetadata: {},
    }).returning({ id: botPosts.id });

    const stats = await runPublisher();
    expect(stats.published).toBeGreaterThanOrEqual(1);

    const [updated] = await db.select().from(botPosts).where(eq(botPosts.id, p.id));
    expect(updated.status).toBe('published' as never);
    expect(updated.xPostId).toBe('tweet-12345');
  });

  it('does not publish in shadow mode', async () => {
    process.env.PUBLISH_MODE = 'shadow';
    // Forzar reload de env (puede requerir reset cache; depende de implementación)
    // La función internamente vuelve a leer process.env.PUBLISH_MODE para esta llamada.
    const { runPublisher } = await import('../../src/publish/publisher.js');
    const stats = await runPublisher();
    expect(stats.published).toBe(0);
    expect(stats.skippedShadow).toBeGreaterThanOrEqual(0);
    process.env.PUBLISH_MODE = 'full'; // restore
  });

  it('honors KILL_SWITCH', async () => {
    process.env.KILL_SWITCH = 'true';
    const { runPublisher } = await import('../../src/publish/publisher.js');
    const stats = await runPublisher();
    expect(stats.published).toBe(0);
    process.env.KILL_SWITCH = 'false';
  });
});
EOF
```

- [ ] **Step 2: Run RED**

```bash
pnpm test tests/publish/publisher.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement publisher**

```bash
cat > src/publish/publisher.ts <<'EOF'
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { botPosts } from '../db/schema.js';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';
import { uploadMedia, createTweet } from './x-write-client.js';
import { markPublished } from './transitions.js';
import { policyForMode, type PublishMode } from './modes.js';

const MAX_PER_RUN = 3;

export interface PublisherStats {
  scheduled: number;
  published: number;
  failed: number;
  skippedShadow: number;
  skippedKillSwitch: number;
  skippedMode: number;
}

export async function runPublisher(): Promise<PublisherStats> {
  const stats: PublisherStats = {
    scheduled: 0,
    published: 0,
    failed: 0,
    skippedShadow: 0,
    skippedKillSwitch: 0,
    skippedMode: 0,
  };

  // Re-leer env vars (permite override en tests via process.env)
  const mode = (process.env.PUBLISH_MODE ?? env.PUBLISH_MODE) as PublishMode;
  const killSwitch = process.env.KILL_SWITCH === 'true' || env.KILL_SWITCH;

  if (killSwitch) {
    logger.warn({ mode }, 'publisher: KILL_SWITCH active — skipping');
    return stats;
  }

  const policy = policyForMode(mode);
  if (mode === 'shadow') {
    stats.skippedShadow = await countScheduled();
    return stats;
  }
  if (!policy.canPublish(new Date())) {
    stats.skippedMode = await countScheduled();
    logger.debug({ mode }, 'publisher: outside publish window for current mode');
    return stats;
  }

  // Claim hasta MAX_PER_RUN scheduled posts (los más viejos primero)
  const scheduled = await db.execute(sql`
    SELECT id, caption, card_path FROM bot_posts
    WHERE status = 'scheduled'
    ORDER BY generated_at ASC
    LIMIT ${MAX_PER_RUN}
  `);
  stats.scheduled = scheduled.rows.length;

  for (const row of scheduled.rows as Array<{ id: number; caption: string; card_path: string }>) {
    try {
      const cardBuf = await readFile(resolve(process.cwd(), row.card_path));
      const mediaId = await uploadMedia(cardBuf, 'image/png');
      const tweetId = await createTweet({ text: row.caption, mediaIds: [mediaId] });
      await markPublished(row.id, tweetId);
      stats.published++;
    } catch (err) {
      stats.failed++;
      logger.error(
        { postId: row.id, err: (err as Error).message },
        'publisher: failed to publish',
      );
    }
  }

  logger.info({ ...stats, mode }, 'publisher: run complete');
  return stats;
}

async function countScheduled(): Promise<number> {
  const r = await db.execute(sql`SELECT COUNT(*)::int AS c FROM bot_posts WHERE status = 'scheduled'`);
  return (r.rows[0] as { c: number }).c;
}
EOF
```

- [ ] **Step 4: Run GREEN**

```bash
pnpm test tests/publish/publisher.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: typecheck + suite**

```bash
pnpm typecheck && pnpm test
```

Expected: 63 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/publish/publisher.ts tests/publish/publisher.test.ts
git commit -m "$(cat <<'COMMIT'
feat(publish): publisher worker (scheduled → X → published)

runPublisher consume hasta 3 posts scheduled por run, sube media a
X, crea tweet, marca published con x_post_id. Honra KILL_SWITCH y
PUBLISH_MODE (shadow nunca publica). Errores son por-post (no
abortan el run). Tests usan x-write-client mockeado.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

### Task 7: Soft-launch delay job (approved → scheduled tras N segundos)

**Files:**
- Modify: `src/workers/orchestrator.ts` (agregar nuevo cron)

- [ ] **Step 1: Read y modificar orchestrator**

Read `src/workers/orchestrator.ts`. Add to imports:

```ts
import { runPublisher } from '../publish/publisher.js';
import { schedulePost } from '../publish/transitions.js';
```

Agregar dentro de `main()`, antes del `logger.info('schedules registered')`:

```ts
  // Soft-launch delay: approved → scheduled tras SOFT_LAUNCH_DELAY_SEC.
  // Corre cada 30 segundos para fina-resolución. Cap implícito por la query.
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
```

(Note: `'*/30 * * * * *'` is 6-field cron with seconds. node-cron supports it.)

Y actualizar el `logger.info('schedules registered')` para mencionar:

```ts
  logger.info(
    {
      polymarket_min: env.POLYMARKET_POLL_INTERVAL_MIN,
      news_min: env.NEWS_POLL_INTERVAL_MIN,
      polls_hours: env.POLLS_POLL_INTERVAL_HOURS,
      publish_mode: env.PUBLISH_MODE,
      kill_switch: env.KILL_SWITCH,
    },
    'orchestrator: schedules registered',
  );
```

- [ ] **Step 2: Smoke test del worker boot**

```bash
pnpm worker > /tmp/fase4-boot.log 2>&1 &
WORKER_PID=$!
sleep 5
kill -INT $WORKER_PID
sleep 2
grep -E "schedules registered|publish_mode|kill_switch" /tmp/fase4-boot.log
```

Expected: log incluye `publish_mode: shadow, kill_switch: false`.

- [ ] **Step 3: typecheck + suite**

```bash
pnpm typecheck && pnpm test
```

Expected: 63 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/workers/orchestrator.ts
git commit -m "$(cat <<'COMMIT'
feat(worker): soft-launch delay + publisher schedule

Cron cada 30s mueve approved → scheduled si pasaron SOFT_LAUNCH_DELAY_SEC.
Cron cada 1min corre runPublisher (no-op en shadow). schedules
registered ahora reporta publish_mode y kill_switch.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Bloque D — Admin Web UI (Next.js)

### Task 8: Next.js scaffold + Tailwind + auth middleware

**Files:**
- Modify: `package.json` (next, react, react-dom, tailwind, postcss, autoprefixer, @types/react)
- Create: `next.config.mjs`
- Create: `tsconfig.json` (modify for Next.js JSX support — careful, the worker also uses this)
- Create: `tailwind.config.ts`
- Create: `postcss.config.mjs`
- Create: `app/layout.tsx`
- Create: `app/page.tsx` (placeholder)
- Create: `app/globals.css`
- Create: `middleware.ts`
- Create: `app/lib/auth.ts`

- [ ] **Step 1: Instalar deps Next.js**

```bash
pnpm add next@15 react@19 react-dom@19
pnpm add -D @types/react @types/react-dom tailwindcss postcss autoprefixer
```

- [ ] **Step 2: Config Tailwind**

```bash
cat > tailwind.config.ts <<'EOF'
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#000000',
        paper: '#ffffff',
        pageInk: '#1a1a1a',
        caption: '#757575',
        hairline: '#e2e8f0',
        accent: '#057dbc',
      },
      fontFamily: {
        serif: ['"Playfair Display"', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
};
export default config;
EOF

cat > postcss.config.mjs <<'EOF'
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
EOF
```

- [ ] **Step 3: Update tsconfig.json para JSX**

Read current tsconfig.json. Update compilerOptions to add:

```json
"jsx": "preserve",
"plugins": [{ "name": "next" }],
"incremental": true
```

Change `"include"` to also include `app/**/*` and `middleware.ts`:

```json
"include": ["src/**/*", "tests/**/*", "scripts/**/*", "drizzle.config.ts", "vitest.config.ts", "app/**/*", "middleware.ts", "next-env.d.ts"]
```

- [ ] **Step 4: next.config.mjs**

```bash
cat > next.config.mjs <<'EOF'
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    typedRoutes: true,
  },
  // Las imágenes de cards se sirven via API route, no via Image component
  images: { unoptimized: true },
};
export default nextConfig;
EOF
```

- [ ] **Step 5: Layout + página vacía + globals.css**

```bash
mkdir -p app
cat > app/globals.css <<'EOF'
@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  background: #ffffff;
  color: #1a1a1a;
}
EOF

cat > app/layout.tsx <<'EOF'
import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Política Bot — Admin',
  description: 'Review queue de drafts del bot',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
EOF

cat > app/page.tsx <<'EOF'
export default function Home() {
  return (
    <main className="min-h-screen p-8">
      <h1 className="font-serif text-4xl mb-4">Política Bot — Admin</h1>
      <p className="text-caption">UI placeholder. Drafts list viene en Task 9.</p>
    </main>
  );
}
EOF
```

- [ ] **Step 6: Auth middleware**

```bash
cat > middleware.ts <<'EOF'
import { NextResponse, type NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // Solo gate en admin / posts / api (no en assets)
  const path = request.nextUrl.pathname;
  if (path.startsWith('/_next/') || path === '/favicon.ico') {
    return NextResponse.next();
  }

  const expectedUser = process.env.ADMIN_BASIC_AUTH_USER;
  const expectedPass = process.env.ADMIN_BASIC_AUTH_PASS;
  if (!expectedUser || !expectedPass) {
    return new NextResponse(
      'ADMIN_BASIC_AUTH_USER y ADMIN_BASIC_AUTH_PASS no están seteadas. Configurar en .env.',
      { status: 503 },
    );
  }

  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Basic ')) {
    return new NextResponse('Unauthorized', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="politica-admin"' },
    });
  }
  const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf-8');
  const [user, pass] = decoded.split(':');
  if (user !== expectedUser || pass !== expectedPass) {
    return new NextResponse('Unauthorized', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="politica-admin"' },
    });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
EOF
```

- [ ] **Step 7: Boot Next.js**

```bash
pnpm next dev > /tmp/next-boot.log 2>&1 &
NEXT_PID=$!
sleep 8
curl -s http://localhost:3000 -u admin:changeme-en-produccion | head -3
kill $NEXT_PID
wait $NEXT_PID 2>/dev/null
```

Expected: el HTML response contiene "Política Bot — Admin". Sin auth header, devuelve 401.

- [ ] **Step 8: Agregar script next a package.json**

Read package.json. Add to scripts:

```json
"web": "next dev",
"web:build": "next build",
"web:start": "next start"
```

- [ ] **Step 9: Suite + typecheck**

```bash
pnpm typecheck && pnpm test
```

Expected: 0 errors. Tests no tocados.

- [ ] **Step 10: Commit**

```bash
git add package.json pnpm-lock.yaml next.config.mjs tsconfig.json tailwind.config.ts postcss.config.mjs app/ middleware.ts
git commit -m "$(cat <<'COMMIT'
feat(web): Next.js 15 scaffold + Tailwind + basic auth middleware

App Router en app/. Tailwind con paleta WIRED (paper white, ink, accent).
middleware.ts gate basic auth (ADMIN_BASIC_AUTH_USER/PASS) en todas
las rutas no-static. Scripts pnpm web/web:build agregados. Listo
para drafts page y actions en tasks siguientes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

### Task 9: Drafts list page

**Files:**
- Create: `app/page.tsx` (replace placeholder)
- Create: `app/components/DraftRow.tsx`
- Create: `app/api/cards/[file]/route.ts`

- [ ] **Step 1: API route para servir cards**

```bash
mkdir -p app/api/cards/\[file\]
cat > app/api/cards/\[file\]/route.ts <<'EOF'
import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  // Solo permitir paths simples que no escapen storage/cards/
  if (file.includes('..') || file.includes('/')) {
    return new NextResponse('Bad Request', { status: 400 });
  }
  try {
    const buf = await readFile(resolve(process.cwd(), 'storage/cards', file));
    return new NextResponse(buf, {
      status: 200,
      headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=60' },
    });
  } catch {
    return new NextResponse('Not Found', { status: 404 });
  }
}
EOF
```

- [ ] **Step 2: DraftRow component**

```bash
mkdir -p app/components
cat > app/components/DraftRow.tsx <<'EOF'
import { basename } from 'node:path';

export interface DraftRowProps {
  id: number;
  shape: string;
  caption: string;
  cardPath: string;
  generatedAt: Date;
  candidateFocus: string | null;
  llmSource: string | null;
}

export function DraftRow(p: DraftRowProps) {
  const cardFile = basename(p.cardPath);
  const cardUrl = `/api/cards/${encodeURIComponent(cardFile)}`;
  return (
    <a
      href={`/posts/${p.id}`}
      className="block border-b border-hairline py-4 hover:bg-paper transition-colors"
    >
      <div className="flex gap-6 items-start">
        <img src={cardUrl} alt="" className="w-48 h-27 border border-ink object-cover" />
        <div className="flex-1 min-w-0">
          <div className="font-mono text-xs uppercase tracking-wide text-caption">
            {p.shape} · #{p.id} · {p.generatedAt.toLocaleString('es-AR')}
            {p.candidateFocus ? ` · focus: ${p.candidateFocus}` : null}
            {p.llmSource ? ` · caption: ${p.llmSource}` : null}
          </div>
          <p className="font-serif text-lg mt-2 text-pageInk">{p.caption}</p>
        </div>
      </div>
    </a>
  );
}
EOF
```

- [ ] **Step 3: Drafts list page**

```bash
cat > app/page.tsx <<'EOF'
import { desc, eq } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { botPosts } from '../src/db/schema.js';
import { DraftRow } from './components/DraftRow.js';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const drafts = await db
    .select()
    .from(botPosts)
    .where(eq(botPosts.status, 'draft'))
    .orderBy(desc(botPosts.generatedAt))
    .limit(50);

  return (
    <main className="max-w-4xl mx-auto p-8">
      <header className="border-b-2 border-ink pb-4 mb-6">
        <h1 className="font-serif text-5xl">Review queue</h1>
        <div className="font-mono text-xs uppercase tracking-wide text-caption mt-2">
          {drafts.length} drafts pending · <a href="/admin" className="text-accent underline">admin</a>
        </div>
      </header>

      {drafts.length === 0 ? (
        <p className="text-caption">No hay drafts en la cola. Esperá a que los watchers detecten algo.</p>
      ) : (
        <ul>
          {drafts.map((d) => (
            <li key={d.id}>
              <DraftRow
                id={d.id}
                shape={d.shape}
                caption={d.caption}
                cardPath={d.cardPath}
                generatedAt={d.generatedAt}
                candidateFocus={d.candidateFocus}
                llmSource={(d.llmMetadata as { source?: string } | null)?.source ?? null}
              />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
EOF
```

- [ ] **Step 4: Smoke test web**

```bash
pnpm next dev > /tmp/web-drafts.log 2>&1 &
NEXT_PID=$!
sleep 8
curl -s http://localhost:3000 -u admin:changeme-en-produccion | grep -E "Review queue|drafts pending"
kill $NEXT_PID
wait $NEXT_PID 2>/dev/null
```

Expected: HTML contiene "Review queue".

- [ ] **Step 5: typecheck + suite**

```bash
pnpm typecheck && pnpm test
```

Expected: 63 tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/page.tsx app/components/ app/api/
git commit -m "$(cat <<'COMMIT'
feat(web): drafts list page + cards API route

/page.tsx lista bot_posts con status=draft (top 50). DraftRow
muestra preview de la card via /api/cards/[file]. API route sirve
PNGs desde storage/cards/ con safe path validation. Layout
broadsheet (max-w-4xl, hairline borders, font-serif headlines).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

### Task 10: Detail page + actions (approve/kill/publish-now)

**Files:**
- Create: `app/posts/[id]/page.tsx`
- Create: `app/api/posts/[id]/approve/route.ts`
- Create: `app/api/posts/[id]/kill/route.ts`
- Create: `app/api/posts/[id]/publish-now/route.ts`
- Create: `app/components/ActionButtons.tsx`

- [ ] **Step 1: Action API routes**

```bash
mkdir -p app/api/posts/\[id\]/approve app/api/posts/\[id\]/kill app/api/posts/\[id\]/publish-now

cat > app/api/posts/\[id\]/approve/route.ts <<'EOF'
import { NextResponse } from 'next/server';
import { approveDraft } from '../../../../../src/publish/transitions.js';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const numId = Number(id);
  if (!Number.isInteger(numId)) return new NextResponse('Bad id', { status: 400 });
  try {
    await approveDraft(numId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }
}
EOF

cat > app/api/posts/\[id\]/kill/route.ts <<'EOF'
import { NextResponse } from 'next/server';
import { killPost } from '../../../../../src/publish/transitions.js';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const numId = Number(id);
  if (!Number.isInteger(numId)) return new NextResponse('Bad id', { status: 400 });
  try {
    await killPost(numId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }
}
EOF

cat > app/api/posts/\[id\]/publish-now/route.ts <<'EOF'
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '../../../../../src/db/client.js';
import { botPosts } from '../../../../../src/db/schema.js';
import { approveDraft, schedulePost } from '../../../../../src/publish/transitions.js';

/**
 * Approve + schedule en una sola request — bypassa el delay de soft-launch.
 * El publisher worker hará el publish en su próximo tick.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const numId = Number(id);
  if (!Number.isInteger(numId)) return new NextResponse('Bad id', { status: 400 });
  try {
    const [p] = await db.select().from(botPosts).where(eq(botPosts.id, numId));
    if (!p) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
    if (p.status === 'draft') await approveDraft(numId);
    if (p.status === 'approved' || p.status === 'draft') await schedulePost(numId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }
}
EOF
```

- [ ] **Step 2: ActionButtons (client component)**

```bash
cat > app/components/ActionButtons.tsx <<'EOF'
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function ActionButtons({ postId, status }: { postId: number; status: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);

  async function act(action: 'approve' | 'kill' | 'publish-now'): Promise<void> {
    setLoading(action);
    const res = await fetch(`/api/posts/${postId}/${action}`, { method: 'POST' });
    setLoading(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(`Action failed: ${(body as { error?: string }).error ?? res.statusText}`);
      return;
    }
    router.refresh();
  }

  const btn = 'border-2 border-ink px-4 py-2 font-mono text-sm uppercase tracking-wide hover:bg-ink hover:text-paper transition-colors';
  const btnDanger = btn + ' border-red-700 hover:bg-red-700';

  return (
    <div className="flex gap-3 mt-6">
      {(status === 'draft') && (
        <button onClick={() => act('approve')} disabled={!!loading} className={btn}>
          {loading === 'approve' ? '…' : 'Approve'}
        </button>
      )}
      {(status === 'draft' || status === 'approved') && (
        <button onClick={() => act('publish-now')} disabled={!!loading} className={btn}>
          {loading === 'publish-now' ? '…' : 'Publish now (skip delay)'}
        </button>
      )}
      {status !== 'published' && status !== 'killed' && (
        <button onClick={() => act('kill')} disabled={!!loading} className={btnDanger}>
          {loading === 'kill' ? '…' : 'Kill'}
        </button>
      )}
    </div>
  );
}
EOF
```

- [ ] **Step 3: Detail page**

```bash
mkdir -p app/posts/\[id\]
cat > app/posts/\[id\]/page.tsx <<'EOF'
import { eq } from 'drizzle-orm';
import { basename } from 'node:path';
import Link from 'next/link';
import { db } from '../../../src/db/client.js';
import { botPosts } from '../../../src/db/schema.js';
import { ActionButtons } from '../../components/ActionButtons.js';

export const dynamic = 'force-dynamic';

export default async function PostDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const numId = Number(id);
  const [p] = await db.select().from(botPosts).where(eq(botPosts.id, numId));
  if (!p) return <main className="p-8">Not found · <Link href="/" className="text-accent underline">back</Link></main>;

  const cardFile = basename(p.cardPath);
  const cardUrl = `/api/cards/${encodeURIComponent(cardFile)}`;
  const meta = p.llmMetadata as Record<string, unknown> | null;

  return (
    <main className="max-w-4xl mx-auto p-8">
      <Link href="/" className="font-mono text-xs uppercase tracking-wide text-accent underline">← back to queue</Link>

      <header className="border-b-2 border-ink pb-4 mb-6 mt-4">
        <div className="font-mono text-xs uppercase tracking-wide text-caption">
          #{p.id} · {p.shape} · status={p.status} · {p.generatedAt.toLocaleString('es-AR')}
          {p.candidateFocus ? ` · focus: ${p.candidateFocus}` : null}
        </div>
      </header>

      <img src={cardUrl} alt="" className="border-2 border-ink w-full mb-6" />

      <section className="mb-6">
        <div className="font-mono text-xs uppercase tracking-wide text-caption mb-2">Caption ({p.caption.length} chars)</div>
        <p className="font-serif text-2xl leading-snug">{p.caption}</p>
      </section>

      <ActionButtons postId={p.id} status={p.status} />

      {p.status === 'published' && p.xPostId && (
        <p className="mt-4 font-mono text-xs uppercase tracking-wide">
          Published as <a className="text-accent underline" href={`https://x.com/i/status/${p.xPostId}`} target="_blank" rel="noreferrer">{p.xPostId}</a>
        </p>
      )}

      <details className="mt-8">
        <summary className="font-mono text-xs uppercase tracking-wide text-caption cursor-pointer">LLM metadata</summary>
        <pre className="text-xs mt-2 bg-hairline/30 p-4 overflow-auto">{JSON.stringify(meta, null, 2)}</pre>
      </details>

      <details className="mt-4">
        <summary className="font-mono text-xs uppercase tracking-wide text-caption cursor-pointer">Source snapshot</summary>
        <pre className="text-xs mt-2 bg-hairline/30 p-4 overflow-auto">{JSON.stringify(p.sourceSnapshot, null, 2)}</pre>
      </details>
    </main>
  );
}
EOF
```

- [ ] **Step 4: Smoke (manual: arrancá `pnpm web` y navegá)**

```bash
echo "Run: pnpm web — luego abrí http://localhost:3000 con basic auth"
echo "1. Verificá que la lista renderiza drafts (puede estar vacía si no hay)"
echo "2. Clickeá un draft para ver detalle"
echo "3. Probá los botones approve/kill/publish-now"
```

(Skip programmatic verification — esto es manual.)

- [ ] **Step 5: typecheck + suite**

```bash
pnpm typecheck && pnpm test
```

Expected: 63 tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/posts/ app/api/posts/ app/components/ActionButtons.tsx
git commit -m "$(cat <<'COMMIT'
feat(web): post detail page + approve/kill/publish-now actions

/posts/[id] muestra card + caption + metadata. ActionButtons es
client component con fetch a 3 API routes. publish-now bypasea
soft-launch delay (approve + schedule). Source snapshot y llm
metadata expandibles para audit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

### Task 11: Admin page (kill switch toggle + mode selector)

**Files:**
- Create: `app/admin/page.tsx`
- Create: `app/admin/actions.ts`
- Create: `app/api/admin/state/route.ts`

Para mantener el toggle persistente, usamos una tabla nueva `admin_state(key TEXT PRIMARY KEY, value TEXT, updated_at TIMESTAMP)` o aprovechamos la simplicidad: que kill_switch + mode vivan en `events` con un type especial. **Más simple**: tabla nueva con UNA fila singleton.

- [ ] **Step 1: Schema migration para admin_state**

Read `src/db/schema.ts`. Append:

```ts
// ──────────────────────────────────────────────────────────────────
// Admin state (singleton key-value para runtime toggles)
// ──────────────────────────────────────────────────────────────────

export const adminState = pgTable('admin_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
```

```bash
pnpm db:generate
pnpm db:migrate
```

- [ ] **Step 2: API route GET/POST state**

```bash
mkdir -p app/api/admin/state
cat > app/api/admin/state/route.ts <<'EOF'
import { NextResponse } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../../../src/db/client.js';
import { adminState } from '../../../../src/db/schema.js';

const KEYS = ['kill_switch', 'publish_mode'] as const;

export async function GET(): Promise<NextResponse> {
  const rows = await db.select().from(adminState);
  const result: Record<string, string> = {};
  for (const r of rows) result[r.key] = r.value;
  // Defaults si la fila no existe todavía
  result.kill_switch = result.kill_switch ?? 'false';
  result.publish_mode = result.publish_mode ?? process.env.PUBLISH_MODE ?? 'shadow';
  return NextResponse.json(result);
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as { key?: string; value?: string };
  if (!body.key || !KEYS.includes(body.key as (typeof KEYS)[number])) {
    return NextResponse.json({ error: 'invalid key' }, { status: 400 });
  }
  if (typeof body.value !== 'string') {
    return NextResponse.json({ error: 'invalid value' }, { status: 400 });
  }
  if (body.key === 'publish_mode' && !['shadow', 'soft', 'full'].includes(body.value)) {
    return NextResponse.json({ error: 'invalid mode' }, { status: 400 });
  }
  if (body.key === 'kill_switch' && !['true', 'false'].includes(body.value)) {
    return NextResponse.json({ error: 'invalid bool' }, { status: 400 });
  }

  await db
    .insert(adminState)
    .values({ key: body.key, value: body.value })
    .onConflictDoUpdate({
      target: adminState.key,
      set: { value: body.value, updatedAt: new Date() },
    });
  return NextResponse.json({ ok: true });
}
EOF
```

- [ ] **Step 3: Modify `runPublisher` to read from admin_state (override env)**

Read `src/publish/publisher.ts`. Update the env reading section to first check admin_state:

```ts
import { adminState } from '../db/schema.js';

async function loadAdminOverrides(): Promise<{ mode?: string; killSwitch?: boolean }> {
  const rows = await db.select().from(adminState);
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  return {
    mode: map.publish_mode,
    killSwitch: map.kill_switch === 'true',
  };
}
```

Then in `runPublisher`, replace the env-only read with:

```ts
  const overrides = await loadAdminOverrides();
  const mode = (overrides.mode ?? process.env.PUBLISH_MODE ?? env.PUBLISH_MODE) as PublishMode;
  const killSwitch = overrides.killSwitch ?? (process.env.KILL_SWITCH === 'true' || env.KILL_SWITCH);
```

(El admin web override prevalece sobre env vars.)

- [ ] **Step 4: Admin page**

```bash
mkdir -p app/admin
cat > app/admin/page.tsx <<'EOF'
'use client';

import { useEffect, useState } from 'react';

export default function AdminPage() {
  const [state, setState] = useState<{ kill_switch?: string; publish_mode?: string }>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/admin/state').then((r) => r.json()).then(setState);
  }, []);

  async function update(key: 'kill_switch' | 'publish_mode', value: string): Promise<void> {
    setSaving(true);
    const res = await fetch('/api/admin/state', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, value }),
    });
    setSaving(false);
    if (!res.ok) return alert('Failed to save');
    setState((s) => ({ ...s, [key]: value }));
  }

  const killOn = state.kill_switch === 'true';

  return (
    <main className="max-w-2xl mx-auto p-8">
      <h1 className="font-serif text-4xl border-b-2 border-ink pb-4 mb-6">Admin</h1>

      <section className="mb-8">
        <div className="font-mono text-xs uppercase tracking-wide text-caption mb-2">Kill switch</div>
        <button
          onClick={() => update('kill_switch', killOn ? 'false' : 'true')}
          disabled={saving}
          className={
            killOn
              ? 'border-2 border-red-700 bg-red-700 text-paper px-6 py-3 font-mono uppercase tracking-wide'
              : 'border-2 border-ink px-6 py-3 font-mono uppercase tracking-wide hover:bg-ink hover:text-paper'
          }
        >
          {killOn ? '🚨 KILL SWITCH ACTIVE — click to disable' : 'Kill switch off (click to activate)'}
        </button>
        <p className="text-caption text-sm mt-2">
          Mientras esté activo, ningún post se publica a X. Drafts se siguen generando normalmente.
        </p>
      </section>

      <section className="mb-8">
        <div className="font-mono text-xs uppercase tracking-wide text-caption mb-2">Publish mode</div>
        <div className="flex gap-3">
          {(['shadow', 'soft', 'full'] as const).map((m) => (
            <button
              key={m}
              onClick={() => update('publish_mode', m)}
              disabled={saving}
              className={
                state.publish_mode === m
                  ? 'border-2 border-ink bg-ink text-paper px-4 py-2 font-mono uppercase tracking-wide'
                  : 'border-2 border-ink px-4 py-2 font-mono uppercase tracking-wide hover:bg-ink hover:text-paper'
              }
            >
              {m}
            </button>
          ))}
        </div>
        <p className="text-caption text-sm mt-2">
          Shadow: no publica. Soft: 9-22hs ARG, cap 3, delay 60s. Full: 24/7 con quiet hours, cap 6.
        </p>
      </section>

      <a href="/" className="font-mono text-xs uppercase tracking-wide text-accent underline">← back to queue</a>
    </main>
  );
}
EOF
```

- [ ] **Step 5: Smoke manual**

Manual:
- `pnpm web`
- abrir `http://localhost:3000/admin`
- togglear kill switch — verificar que vuelve correctamente al refresh
- cambiar mode entre shadow/soft/full
- chequeá DB: `docker exec politica-pg psql -U politica -d politica -c "SELECT * FROM admin_state;"`

- [ ] **Step 6: typecheck + suite**

```bash
pnpm typecheck && pnpm test
```

Expected: 63 tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.ts src/db/migrations/ src/publish/publisher.ts app/admin/ app/api/admin/
git commit -m "$(cat <<'COMMIT'
feat(web): admin page (kill switch + mode selector)

Tabla admin_state (key/value singleton). API GET/POST /api/admin/state
con validación. runPublisher prefiere admin overrides sobre env vars
(podés cambiar mode en runtime sin reiniciar el worker). UI minimal:
kill switch toggle rojo + 3 botones mode mutuamente exclusivos.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Bloque E — CLI admin

### Task 12: scripts/admin.ts (paralelo a la web UI)

**Files:**
- Create: `scripts/admin.ts`

- [ ] **Step 1: Implement CLI**

```bash
cat > scripts/admin.ts <<'EOF'
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
import { eq, desc, sql } from 'drizzle-orm';
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
EOF
```

- [ ] **Step 2: Smoke**

```bash
pnpm tsx scripts/admin.ts list
pnpm tsx scripts/admin.ts mode shadow
pnpm tsx scripts/admin.ts kill-switch on
pnpm tsx scripts/admin.ts kill-switch off
docker exec politica-pg psql -U politica -d politica -c "SELECT * FROM admin_state;"
```

Expected: comandos corren sin error, admin_state tiene las dos keys.

- [ ] **Step 3: Commit**

```bash
git add scripts/admin.ts
git commit -m "$(cat <<'COMMIT'
feat(scripts): admin CLI (list/show/approve/kill/publish-now/mode/kill-switch)

Paralelo a la web UI. Útil para automation o workflows desde
terminal sin tener que abrir browser. Comparte db client + pool con
el resto del proyecto, cierra pool en finally.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Bloque F — Wiring + E2E

### Task 13: README + E2E con publish real

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README**

Read `README.md`. Replace the "Estado" section:

```markdown
## Estado

**Fase 4 — Publisher + Admin** (en curso). Pipeline completo: Polymarket + News + Polls → Watchers → Trigger Engine → Cards + Captions → bot_posts(status='draft') → Admin (web/CLI) review → Publisher → X. Tres modos de publicación (shadow/soft/full) con kill switch global. Sitio público (fase 5) pendiente.

## URLs

- Worker: `pnpm worker` (no port, just logs)
- Admin web: `pnpm web` → http://localhost:3000 (basic auth)
- Drafts CLI: `pnpm tsx scripts/admin.ts list`
```

Y agregar a "Comandos útiles":

```markdown
# Publisher / admin
pnpm web                           # Next.js dev server (admin UI)
pnpm web:build && pnpm web:start   # admin UI prod build
pnpm tsx scripts/admin.ts list     # drafts queue
pnpm tsx scripts/admin.ts approve 42
pnpm tsx scripts/admin.ts mode soft       # shadow|soft|full
pnpm tsx scripts/admin.ts kill-switch on  # bloquea publicación
```

- [ ] **Step 2: E2E shadow mode (no publish real)**

```bash
docker compose down -v
docker compose up -d
sleep 5
pnpm db:migrate
pnpm tsx scripts/seed-pollsters.ts

# Default mode = shadow (.env). Forzar un evento manualmente para que haya draft:
pnpm tsx -e "
import { emitEvent } from './src/trigger/events.js';
await emitEvent('MARKET_MOVE', { marketId: 'e2e-1', candidate: 'Milei', priceNow: 0.55, priceThen: 0.50, deltaPct: 5, windowHours: 6 });
"

pnpm worker > /tmp/e2e4.log 2>&1 &
WORKER_PID=$!
sleep 180  # 3 min: trigger orchestrator (cada 2min) procesa el evento, soft-launch (cada 30s) y publisher (cada 1min) corren
kill -INT $WORKER_PID
sleep 3
tail -40 /tmp/e2e4.log
```

Expected: log muestra:
- trigger orchestrator: drafted 1 post
- soft-launch-delay: corre, no encuentra approved (porque nadie aprobó manualmente)
- publisher: corre en shadow mode, skipea

```bash
docker exec politica-pg psql -U politica -d politica -c "
  SELECT id, shape, status, candidate_focus FROM bot_posts ORDER BY id DESC LIMIT 3;
"
```

Expected: 1 fila en status='draft'.

- [ ] **Step 3: E2E aprobando via CLI**

```bash
# Aprobar el draft (ID del paso anterior)
pnpm tsx scripts/admin.ts list
# Suponé que el id es 1
pnpm tsx scripts/admin.ts mode soft
pnpm tsx scripts/admin.ts publish-now 1

# Verificar que pasó a scheduled
docker exec politica-pg psql -U politica -d politica -c "SELECT id, status FROM bot_posts WHERE id = 1;"
```

Expected: status='scheduled'.

**Importante**: si la cuenta X NO está reservada o el bearer token NO tiene write permissions, el publisher fallará al hacer `createTweet`. Ese fallo es esperado para el primer test E2E. Verificá con:

```bash
docker exec politica-pg psql -U politica -d politica -c "SELECT id, status FROM bot_posts WHERE id = 1;"
# status seguirá 'scheduled' (no se promovió a published por el fail)
```

Si querés validar el publish path sin postear de verdad, mockeá manualmente:

```bash
docker exec politica-pg psql -U politica -d politica -c "
  UPDATE bot_posts SET status='published', x_post_id='dry-run-test', published_at=NOW() WHERE id=1;
"
```

- [ ] **Step 4: typecheck + tests final**

```bash
pnpm typecheck && pnpm test
```

Expected: 63 tests pass.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "$(cat <<'COMMIT'
docs: README updates for Fase 4 (publisher + admin)

E2E validation: shadow mode genera drafts pero no publica. Soft
mode + admin CLI publish-now lo lleva hasta scheduled. createTweet
falla gracefully si no hay write permissions en la X app.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Cierre de Fase 4

- [ ] **Verificación final**
  - `pnpm typecheck` y `pnpm test` pasan
  - `pnpm worker` arranca sin errores y reporta `publish_mode: shadow, kill_switch: false` en schedules registered
  - `pnpm web` levanta en localhost:3000 con basic auth
  - Admin UI `/admin` muestra kill switch + mode selector funcionales
  - CLI admin: `list`, `approve`, `kill`, `publish-now`, `mode`, `kill-switch` todos funcionan
- [ ] **Pendientes operacionales para Fase 5**:
  - X account registration + bio + pinned tweet con disclosure de bot
  - Persistir patch de @shuding/opentype.js con `pnpm patch`
  - Migración de admin auth de basic-auth → algo más serio (NextAuth con magic link?) cuando empieces a operar a régimen
  - Pollster handles correctos (todavía pendiente desde Fase 2)

**Output operacional**: el bot puede publicar a X (cuando vos le das green light). Pipeline completo de datos → triggers → drafts → review (web/CLI) → published. Listo para empezar a operar en shadow mode una semana o dos antes de pasar a soft launch real.
