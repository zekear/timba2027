# Política Bot — Fase 2: Polls Ingestion (X API + LLM Vision)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capturar encuestas argentinas automáticamente desde las cuentas X de las encuestadoras, extraer estructura via LLM-vision, y guardarlas en Postgres con provenance + confidence. También aplicar hardening pendiente de Fase 1 y migrar el transporte LLM de CLI a SDK.

**Architecture:** Worker monitorea ~10 cuentas X cada 6 hs vía pay-per-use API. Filtro grueso por keywords descarta el 80%; lo que queda pasa por classifier (Claude Haiku) y, si es encuesta, por vision extractor (Claude Sonnet con imagen base64 inline). Resultado validado con zod entra a `polls` con `confidence` (alto/medio/bajo) y `status` (pending_review/approved/auto_approved). El review queue existe como columnas en DB + CLI para inspeccionar; la UI viene en Fase 4.

**Tech Stack:** TypeScript, `@anthropic-ai/sdk` (reemplaza CLI), `node:fetch` (X API), zod, Drizzle ORM. Sin nuevas dependencies de runtime más allá del SDK de Anthropic.

**Tiempo estimado:** 2-3 semanas a 8-10 hs/semana.

**Pre-requisitos:**
- Fase 1 completa y mergeada a main
- Cuenta X Developer activa con pay-per-use credits comprados
- Bearer token de X API en `.env` como `X_API_BEARER_TOKEN`
- API key de Anthropic en `.env` como `ANTHROPIC_API_KEY` (para SDK transport)

---

## Estructura de archivos al final de la Fase 2

```
src/
├── llm/
│   ├── types.ts                   (sin cambios)
│   ├── cli.ts                     (queda como fallback)
│   ├── sdk.ts                     ★ nuevo
│   └── index.ts                   (factory ahora soporta sdk)
├── db/
│   ├── schema.ts                  (+ pollsters, polls)
│   └── migrations/0001_*.sql      ★ nueva migración
├── sources/
│   ├── polymarket/                (sin cambios)
│   ├── news/
│   │   ├── ingest.ts              (timeout en fetch)
│   │   └── tagger.ts              (tests nuevos)
│   └── polls/                     ★ nueva carpeta
│       ├── pollsters.ts           (lista curada de cuentas)
│       ├── x-client.ts            (X API: auth + user-timeline)
│       ├── classifier.ts          (LLM Haiku: ¿es encuesta?)
│       ├── extractor.ts           (LLM Sonnet vision: extraer estructura)
│       ├── pipeline.ts            (orquesta classifier → extractor → insert)
│       └── ingest.ts              (worker: fetch all pollsters → pipeline)
├── workers/
│   └── orchestrator.ts            (+ pool cleanup, + polls schedule)
└── lib/
    └── http.ts                    ★ nuevo (fetchWithTimeout helper)
scripts/
└── review-polls.ts                ★ nuevo (CLI para inspeccionar review queue)
tests/
├── llm/
│   ├── cli.test.ts                (sin cambios)
│   └── sdk.test.ts                ★ nuevo
├── sources/
│   ├── news/
│   │   └── tagger.test.ts         ★ nuevo
│   └── polls/
│       ├── x-client.test.ts       ★ nuevo
│       ├── classifier.test.ts     ★ nuevo
│       └── extractor.test.ts      ★ nuevo
└── fixtures/
    ├── x-timeline.json            ★ nuevo
    ├── poll-image-opinaia.png     ★ nuevo
    ├── llm-tag-clean.txt          ★ nuevo
    ├── llm-tag-prose-wrapped.txt  ★ nuevo
    └── llm-tag-malformed.txt      ★ nuevo
```

---

## Bloque A — Hardening de Fase 1

### Task 1: Fetch timeouts en pipelines de Polymarket y News

Sin esto, un endpoint colgado bloquea el slot del singleflight indefinidamente y los cron ticks subsiguientes se descartan en silencio.

**Files:**
- Create: `src/lib/http.ts`
- Modify: `src/sources/polymarket/client.ts`
- Modify: `src/sources/news/ingest.ts`
- Test: `tests/lib/http.test.ts`

- [ ] **Step 1: Test failing del helper**

```bash
mkdir -p tests/lib
cat > tests/lib/http.test.ts <<'EOF'
import { describe, it, expect } from 'vitest';
import { fetchWithTimeout } from '../../src/lib/http.js';

describe('fetchWithTimeout', () => {
  it('aborts when the server is slower than the timeout', async () => {
    // httpbin /delay/5 espera 5s antes de responder; timeout 200ms debe abortar.
    await expect(
      fetchWithTimeout('https://httpbin.org/delay/5', { timeoutMs: 200 }),
    ).rejects.toThrow(/timeout|abort/i);
  }, 10_000);

  it('returns the response when the server is fast enough', async () => {
    const res = await fetchWithTimeout('https://httpbin.org/status/200', { timeoutMs: 5_000 });
    expect(res.ok).toBe(true);
  }, 10_000);
});
EOF
```

- [ ] **Step 2: Run RED**

```bash
pnpm test tests/lib/http.test.ts
```

Expected: FAIL "Cannot find module".

- [ ] **Step 3: Implementar el helper**

```bash
cat > src/lib/http.ts <<'EOF'
/**
 * fetch con timeout duro vía AbortController.
 * Si el servidor no responde en `timeoutMs`, aborta y rechaza con LLMError-like message.
 *
 * Uso:
 *   const res = await fetchWithTimeout(url, { timeoutMs: 10_000, headers });
 */
export interface FetchWithTimeoutOpts extends RequestInit {
  timeoutMs: number;
}

export async function fetchWithTimeout(
  url: string,
  opts: FetchWithTimeoutOpts,
): Promise<Response> {
  const { timeoutMs, signal: externalSignal, ...rest } = opts;
  const controller = new AbortController();

  // Si el caller también pasó un signal, conectamos los dos abort sources.
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort(externalSignal.reason);
    else externalSignal.addEventListener('abort', () => controller.abort(externalSignal.reason));
  }

  const timer = setTimeout(() => {
    controller.abort(new Error(`fetch timeout after ${timeoutMs}ms: ${url}`));
  }, timeoutMs);

  try {
    return await fetch(url, { ...rest, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
EOF
```

- [ ] **Step 4: Run GREEN**

```bash
pnpm test tests/lib/http.test.ts
```

Expected: 2 tests passed (puede tardar 5-10s; el primer test depende de httpbin).

- [ ] **Step 5: Modificar Polymarket client para usar el helper**

```bash
# Ver el archivo actual primero:
cat src/sources/polymarket/client.ts
```

Reemplazar:
```ts
const res = await fetch(url, { headers: { accept: 'application/json' } });
```

por:
```ts
const res = await fetchWithTimeout(url, {
  timeoutMs: 15_000,
  headers: { accept: 'application/json' },
});
```

Y agregar el import al tope:
```ts
import { fetchWithTimeout } from '../../lib/http.js';
```

- [ ] **Step 6: Modificar news ingest para usar el helper**

En `src/sources/news/ingest.ts`, reemplazar el helper local:
```ts
async function fetchFeed(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { accept: 'application/rss+xml,application/xml,*/*' },
  });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.text();
}
```

por:
```ts
async function fetchFeed(url: string): Promise<string> {
  const res = await fetchWithTimeout(url, {
    timeoutMs: 15_000,
    headers: { accept: 'application/rss+xml,application/xml,*/*' },
  });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.text();
}
```

Y agregar el import:
```ts
import { fetchWithTimeout } from '../../lib/http.js';
```

- [ ] **Step 7: Verificar que todo sigue compilando + tests**

```bash
pnpm typecheck && pnpm test
```

Expected: typecheck pasa, todos los tests existentes siguen pasando + los 2 nuevos del helper.

- [ ] **Step 8: Commit**

```bash
git add src/lib/http.ts src/sources/polymarket/client.ts src/sources/news/ingest.ts tests/lib/
git commit -m "$(cat <<'EOF'
fix: agregar fetch timeouts a Polymarket y RSS

fetchWithTimeout helper en src/lib/http.ts con AbortController.
Sin esto un endpoint colgado bloqueaba el slot del singleflight
indefinidamente y los siguientes cron ticks se descartaban en silencio.
Timeout default 15s para ambos pipelines.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Pool cleanup en SIGTERM y SIGINT

El `pg.Pool` no se cierra en shutdown — conexiones quedan en `idle in transaction` hasta que Postgres las recicla. Crítico para VPS.

**Files:**
- Modify: `src/db/client.ts`
- Modify: `src/workers/orchestrator.ts`

- [ ] **Step 1: Exportar `pool` desde `client.ts`**

Ver el archivo actual y modificarlo:

```bash
cat src/db/client.ts
```

Reemplazar:
```ts
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

export const db = drizzle(pool, { schema });
export type DB = typeof db;
```

por:
```ts
export const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

export const db = drizzle(pool, { schema });
export type DB = typeof db;
```

(Solo agrega `export` adelante de `const pool`.)

- [ ] **Step 2: Drenar pool en orchestrator antes de exit**

Ver el archivo actual y modificarlo:

```bash
cat src/workers/orchestrator.ts | tail -15
```

Reemplazar el bloque final de SIGTERM:
```ts
// Graceful shutdown — node-cron no tiene cleanup explícito; basta con que el proceso muera.
process.on('SIGTERM', () => {
  logger.info('orchestrator: SIGTERM received, exiting');
  process.exit(0);
});
```

por:
```ts
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
```

Y agregar el import al tope (en la sección de imports existentes):
```ts
import { pool } from '../db/client.js';
```

- [ ] **Step 3: Smoke test**

```bash
pnpm worker > /tmp/shutdown-test.log 2>&1 &
WORKER_PID=$!
sleep 5
kill -INT $WORKER_PID
sleep 2
tail -5 /tmp/shutdown-test.log
```

Expected: logs muestran "signal received" + "pool drained" + proceso terminó.

- [ ] **Step 4: Typecheck + tests**

```bash
pnpm typecheck && pnpm test
```

Expected: pasa todo.

- [ ] **Step 5: Commit**

```bash
git add src/db/client.ts src/workers/orchestrator.ts
git commit -m "$(cat <<'EOF'
fix: drenar pg.Pool en shutdown (SIGTERM/SIGINT)

Sin pool.end() las conexiones quedan en 'idle in transaction' hasta
que Postgres las recicla — problema real en VPS donde hay otros
proyectos compartiendo el server. shutdown() es async y handlea
ambos signals; SIGINT antes solo cerraba abruptamente con Ctrl+C.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Tests para tagger.ts (extractJson + zod)

`tagger.ts` es el componente más sensible: LLM output → DB. El final reviewer lo flagueó por falta de tests.

**Files:**
- Create: `tests/fixtures/llm-tag-clean.txt`
- Create: `tests/fixtures/llm-tag-prose-wrapped.txt`
- Create: `tests/fixtures/llm-tag-malformed.txt`
- Create: `tests/sources/news/tagger.test.ts`
- Modify: `src/sources/news/tagger.ts` (exportar `extractJson` para testearlo)

- [ ] **Step 1: Crear fixtures de output del LLM**

```bash
mkdir -p tests/fixtures

cat > tests/fixtures/llm-tag-clean.txt <<'EOF'
{"candidates": ["Javier Milei"], "category": "gobierno", "relevance": 0.65}
EOF

cat > tests/fixtures/llm-tag-prose-wrapped.txt <<'EOF'
Aquí está el resultado del análisis:

```json
{"candidates": ["Milei", "Kicillof"], "category": "campania", "relevance": 0.8}
```

Espero que sea útil.
EOF

cat > tests/fixtures/llm-tag-malformed.txt <<'EOF'
No hay JSON aquí, solo prosa que no contiene datos estructurados.
EOF
```

- [ ] **Step 2: Exportar `extractJson` desde tagger.ts**

En `src/sources/news/tagger.ts`, cambiar:

```ts
function extractJson(raw: string): unknown {
```

por:

```ts
export function extractJson(raw: string): unknown {
```

(Solo agregar `export`.)

- [ ] **Step 3: Escribir tests (failing por archivo no existir)**

```bash
mkdir -p tests/sources/news
cat > tests/sources/news/tagger.test.ts <<'EOF'
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { extractJson } from '../../../src/sources/news/tagger.js';
import { z } from 'zod';

const tagSchema = z.object({
  candidates: z.array(z.string()),
  category: z.enum(['campania', 'gobierno', 'economia', 'escandalo', 'debate', 'otro']),
  relevance: z.number().min(0).max(1),
});

describe('extractJson', () => {
  it('parses clean JSON output', () => {
    const raw = readFileSync('tests/fixtures/llm-tag-clean.txt', 'utf-8');
    const json = extractJson(raw);
    const parsed = tagSchema.parse(json);
    expect(parsed.candidates).toEqual(['Javier Milei']);
    expect(parsed.category).toBe('gobierno');
    expect(parsed.relevance).toBeCloseTo(0.65);
  });

  it('extracts JSON from prose-wrapped output (markdown fence + comments)', () => {
    const raw = readFileSync('tests/fixtures/llm-tag-prose-wrapped.txt', 'utf-8');
    const json = extractJson(raw);
    const parsed = tagSchema.parse(json);
    expect(parsed.candidates).toEqual(['Milei', 'Kicillof']);
    expect(parsed.category).toBe('campania');
  });

  it('throws on output without any JSON', () => {
    const raw = readFileSync('tests/fixtures/llm-tag-malformed.txt', 'utf-8');
    expect(() => extractJson(raw)).toThrow(/no json/i);
  });

  it('throws on JSON-shaped but invalid-against-schema output', () => {
    // Tipo número fuera de rango — extractJson lo retorna OK; zod debe rechazarlo.
    const raw = '{"candidates": [], "category": "otro", "relevance": 1.5}';
    const json = extractJson(raw);
    expect(() => tagSchema.parse(json)).toThrow();
  });
});
EOF
```

- [ ] **Step 4: Run RED**

```bash
pnpm test tests/sources/news/tagger.test.ts
```

Expected: PASS si `extractJson` ya estaba bien (Task del export es trivial). Si falla, revisar el path del import.

- [ ] **Step 5: (No GREEN porque el código ya existe). Verificar que pasa.**

Si los 4 tests pasan, ya está. Si alguno falla, corregir `extractJson` para que el caso falle correctamente.

- [ ] **Step 6: Run de la suite completa**

```bash
pnpm test && pnpm typecheck
```

Expected: 12 tests passed (8 anteriores + 4 nuevos), typecheck limpio.

- [ ] **Step 7: Commit**

```bash
git add tests/fixtures/llm-tag-*.txt tests/sources/news/tagger.test.ts src/sources/news/tagger.ts
git commit -m "$(cat <<'EOF'
test(news): cobertura para extractJson + zod schema del tagger

4 tests: JSON limpio, JSON envuelto en prosa con markdown fence,
output sin JSON, JSON mal-formado contra zod. Final reviewer de
fase 1 flagueó el tagger como el componente más sensible (LLM→DB)
sin tests; este commit cierra ese gap.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Bloque B — Migración a SDK

### Task 4: Implementar `ClaudeSDKClient`

Vision con CLI requiere escribir cada imagen a `/tmp` y referenciarla con `@path` — frágil y lento. SDK soporta image inline en base64.

**Files:**
- Modify: `package.json` (agregar `@anthropic-ai/sdk`)
- Modify: `src/lib/env.ts` (agregar `ANTHROPIC_API_KEY`)
- Modify: `.env.example` (agregar `ANTHROPIC_API_KEY=`)
- Create: `src/llm/sdk.ts`
- Modify: `src/llm/index.ts` (registrar SDK en factory)
- Create: `tests/llm/sdk.test.ts`

- [ ] **Step 1: Instalar SDK**

```bash
pnpm add @anthropic-ai/sdk
```

- [ ] **Step 2: Agregar ANTHROPIC_API_KEY al env loader**

Modificar `src/lib/env.ts` — en el `z.object({...})`, agregar:

```ts
ANTHROPIC_API_KEY: z.string().optional(),
```

(Optional: porque para CLI transport no se necesita. SDK transport falla si no está, lo manejamos abajo.)

- [ ] **Step 3: Agregar la variable a `.env.example`**

Append a `.env.example`:

```bash
cat >> .env.example <<'EOF'

# Anthropic SDK (opcional si LLM_TRANSPORT=cli)
ANTHROPIC_API_KEY=
EOF
```

Y a tu `.env` real, agregar la API key cuando la tengas. Conseguila en https://console.anthropic.com/.

- [ ] **Step 4: Implementar SDK transport**

```bash
cat > src/llm/sdk.ts <<'EOF'
import Anthropic from '@anthropic-ai/sdk';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';
import { LLMError, type LLMClient, type LLMModel } from './types.js';

const MODEL_IDS: Record<LLMModel, string> = {
  haiku: 'claude-haiku-4-5',
  sonnet: 'claude-sonnet-4-6',
};

export class ClaudeSDKClient implements LLMClient {
  private readonly client: Anthropic;
  private readonly defaultModel: LLMModel;

  constructor(opts: { apiKey?: string; defaultModel?: LLMModel } = {}) {
    const apiKey = opts.apiKey ?? env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new LLMError('ANTHROPIC_API_KEY no está set; SDK transport requiere la key');
    }
    this.client = new Anthropic({ apiKey });
    this.defaultModel = opts.defaultModel ?? 'haiku';
  }

  async classify(prompt: string, opts: { model?: LLMModel } = {}): Promise<string> {
    return this.complete(prompt, opts.model ?? this.defaultModel);
  }

  async generateText(prompt: string, opts: { model?: LLMModel } = {}): Promise<string> {
    return this.complete(prompt, opts.model ?? this.defaultModel);
  }

  async extractFromImage(
    prompt: string,
    image: Buffer,
    opts: { model?: LLMModel } = {},
  ): Promise<string> {
    const model = opts.model ?? 'sonnet';
    const response = await this.client.messages.create({
      model: MODEL_IDS[model],
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: image.toString('base64') },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
    });
    return extractText(response);
  }

  private async complete(prompt: string, model: LLMModel): Promise<string> {
    try {
      const response = await this.client.messages.create({
        model: MODEL_IDS[model],
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      });
      return extractText(response);
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'sdk: completion failed');
      throw new LLMError(`SDK completion failed: ${(err as Error).message}`, err);
    }
  }
}

function extractText(response: Anthropic.Message): string {
  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
  if (!text) {
    throw new LLMError(`SDK response had no text content: ${JSON.stringify(response.content)}`);
  }
  return text;
}
EOF
```

- [ ] **Step 5: Registrar SDK en el factory**

Modificar `src/llm/index.ts`:

```ts
import { env } from '../lib/env.js';
import { ClaudeCLIClient } from './cli.js';
import { ClaudeSDKClient } from './sdk.js';
import type { LLMClient } from './types.js';

function createClient(): LLMClient {
  switch (env.LLM_TRANSPORT) {
    case 'cli':
      return new ClaudeCLIClient();
    case 'sdk':
      return new ClaudeSDKClient();
  }
}

export const llm: LLMClient = createClient();
export type { LLMClient } from './types.js';
```

(Agrega el import de `ClaudeSDKClient` y el `case 'sdk'` que antes lanzaba.)

- [ ] **Step 6: Tests del SDK contra API real**

```bash
cat > tests/llm/sdk.test.ts <<'EOF'
import { describe, it, expect } from 'vitest';
import { ClaudeSDKClient } from '../../src/llm/sdk.js';
import { env } from '../../src/lib/env.js';

const skipIfNoKey = env.ANTHROPIC_API_KEY ? describe : describe.skip;

skipIfNoKey('ClaudeSDKClient (requires ANTHROPIC_API_KEY)', () => {
  it('classify returns text', async () => {
    const client = new ClaudeSDKClient();
    const result = await client.classify('Respondé únicamente con la palabra "ok".');
    expect(result.toLowerCase()).toContain('ok');
  }, 30_000);

  it('generateText returns non-empty string', async () => {
    const client = new ClaudeSDKClient();
    const result = await client.generateText('Decí "hola" en una sola palabra.');
    expect(result.length).toBeGreaterThan(0);
  }, 30_000);

  it('extractFromImage returns text describing the image', async () => {
    // Imagen sintética de 1x1 px verde, base64 hardcoded.
    const greenPxPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNg+M/wHwAFAAH/q842iQAAAABJRU5ErkJggg==',
      'base64',
    );
    const client = new ClaudeSDKClient();
    const result = await client.extractFromImage(
      'Describí la imagen en una palabra.',
      greenPxPng,
    );
    expect(result.length).toBeGreaterThan(0);
  }, 30_000);
});
EOF
```

- [ ] **Step 7: Run tests del SDK**

Asumiendo que `.env` tiene `ANTHROPIC_API_KEY`:

```bash
pnpm test tests/llm/sdk.test.ts
```

Expected: 3 tests passed. Si falta la key, los 3 se skipean (`describe.skip`).

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/env.ts .env.example src/llm/sdk.ts src/llm/index.ts tests/llm/sdk.test.ts
git commit -m "$(cat <<'EOF'
feat(llm): SDK transport (@anthropic-ai/sdk)

ClaudeSDKClient implementa la misma LLMClient interface que CLI.
Vision usa base64 inline (mucho más limpio que /tmp file del CLI).
Factory registra SDK; LLM_TRANSPORT env var elige cliente.
Tests reales contra API se skipean si no hay ANTHROPIC_API_KEY.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Switch del default a SDK

**Files:**
- Modify: `.env` (ajustar `LLM_TRANSPORT=sdk`)
- Modify: `src/lib/env.ts` (cambiar default si querés)

- [ ] **Step 1: Cambiar el default en env loader**

Modificar `src/lib/env.ts`, cambiar:

```ts
LLM_TRANSPORT: z.enum(['cli', 'sdk']).default('cli'),
```

por:

```ts
LLM_TRANSPORT: z.enum(['cli', 'sdk']).default('sdk'),
```

Y validar coherencia: el default ahora exige `ANTHROPIC_API_KEY`. Cuando el usuario corre el worker sin la key, debe fallar rápido con mensaje claro. El `ClaudeSDKClient` constructor ya tira `LLMError` si falta la key — eso se propaga al boot del orchestrator.

- [ ] **Step 2: Actualizar `.env` local**

```bash
sed -i.bak 's/^LLM_TRANSPORT=cli/LLM_TRANSPORT=sdk/' .env
rm .env.bak
grep LLM_TRANSPORT .env
```

Expected: `LLM_TRANSPORT=sdk`.

- [ ] **Step 3: Smoke test de orchestrator con SDK**

```bash
pnpm worker > /tmp/sdk-smoke.log 2>&1 &
WORKER_PID=$!
sleep 30
kill -INT $WORKER_PID
sleep 2
tail -20 /tmp/sdk-smoke.log
```

Expected: logs muestran ingest de Polymarket + News + arranque del scheduler. Si el tagger corrió, debería verse "news: tagging batch complete" sin errores.

- [ ] **Step 4: Verificar que tags nuevos se aplicaron via SDK**

```bash
docker exec politica-pg psql -U politica -d politica -c "
  SELECT count(*) FROM news WHERE tagged_at IS NOT NULL;
"
```

Expected: si la DB tenía rows pendientes, debería haber crecido el count.

- [ ] **Step 5: Commit**

```bash
git add .env.example src/lib/env.ts
git commit -m "$(cat <<'EOF'
chore: default LLM_TRANSPORT a sdk

Para vision (Fase 2 polls) el SDK es mucho más limpio que CLI con
/tmp files. Mantenemos CLI disponible (LLM_TRANSPORT=cli) como
fallback.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

(`.env` no se commitea — es gitignored.)

---

## Bloque C — Polls schema y seed

### Task 6: Tablas `pollsters` y `polls` + seed

**Files:**
- Modify: `src/db/schema.ts` (agregar pollsters + polls)
- Create: `src/db/migrations/0001_*.sql` (auto-generada)
- Create: `src/sources/polls/pollsters.ts` (lista curada hardcodeada)
- Create: `scripts/seed-pollsters.ts`

- [ ] **Step 1: Agregar tablas al schema**

Modificar `src/db/schema.ts`. Después del bloque `events`, agregar:

```ts
// ──────────────────────────────────────────────────────────────────
// Pollsters (encuestadoras y analistas que monitoreamos)
// ──────────────────────────────────────────────────────────────────

export const pollsters = pgTable('pollsters', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),         // 'opinaia' | 'cb_consultora' | etc.
  displayName: text('display_name').notNull(),   // 'Opinaia'
  xHandle: text('x_handle').notNull().unique(),  // 'opinaiagency' (sin @)
  xUserId: text('x_user_id'),                    // populated después del primer fetch
  active: boolean('active').notNull().default(true),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ──────────────────────────────────────────────────────────────────
// Polls (encuestas extraídas)
// ──────────────────────────────────────────────────────────────────

export const pollConfidenceEnum = pgEnum('poll_confidence', ['alto', 'medio', 'bajo']);
export const pollStatusEnum = pgEnum('poll_status', [
  'pending_review',
  'approved',
  'auto_approved',
  'rejected',
]);

export const polls = pgTable(
  'polls',
  {
    id: serial('id').primaryKey(),
    pollsterId: integer('pollster_id').notNull().references(() => pollsters.id),
    sourceUrl: text('source_url').notNull(),       // link al tweet original
    sourceTweetId: text('source_tweet_id').notNull(),
    fechaCampo: timestamp('fecha_campo', { withTimezone: true }), // cuando se hizo la encuesta
    sampleSize: integer('sample_size'),
    metodologia: text('metodologia'),              // 'online' | 'telefonica' | 'mixta' | etc
    results: jsonb('results').$type<Array<{ candidato: string; pct: number }>>().notNull(),
    confidence: pollConfidenceEnum('confidence').notNull(),
    status: pollStatusEnum('status').notNull().default('pending_review'),
    rawClassifierOutput: text('raw_classifier_output'),
    rawExtractorOutput: text('raw_extractor_output'),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).defaultNow().notNull(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  },
  (t) => ({
    sourceTweetUq: uniqueIndex('polls_source_tweet_uq').on(t.sourceTweetId),
    pendingIdx: index('polls_pending_idx').on(t.status, t.ingestedAt),
    pollsterIdx: index('polls_pollster_idx').on(t.pollsterId, t.ingestedAt),
  }),
);
```

Y agregar `boolean` y `integer` al import del top si no estaban (revisá los imports actuales).

- [ ] **Step 2: Generar migración**

```bash
pnpm db:generate
```

Expected: nuevo archivo `src/db/migrations/0001_*.sql`.

- [ ] **Step 3: Aplicar migración**

```bash
pnpm db:migrate
```

Expected: `[✓] migrations applied successfully`.

- [ ] **Step 4: Verificar tablas**

```bash
docker exec politica-pg psql -U politica -d politica -c "\dt"
docker exec politica-pg psql -U politica -d politica -c "\d pollsters"
docker exec politica-pg psql -U politica -d politica -c "\d polls"
```

Expected: 6 tablas (los 4 anteriores + pollsters + polls), con los enums correctos.

- [ ] **Step 5: Crear lista curada de cuentas**

```bash
mkdir -p src/sources/polls
cat > src/sources/polls/pollsters.ts <<'EOF'
/**
 * Lista curada de cuentas X de encuestadoras y analistas argentinos.
 * Se siembra a la DB en boot (idempotente). Después de seed, podés desactivar
 * cualquiera con UPDATE pollsters SET active = false WHERE slug = '...'.
 */

export interface PollsterSeed {
  slug: string;
  displayName: string;
  xHandle: string;       // sin @
  notes?: string;
}

export const POLLSTERS: PollsterSeed[] = [
  // Encuestadoras formales
  { slug: 'opinaia',         displayName: 'Opinaia',                   xHandle: 'opinaiagency' },
  { slug: 'cb_consultora',   displayName: 'CB Consultora',             xHandle: 'cb_consultora' },
  { slug: 'synopsis',        displayName: 'Synopsis Consultores',      xHandle: 'SynopsisCons' },
  { slug: 'atlas_intel',     displayName: 'Atlas Intel',               xHandle: 'AtlasIntel' },
  { slug: 'zuban_cordoba',   displayName: 'Zuban Córdoba',             xHandle: 'ZubanCordoba' },
  { slug: 'management_fit',  displayName: 'Management & Fit',          xHandle: 'Manage_Fit' },
  // Analistas que publican datos de encuestas
  { slug: 'fede_gonzalez',   displayName: 'Federico González',         xHandle: 'fede_gonzalez_ok' },
  { slug: 'carlos_fara',     displayName: 'Carlos Fara',               xHandle: 'CarlosFara' },
  { slug: 'shila_vilker',    displayName: 'Shila Vilker',              xHandle: 'ShilaVilker' },
  { slug: 'lucas_romero',    displayName: 'Lucas Romero (Synopsis)',   xHandle: 'lucasrome'  , notes: 'Director de Synopsis' },
];
EOF
```

- [ ] **Step 6: Script de seed**

```bash
cat > scripts/seed-pollsters.ts <<'EOF'
/**
 * Seed idempotente. Inserta o actualiza cada pollster por slug.
 * Run: pnpm tsx scripts/seed-pollsters.ts
 */
import { db } from '../src/db/client.js';
import { pollsters } from '../src/db/schema.js';
import { POLLSTERS } from '../src/sources/polls/pollsters.ts.js';
import { logger } from '../src/lib/logger.js';

let inserted = 0;
let updated = 0;

for (const p of POLLSTERS) {
  const result = await db
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
    })
    .returning({ id: pollsters.id, _new: pollsters.createdAt });

  if (result.length === 1) {
    // Drizzle no nos dice si fue insert o update directamente; hacemos un check secundario.
    const existing = await db.select().from(pollsters).where(eq(pollsters.slug, p.slug));
    if (existing.length === 1 && existing[0].createdAt.getTime() > Date.now() - 1000) {
      inserted++;
    } else {
      updated++;
    }
  }
}

logger.info({ inserted, updated, total: POLLSTERS.length }, 'pollsters: seed complete');
process.exit(0);
EOF
```

(El import de `pollsters.ts.js` parece raro — ESM + tsx requiere que las extensiones de imports sean `.js` aunque el source sea `.ts`. El import correcto del seed file es `'../src/sources/polls/pollsters.js'`.)

Corregir antes de correr:

```bash
sed -i.bak "s|/pollsters.ts.js|/pollsters.js|" scripts/seed-pollsters.ts
rm scripts/seed-pollsters.ts.bak
```

- [ ] **Step 7: Correr el seed**

Tendrás que importar `eq` desde `drizzle-orm`. Agregalo al top del script:

```bash
sed -i.bak "1i\\
import { eq } from 'drizzle-orm';
" scripts/seed-pollsters.ts
rm scripts/seed-pollsters.ts.bak
```

Después:

```bash
pnpm tsx scripts/seed-pollsters.ts
```

Expected: log "pollsters: seed complete" con `total: 10`.

- [ ] **Step 8: Verificar en DB**

```bash
docker exec politica-pg psql -U politica -d politica -c "SELECT slug, display_name, x_handle, active FROM pollsters ORDER BY id;"
```

Expected: 10 filas con los pollsters listados.

- [ ] **Step 9: Commit**

```bash
git add src/db/schema.ts src/db/migrations/ src/sources/polls/pollsters.ts scripts/seed-pollsters.ts
git commit -m "$(cat <<'EOF'
feat(db): tablas pollsters y polls + seed inicial

pollsters: 10 cuentas X curadas (encuestadoras + analistas).
polls: estructura con confidence + status (pending_review por default),
provenance via source_tweet_id (unique). Enums para confidence y status.
Índices estratégicos para review queue y queries por pollster.
seed-pollsters.ts es idempotente (upsert por slug).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Bloque D — X API client

### Task 7: X API client con bearer auth

**Files:**
- Modify: `src/lib/env.ts` (X_API_BEARER_TOKEN)
- Modify: `.env.example`
- Create: `src/sources/polls/x-client.ts`
- Create: `tests/fixtures/x-timeline.json` (fixture)
- Create: `tests/sources/polls/x-client.test.ts`

- [ ] **Step 1: Env var para bearer token**

Modificar `src/lib/env.ts`, agregar al schema:

```ts
X_API_BEARER_TOKEN: z.string().optional(),
X_API_BASE: z.string().url().default('https://api.twitter.com/2'),
```

(Optional para que el typecheck pase sin token; el cliente falla rápido si está vacío al runtime.)

Append a `.env.example`:

```bash
cat >> .env.example <<'EOF'

# X API (pay-per-use bearer token)
X_API_BEARER_TOKEN=
X_API_BASE=https://api.twitter.com/2
EOF
```

- [ ] **Step 2: Implementar el cliente**

```bash
cat > src/sources/polls/x-client.ts <<'EOF'
import { z } from 'zod';
import { env } from '../../lib/env.js';
import { fetchWithTimeout } from '../../lib/http.js';
import { logger } from '../../lib/logger.js';

// ─── Schemas ───────────────────────────────────────────────────────

export const xUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  name: z.string(),
});
export type XUser = z.infer<typeof xUserSchema>;

export const xMediaSchema = z.object({
  media_key: z.string(),
  type: z.enum(['photo', 'video', 'animated_gif']),
  url: z.string().url().optional(),         // photo URL si type=photo
  preview_image_url: z.string().url().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
});
export type XMedia = z.infer<typeof xMediaSchema>;

export const xTweetSchema = z.object({
  id: z.string(),
  text: z.string(),
  author_id: z.string().optional(),
  created_at: z.string().datetime().optional(),
  attachments: z.object({
    media_keys: z.array(z.string()).optional(),
  }).optional(),
});
export type XTweet = z.infer<typeof xTweetSchema>;

export interface XTimelinePage {
  tweets: XTweet[];
  media: Map<string, XMedia>;       // keyed by media_key
}

// ─── Client ────────────────────────────────────────────────────────

function authHeaders(): HeadersInit {
  const token = env.X_API_BEARER_TOKEN;
  if (!token) {
    throw new Error('X_API_BEARER_TOKEN no está set (configurar en .env)');
  }
  return { authorization: `Bearer ${token}`, accept: 'application/json' };
}

/**
 * Buscar el user_id de una username. Cachear externamente — esto cuesta 1 read.
 */
export async function getUserByUsername(username: string): Promise<XUser> {
  const url = `${env.X_API_BASE}/users/by/username/${encodeURIComponent(username)}`;
  const res = await fetchWithTimeout(url, { timeoutMs: 10_000, headers: authHeaders() });
  if (!res.ok) throw new Error(`X getUserByUsername ${username} failed: ${res.status} ${await res.text()}`);
  const json = await res.json() as { data?: unknown };
  return xUserSchema.parse(json.data);
}

/**
 * Fetch últimos N tweets de un usuario, con media expandida.
 * max_results: 5 a 100. Cuesta `max_results` reads aprox.
 */
export async function getUserTimeline(
  userId: string,
  opts: { maxResults?: number; sinceId?: string } = {},
): Promise<XTimelinePage> {
  const params = new URLSearchParams({
    max_results: String(opts.maxResults ?? 10),
    'tweet.fields': 'created_at,attachments,author_id',
    expansions: 'attachments.media_keys',
    'media.fields': 'media_key,type,url,preview_image_url,width,height',
    exclude: 'retweets,replies',
  });
  if (opts.sinceId) params.set('since_id', opts.sinceId);

  const url = `${env.X_API_BASE}/users/${userId}/tweets?${params.toString()}`;
  const res = await fetchWithTimeout(url, { timeoutMs: 15_000, headers: authHeaders() });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`X getUserTimeline ${userId} failed: ${res.status} ${body.slice(0, 300)}`);
  }
  const json = await res.json() as {
    data?: unknown[];
    includes?: { media?: unknown[] };
    meta?: { result_count?: number };
  };

  const tweets: XTweet[] = (json.data ?? []).flatMap((item) => {
    const result = xTweetSchema.safeParse(item);
    if (result.success) return [result.data];
    logger.warn({ errors: result.error.flatten() }, 'x: skipping malformed tweet');
    return [];
  });

  const media = new Map<string, XMedia>();
  for (const item of json.includes?.media ?? []) {
    const result = xMediaSchema.safeParse(item);
    if (result.success) media.set(result.data.media_key, result.data);
  }

  return { tweets, media };
}

/**
 * Fetch media binary (la imagen real para vision extraction).
 */
export async function fetchMediaBinary(url: string): Promise<Buffer> {
  const res = await fetchWithTimeout(url, { timeoutMs: 20_000 });
  if (!res.ok) throw new Error(`X media fetch failed: ${res.status} ${url}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}
EOF
```

- [ ] **Step 3: Capturar fixture (con el token real)**

```bash
pnpm tsx -e "
import { getUserByUsername, getUserTimeline } from './src/sources/polls/x-client.js';
import { writeFileSync } from 'node:fs';
const user = await getUserByUsername('opinaiagency');
console.log('user:', user);
const page = await getUserTimeline(user.id, { maxResults: 5 });
const dump = { user, tweets: page.tweets, media: Array.from(page.media.entries()) };
writeFileSync('tests/fixtures/x-timeline.json', JSON.stringify(dump, null, 2));
console.log('Wrote', page.tweets.length, 'tweets and', page.media.size, 'media items');
"
```

Expected: fixture creado con tweets reales. Si falla con 401, revisar el token. Si 404, la cuenta no existe — probar otro pollster.

- [ ] **Step 4: Escribir tests sobre el fixture**

```bash
mkdir -p tests/sources/polls
cat > tests/sources/polls/x-client.test.ts <<'EOF'
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { xTweetSchema, xMediaSchema } from '../../../src/sources/polls/x-client.js';

const dump = JSON.parse(readFileSync('tests/fixtures/x-timeline.json', 'utf-8'));

describe('X API schema (offline against fixture)', () => {
  it('all fixture tweets parse via xTweetSchema', () => {
    expect(dump.tweets.length).toBeGreaterThan(0);
    for (const t of dump.tweets) {
      const result = xTweetSchema.safeParse(t);
      expect(result.success, `tweet ${t.id} failed: ${result.success ? '' : JSON.stringify(result.error.flatten())}`).toBe(true);
    }
  });

  it('all fixture media parse via xMediaSchema', () => {
    for (const [, m] of dump.media as Array<[string, unknown]>) {
      const result = xMediaSchema.safeParse(m);
      expect(result.success).toBe(true);
    }
  });
});
EOF
```

- [ ] **Step 5: Run tests**

```bash
pnpm test tests/sources/polls/x-client.test.ts
```

Expected: 2 tests passed.

- [ ] **Step 6: Commit**

```bash
git add src/lib/env.ts .env.example src/sources/polls/x-client.ts tests/sources/polls/ tests/fixtures/x-timeline.json
git commit -m "$(cat <<'EOF'
feat(polls): X API client (auth + user timeline + media)

getUserByUsername, getUserTimeline (con expansiones de media),
fetchMediaBinary. Schemas zod para tweet + media (passthrough en
campos opcionales). Tests offline contra fixture de @opinaiagency.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Filtro grueso por keywords

Antes de gastar reads del LLM, descartar tweets que claramente no son encuestas.

**Files:**
- Create: `src/sources/polls/filter.ts`
- Create: `tests/sources/polls/filter.test.ts`

- [ ] **Step 1: Tests primero**

```bash
cat > tests/sources/polls/filter.test.ts <<'EOF'
import { describe, it, expect } from 'vitest';
import { mightBePoll } from '../../../src/sources/polls/filter.js';

describe('mightBePoll', () => {
  it('matches obvious poll texts', () => {
    expect(mightBePoll('Encuesta nacional. Milei 45%, Kicillof 30%')).toBe(true);
    expect(mightBePoll('Nueva medición de intención de voto para 2027.')).toBe(true);
    expect(mightBePoll('Imagen de Milei en abril: 47%')).toBe(true);
  });

  it('matches when text is short but media is attached', () => {
    expect(mightBePoll('Datos de abril 👇', { hasMedia: true })).toBe(true);
  });

  it('rejects clearly non-poll content', () => {
    expect(mightBePoll('Hoy almorcé pizza con la familia')).toBe(false);
    expect(mightBePoll('Vamos River!!!')).toBe(false);
  });

  it('rejects retweets / mentions without context', () => {
    expect(mightBePoll('@usuario gracias por seguirme')).toBe(false);
  });
});
EOF
```

- [ ] **Step 2: Run RED**

```bash
pnpm test tests/sources/polls/filter.test.ts
```

Expected: FAIL "Cannot find module".

- [ ] **Step 3: Implementar filter**

```bash
cat > src/sources/polls/filter.ts <<'EOF'
/**
 * Filtro grueso barato (sin LLM) para descartar tweets que claramente
 * no son encuestas. La lógica es laxa: false-positivos OK (después
 * los filtra el classifier LLM), false-negativos caros (perdemos data).
 */

const POLL_KEYWORDS = [
  'encuesta',
  'medicion',
  'medición',
  'intención de voto',
  'intencion de voto',
  'imagen positiva',
  'imagen negativa',
  'tracking',
  'sondeo',
  'cb consultora',
  'opinaia',
  'atlas intel',
  'synopsis',
  'zuban',
];

const CANDIDATE_NAMES = [
  'milei',
  'kicillof',
  'massa',
  'bullrich',
  'macri',
  'larreta',
  'cristina',
  'villarruel',
];

export function mightBePoll(
  text: string,
  opts: { hasMedia?: boolean } = {},
): boolean {
  const lower = text.toLowerCase();

  // Reject obvio: muy corto y sin media
  if (lower.trim().length < 10 && !opts.hasMedia) return false;

  // Reject obvio: arranca con @ (reply directa) y no tiene media
  if (lower.trim().startsWith('@') && !opts.hasMedia) return false;

  // Match por keyword fuerte
  if (POLL_KEYWORDS.some((kw) => lower.includes(kw))) return true;

  // Match por porcentaje + nombre de candidato (típico formato)
  const hasPct = /\d{1,2}[\.,]?\d?\s*%/.test(text);
  const hasCandidate = CANDIDATE_NAMES.some((c) => lower.includes(c));
  if (hasPct && hasCandidate) return true;

  // Si tiene media adjunta + algún hint, dejarlo pasar
  if (opts.hasMedia && hasCandidate) return true;
  if (opts.hasMedia && hasPct) return true;

  return false;
}
EOF
```

- [ ] **Step 4: Run GREEN**

```bash
pnpm test tests/sources/polls/filter.test.ts
```

Expected: 4 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/sources/polls/filter.ts tests/sources/polls/filter.test.ts
git commit -m "$(cat <<'EOF'
feat(polls): keyword/heuristic filter pre-LLM

mightBePoll descarta tweets que claramente no son encuestas sin
gastar un read de LLM. Laxo: prioriza false-positivos (los filtra
el classifier después) sobre false-negativos (datos perdidos).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Bloque E — Poll extraction LLM

### Task 9: Poll classifier (Haiku)

Decide si un tweet+imagen es realmente una encuesta. Si no, descartar antes del extractor caro.

**Files:**
- Create: `src/sources/polls/classifier.ts`
- Create: `tests/sources/polls/classifier.test.ts`

- [ ] **Step 1: Implementar classifier**

```bash
cat > src/sources/polls/classifier.ts <<'EOF'
import { z } from 'zod';
import { llm } from '../../llm/index.js';

const classifierSchema = z.object({
  is_poll: z.boolean(),
  confidence: z.enum(['alto', 'medio', 'bajo']),
  reason: z.string(),
});

export type ClassifierResult = z.infer<typeof classifierSchema>;

const PROMPT = (text: string, hasImage: boolean) => `
Sos un clasificador de tweets de encuestas políticas argentinas.
Recibís el texto del tweet ${hasImage ? '+ una imagen adjunta' : '(sin imagen)'}.

Decidí si el tweet contiene/es una encuesta de intención de voto, imagen política
(positiva/negativa), o tracking electoral CON DATOS NUMÉRICOS reportados.

NO clasificar como poll:
- Comentarios sobre encuestas ajenas sin datos.
- Memes o ironías sobre porcentajes.
- Anuncios de futuros estudios sin resultados.

SÍ clasificar como poll:
- Imagen de tabla de resultados con candidatos y porcentajes.
- Texto que reporta resultados de un estudio propio o ajeno con números.

Respondé EXCLUSIVAMENTE un JSON con esta forma:
{"is_poll": boolean, "confidence": "alto"|"medio"|"bajo", "reason": "string corto"}

Texto del tweet:
"""
${text}
"""
`.trim();

/**
 * Si hasImage=true, pasa la imagen al LLM (vision). Si false, solo texto.
 * El classifier usa Haiku tanto en text-only como en vision para mantener costo bajo.
 */
export async function classifyTweet(
  text: string,
  image?: Buffer,
): Promise<ClassifierResult> {
  const prompt = PROMPT(text, !!image);
  const raw = image
    ? await llm.extractFromImage(prompt, image, { model: 'haiku' })
    : await llm.classify(prompt, { model: 'haiku' });

  const json = extractFirstJsonObject(raw);
  return classifierSchema.parse(json);
}

function extractFirstJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error(`classifier: no JSON in output: ${trimmed.slice(0, 200)}`);
  }
  return JSON.parse(trimmed.slice(start, end + 1));
}
EOF
```

- [ ] **Step 2: Test con dos cases (offline; mockear llm)**

```bash
cat > tests/sources/polls/classifier.test.ts <<'EOF'
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { classifyTweet } from '../../../src/sources/polls/classifier.js';

vi.mock('../../../src/llm/index.js', () => ({
  llm: {
    classify: vi.fn(),
    extractFromImage: vi.fn(),
    generateText: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('classifyTweet', () => {
  it('returns parsed result for clean JSON output', async () => {
    const { llm } = await import('../../../src/llm/index.js');
    (llm.classify as any).mockResolvedValue('{"is_poll": true, "confidence": "alto", "reason": "Tabla con porcentajes claros"}');
    const result = await classifyTweet('Encuesta Opinaia: Milei 45, Kicillof 28');
    expect(result.is_poll).toBe(true);
    expect(result.confidence).toBe('alto');
  });

  it('uses extractFromImage when image is provided', async () => {
    const { llm } = await import('../../../src/llm/index.js');
    (llm.extractFromImage as any).mockResolvedValue('{"is_poll": false, "confidence": "alto", "reason": "Foto de almuerzo"}');
    const result = await classifyTweet('Hoy almorcé pizza', Buffer.from('fakeimg'));
    expect(result.is_poll).toBe(false);
    expect(llm.extractFromImage).toHaveBeenCalledTimes(1);
    expect(llm.classify).not.toHaveBeenCalled();
  });

  it('throws when LLM output has no JSON', async () => {
    const { llm } = await import('../../../src/llm/index.js');
    (llm.classify as any).mockResolvedValue('No tengo idea, lo siento.');
    await expect(classifyTweet('texto')).rejects.toThrow(/no json/i);
  });
});
EOF
```

- [ ] **Step 3: Run tests**

```bash
pnpm test tests/sources/polls/classifier.test.ts
```

Expected: 3 tests passed.

- [ ] **Step 4: Commit**

```bash
git add src/sources/polls/classifier.ts tests/sources/polls/classifier.test.ts
git commit -m "$(cat <<'EOF'
feat(polls): classifier LLM (Haiku, vision-aware)

classifyTweet decide is_poll + confidence + reason. Usa Haiku
tanto en text-only como en vision para costo mínimo. Tests con
llm mockeado cubren JSON limpio, vision path, y fallo en parsing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Poll vision extractor (Sonnet)

Para tweets que el classifier marca como poll, extraer la estructura completa de la imagen.

**Files:**
- Create: `src/sources/polls/extractor.ts`
- Create: `tests/sources/polls/extractor.test.ts`

- [ ] **Step 1: Implementar extractor**

```bash
cat > src/sources/polls/extractor.ts <<'EOF'
import { z } from 'zod';
import { llm } from '../../llm/index.js';

export const extractedPollSchema = z.object({
  pollster_hint: z.string().nullable(),       // ej: "Opinaia" si la imagen lo dice
  fecha_campo: z.string().nullable(),         // ISO date si está claro, null si no
  sample_size: z.number().int().positive().nullable(),
  metodologia: z.enum(['online', 'telefonica', 'mixta', 'cara_a_cara', 'desconocida']).nullable(),
  results: z.array(
    z.object({
      candidato: z.string().min(1),
      pct: z.number().min(0).max(100),
    }),
  ).min(2),                                   // si la imagen tiene <2 filas no es una encuesta
});

export type ExtractedPoll = z.infer<typeof extractedPollSchema>;

const PROMPT = `
Sos un extractor estructurado de encuestas políticas argentinas. Recibís una imagen
que contiene una tabla, gráfico o texto con resultados de una encuesta de intención
de voto o imagen política.

Devolvé EXCLUSIVAMENTE un JSON con esta forma:

{
  "pollster_hint": "string o null",          // qué encuestadora se ve en la imagen, si es claro
  "fecha_campo": "YYYY-MM-DD o null",        // fecha del campo de la encuesta (no fecha de publicación)
  "sample_size": "número entero o null",     // tamaño de muestra
  "metodologia": "online|telefonica|mixta|cara_a_cara|desconocida",
  "results": [
    {"candidato": "Nombre Apellido", "pct": número entre 0 y 100},
    ...
  ]
}

Reglas:
- "results" debe tener al menos 2 candidatos. Si la imagen no tiene una encuesta clara
  con candidatos+porcentajes, devolvé "results": [] y los demás campos null.
- "candidato": usar nombre tal como aparece (ej "Milei" o "Javier Milei"; sin "Sr.").
- "pct": número, no string. "45%" → 45. "12,5%" → 12.5.
- Si no podés leer un valor, NO inventes — preferí null para ese campo.
- Devolvé SOLO el JSON, sin texto adicional, sin markdown fences.
`.trim();

export async function extractPollFromImage(image: Buffer): Promise<ExtractedPoll> {
  const raw = await llm.extractFromImage(PROMPT, image, { model: 'sonnet' });
  const json = extractFirstJsonObject(raw);
  return extractedPollSchema.parse(json);
}

function extractFirstJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error(`extractor: no JSON in output: ${trimmed.slice(0, 200)}`);
  }
  return JSON.parse(trimmed.slice(start, end + 1));
}
EOF
```

- [ ] **Step 2: Tests offline (mockear llm)**

```bash
cat > tests/sources/polls/extractor.test.ts <<'EOF'
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractPollFromImage } from '../../../src/sources/polls/extractor.js';

vi.mock('../../../src/llm/index.js', () => ({
  llm: { extractFromImage: vi.fn(), classify: vi.fn(), generateText: vi.fn() },
}));

beforeEach(() => vi.clearAllMocks());

describe('extractPollFromImage', () => {
  it('parses a well-formed extraction', async () => {
    const { llm } = await import('../../../src/llm/index.js');
    (llm.extractFromImage as any).mockResolvedValue(JSON.stringify({
      pollster_hint: 'Opinaia',
      fecha_campo: '2026-04-28',
      sample_size: 1200,
      metodologia: 'online',
      results: [
        { candidato: 'Milei', pct: 45.2 },
        { candidato: 'Kicillof', pct: 28.5 },
      ],
    }));
    const result = await extractPollFromImage(Buffer.from('fake'));
    expect(result.pollster_hint).toBe('Opinaia');
    expect(result.results).toHaveLength(2);
    expect(result.results[0].pct).toBeCloseTo(45.2);
  });

  it('rejects extractions with fewer than 2 results', async () => {
    const { llm } = await import('../../../src/llm/index.js');
    (llm.extractFromImage as any).mockResolvedValue(JSON.stringify({
      pollster_hint: null,
      fecha_campo: null,
      sample_size: null,
      metodologia: null,
      results: [],
    }));
    await expect(extractPollFromImage(Buffer.from('fake'))).rejects.toThrow();
  });

  it('rejects pct out of [0, 100]', async () => {
    const { llm } = await import('../../../src/llm/index.js');
    (llm.extractFromImage as any).mockResolvedValue(JSON.stringify({
      pollster_hint: null,
      fecha_campo: null,
      sample_size: null,
      metodologia: null,
      results: [
        { candidato: 'A', pct: 150 },
        { candidato: 'B', pct: 50 },
      ],
    }));
    await expect(extractPollFromImage(Buffer.from('fake'))).rejects.toThrow();
  });
});
EOF
```

- [ ] **Step 3: Run tests**

```bash
pnpm test tests/sources/polls/extractor.test.ts
```

Expected: 3 tests passed.

- [ ] **Step 4: Commit**

```bash
git add src/sources/polls/extractor.ts tests/sources/polls/extractor.test.ts
git commit -m "$(cat <<'EOF'
feat(polls): vision extractor (Sonnet) con zod-validated output

extractPollFromImage devuelve estructura { pollster_hint, fecha_campo,
sample_size, metodologia, results[] }. Schema rechaza extracciones
con <2 results o pct fuera de [0,100]. Tests offline mockean llm.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Pipeline + insert con confidence

Combina filtro grueso + classifier + extractor + sanity checks + insert.

**Files:**
- Create: `src/sources/polls/pipeline.ts`

- [ ] **Step 1: Implementar pipeline**

```bash
cat > src/sources/polls/pipeline.ts <<'EOF'
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { polls, pollsters } from '../../db/schema.js';
import { logger } from '../../lib/logger.js';
import { mightBePoll } from './filter.js';
import { classifyTweet } from './classifier.js';
import { extractPollFromImage } from './extractor.js';
import { fetchMediaBinary, type XMedia, type XTweet } from './x-client.js';

export interface ProcessTweetResult {
  status: 'inserted' | 'skipped_filter' | 'skipped_classifier' | 'skipped_no_image' | 'skipped_extractor_failed' | 'skipped_sanity' | 'skipped_duplicate';
  reason?: string;
  pollId?: number;
}

interface ProcessOpts {
  pollsterDbId: number;
  tweet: XTweet;
  attachedMedia: XMedia[];
}

export async function processTweet(opts: ProcessOpts): Promise<ProcessTweetResult> {
  const { pollsterDbId, tweet, attachedMedia } = opts;
  const hasImage = attachedMedia.some((m) => m.type === 'photo' && m.url);

  // 1. Filtro grueso
  if (!mightBePoll(tweet.text, { hasMedia: hasImage })) {
    return { status: 'skipped_filter' };
  }

  // 2. Sin imagen no podemos extraer estructura confiable — descartamos
  const photo = attachedMedia.find((m) => m.type === 'photo' && m.url);
  if (!photo?.url) {
    return { status: 'skipped_no_image' };
  }

  // 3. Fetch image binary
  let imageBuf: Buffer;
  try {
    imageBuf = await fetchMediaBinary(photo.url);
  } catch (err) {
    return { status: 'skipped_no_image', reason: `media fetch failed: ${(err as Error).message}` };
  }

  // 4. Classifier
  let classifierResult;
  try {
    classifierResult = await classifyTweet(tweet.text, imageBuf);
  } catch (err) {
    logger.warn({ tweetId: tweet.id, err: (err as Error).message }, 'polls: classifier failed');
    return { status: 'skipped_classifier', reason: 'classifier_error' };
  }

  if (!classifierResult.is_poll) {
    return { status: 'skipped_classifier', reason: classifierResult.reason };
  }

  // 5. Extractor (Sonnet vision)
  let extracted;
  try {
    extracted = await extractPollFromImage(imageBuf);
  } catch (err) {
    logger.warn({ tweetId: tweet.id, err: (err as Error).message }, 'polls: extractor failed');
    return { status: 'skipped_extractor_failed', reason: (err as Error).message };
  }

  // 6. Sanity checks: suma <=105% (margen para indecisos), sample > 200 si está
  const sumPct = extracted.results.reduce((s, r) => s + r.pct, 0);
  if (sumPct > 105) {
    logger.warn({ tweetId: tweet.id, sumPct }, 'polls: sanity failed (sum > 105)');
    return { status: 'skipped_sanity', reason: `sum_pct=${sumPct}` };
  }
  if (extracted.sample_size != null && extracted.sample_size < 200) {
    logger.warn({ tweetId: tweet.id, sampleSize: extracted.sample_size }, 'polls: sanity failed (sample too small)');
    return { status: 'skipped_sanity', reason: `sample_size=${extracted.sample_size}` };
  }

  // 7. Confidence final: classifier confidence ∧ extracción coherente
  const confidence = classifierResult.confidence;

  // 8. Insert (con upsert por source_tweet_id para idempotencia)
  try {
    const inserted = await db
      .insert(polls)
      .values({
        pollsterId: pollsterDbId,
        sourceUrl: `https://x.com/i/status/${tweet.id}`,
        sourceTweetId: tweet.id,
        fechaCampo: extracted.fecha_campo ? new Date(extracted.fecha_campo) : null,
        sampleSize: extracted.sample_size,
        metodologia: extracted.metodologia,
        results: extracted.results,
        confidence,
        status: confidence === 'alto' ? 'pending_review' : 'pending_review', // siempre review en fase 2
        rawClassifierOutput: JSON.stringify(classifierResult),
        rawExtractorOutput: JSON.stringify(extracted),
      })
      .onConflictDoNothing({ target: polls.sourceTweetId })
      .returning({ id: polls.id });

    if (inserted.length === 0) {
      return { status: 'skipped_duplicate' };
    }
    return { status: 'inserted', pollId: inserted[0].id };
  } catch (err) {
    logger.error({ tweetId: tweet.id, err: (err as Error).message }, 'polls: insert failed');
    throw err;
  }
}
EOF
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/sources/polls/pipeline.ts
git commit -m "$(cat <<'EOF'
feat(polls): pipeline filter→classifier→extractor→insert

processTweet orquesta toda la cadena por tweet con devoluciones
estructuradas (status discriminado para diagnostics). Sanity checks
postextractor: sum<=105 + sample>=200. Idempotente por source_tweet_id.
status default = pending_review en fase 2 (manual review obligatorio).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Bloque F — Worker integration

### Task 12: Polls ingest worker

Itera todos los pollsters activos, fetchea su timeline, procesa cada tweet via pipeline.

**Files:**
- Create: `src/sources/polls/ingest.ts`

- [ ] **Step 1: Implementar ingest**

```bash
cat > src/sources/polls/ingest.ts <<'EOF'
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { pollsters } from '../../db/schema.js';
import { logger } from '../../lib/logger.js';
import { getUserByUsername, getUserTimeline } from './x-client.js';
import { processTweet, type ProcessTweetResult } from './pipeline.js';

const TWEETS_PER_POLLSTER = 10;

export interface PollsIngestStats {
  pollsters: number;
  tweetsSeen: number;
  inserted: number;
  bySkipReason: Record<string, number>;
}

export async function runPollsIngest(): Promise<PollsIngestStats> {
  const start = Date.now();
  const stats: PollsIngestStats = {
    pollsters: 0,
    tweetsSeen: 0,
    inserted: 0,
    bySkipReason: {},
  };

  const active = await db.select().from(pollsters).where(eq(pollsters.active, true));

  for (const p of active) {
    stats.pollsters++;
    try {
      // Resolve x_user_id si no está cacheado
      let xUserId = p.xUserId;
      if (!xUserId) {
        const user = await getUserByUsername(p.xHandle);
        xUserId = user.id;
        await db.update(pollsters).set({ xUserId }).where(eq(pollsters.id, p.id));
      }

      const page = await getUserTimeline(xUserId, { maxResults: TWEETS_PER_POLLSTER });
      stats.tweetsSeen += page.tweets.length;

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
      logger.warn({ pollster: p.slug, err: (err as Error).message }, 'polls: pollster ingest failed');
    }
  }

  logger.info(
    { ...stats, ms: Date.now() - start },
    'polls: ingest complete',
  );
  return stats;
}
EOF
```

- [ ] **Step 2: Smoke test (cuesta ~10-50 reads de X API + tantos LLM calls como tweets pasen el filtro)**

```bash
pnpm tsx -e "import { runPollsIngest } from './src/sources/polls/ingest.js'; const s = await runPollsIngest(); console.log(s); process.exit(0);"
```

Expected: log con stats. `inserted` puede ser 0 si los pollsters no postearon encuestas recientemente, eso es OK. Lo importante es que `tweetsSeen` > 0 y no haya errores fatales.

- [ ] **Step 3: Verificar DB (si insertó algo)**

```bash
docker exec politica-pg psql -U politica -d politica -c "
  SELECT p.id, ps.slug, p.confidence, p.status, p.sample_size, jsonb_array_length(p.results) AS num_candidates, p.source_url
  FROM polls p JOIN pollsters ps ON ps.id = p.pollster_id
  ORDER BY p.ingested_at DESC LIMIT 5;
"
```

- [ ] **Step 4: Commit**

```bash
git add src/sources/polls/ingest.ts
git commit -m "$(cat <<'EOF'
feat(polls): ingest worker (todos los pollsters activos)

Itera pollsters activos, resuelve+cachea x_user_id, fetchea hasta
10 tweets/cada uno, los pasa al pipeline. Devuelve stats agregados
con bySkipReason para diagnóstico (cuántos descartó el filtro vs
classifier vs sanity). Errores por-pollster son warnings; no abortan.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Wire al orchestrator (cron 6h)

**Files:**
- Modify: `src/workers/orchestrator.ts`
- Modify: `src/lib/env.ts` (agregar `POLLS_POLL_INTERVAL_HOURS`)
- Modify: `.env.example`

- [ ] **Step 1: Env var para interval**

En `src/lib/env.ts` agregar al schema:

```ts
POLLS_POLL_INTERVAL_HOURS: z.coerce.number().int().positive().default(6),
```

Append a `.env.example`:

```bash
cat >> .env.example <<'EOF'

# Polls
POLLS_POLL_INTERVAL_HOURS=6
EOF
```

- [ ] **Step 2: Agregar schedule al orchestrator**

En `src/workers/orchestrator.ts`:

Agregar al import block:
```ts
import { runPollsIngest } from '../sources/polls/ingest.js';
```

Agregar al `main()`, antes de `cron.schedule(...) // News tagger ...`:

```ts
// Polls cada N horas (X API es caro, no apuramos)
cron.schedule(`0 */${env.POLLS_POLL_INTERVAL_HOURS} * * *`, singleflight('polls-ingest', runPollsIngest));
```

Actualizar el último `logger.info`:

```ts
logger.info(
  {
    polymarket_min: env.POLYMARKET_POLL_INTERVAL_MIN,
    news_min: env.NEWS_POLL_INTERVAL_MIN,
    polls_hours: env.POLLS_POLL_INTERVAL_HOURS,
  },
  'orchestrator: schedules registered',
);
```

- [ ] **Step 3: Smoke test**

```bash
pnpm worker > /tmp/polls-orch.log 2>&1 &
WORKER_PID=$!
sleep 60
kill -INT $WORKER_PID
sleep 2
grep -E "schedules registered|polls" /tmp/polls-orch.log
```

Expected: log "schedules registered" incluye `polls_hours: 6`.

- [ ] **Step 4: Commit**

```bash
git add src/workers/orchestrator.ts src/lib/env.ts .env.example
git commit -m "$(cat <<'EOF'
feat(worker): integrar polls ingest en cron schedule

POLLS_POLL_INTERVAL_HOURS env var (default 6). Cron expr está
expresada como "minute 0 cada N horas" para evitar drift entre
ticks. Single-flight como los demás jobs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Review CLI + README + E2E

**Files:**
- Create: `scripts/review-polls.ts`
- Modify: `README.md`

- [ ] **Step 1: Script de review**

```bash
cat > scripts/review-polls.ts <<'EOF'
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
EOF
```

- [ ] **Step 2: Update README**

Reemplazar el README con la versión Fase 2. Usar Write tool por la cantidad de bloques de código.

Archivo: `/Users/zeke/Documents/Projects/Personal/politica/README.md`. Agregarlo:

```markdown
# politica

Bot automatizado de X (en construcción) que cruza Polymarket + encuestas locales + noticias para reportar el ciclo electoral argentino 2026-2027.

Spec: [`docs/superpowers/specs/2026-05-04-politica-bot-design.md`](docs/superpowers/specs/2026-05-04-politica-bot-design.md)
Design system (visual): [`DESIGN.md`](DESIGN.md)

## Estado

**Fase 2 — Polls Ingestion** (en curso). Pipelines de Polymarket, noticias y polls (X API + LLM vision) corriendo localmente. Trigger engine (fase 3), publisher (fase 4) y sitio público (fase 5) pendientes.

## Setup local

Requisitos: Node 20+, pnpm, Docker Desktop, `claude` CLI autenticado, X API bearer token, ANTHROPIC_API_KEY.

\`\`\`bash
cp .env.example .env
# Editar .env con tus tokens (X_API_BEARER_TOKEN, ANTHROPIC_API_KEY)
docker compose up -d           # Postgres
pnpm install
pnpm db:migrate
pnpm tsx scripts/seed-pollsters.ts   # idempotente, sólo primera vez
pnpm worker                    # arranca ingestion loop
\`\`\`

## Comandos útiles

\`\`\`bash
pnpm dev                       # worker en watch mode
pnpm worker                    # worker sin watch
pnpm test                      # vitest run
pnpm typecheck                 # tsc --noEmit
pnpm db:generate               # genera migración nueva
pnpm db:migrate                # aplica migraciones pendientes
pnpm db:studio                 # UI web de drizzle (browse DB)

# Polls review queue
pnpm tsx scripts/review-polls.ts list
pnpm tsx scripts/review-polls.ts approve <id>
pnpm tsx scripts/review-polls.ts reject <id>
\`\`\`

## Estructura

Ver `docs/superpowers/plans/` para los planes por fase.
```

- [ ] **Step 3: Smoke E2E desde cero**

```bash
docker compose down -v
docker compose up -d
sleep 5
pnpm db:migrate
pnpm tsx scripts/seed-pollsters.ts
pnpm worker > /tmp/e2e2.log 2>&1 &
WORKER_PID=$!
sleep 120
kill -INT $WORKER_PID
sleep 3
tail -40 /tmp/e2e2.log
```

Expected: ingest de polymarket + news + polls (al menos arranco; insert real depende de lo que postean los pollsters esa semana).

- [ ] **Step 4: Verificar DB**

```bash
docker exec politica-pg psql -U politica -d politica -c "
  SELECT 'markets' AS tbl, count(*) FROM markets
  UNION ALL SELECT 'market_prices', count(*) FROM market_prices
  UNION ALL SELECT 'news', count(*) FROM news
  UNION ALL SELECT 'pollsters', count(*) FROM pollsters
  UNION ALL SELECT 'polls', count(*) FROM polls
  ORDER BY tbl;
"
```

Expected: pollsters=10, markets/news>0, polls puede ser 0 (depende de los timelines).

- [ ] **Step 5: Run de la suite completa**

```bash
pnpm test && pnpm typecheck
```

Expected: todo pasa. ~25 tests.

- [ ] **Step 6: Probar el review CLI**

```bash
pnpm tsx scripts/review-polls.ts list
```

Expected: imprime polls pending_review, o "0 polls in pending_review" si no hubo encuestas reales.

- [ ] **Step 7: Commit**

```bash
git add scripts/review-polls.ts README.md
git commit -m "$(cat <<'EOF'
feat(polls): review CLI + README updates

scripts/review-polls.ts: list/approve/reject polls en pending_review
desde la terminal (la UI viene en fase 4 con el publisher). README
agrega setup de polls (X bearer token, ANTHROPIC_API_KEY, seed step).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Cierre de Fase 2

Al terminar todas las tareas:

- [ ] **Verificación final**
  - `pnpm test` pasa (~25 tests)
  - `pnpm typecheck` pasa
  - `pnpm worker` arranca con SDK transport sin errores
  - Tablas pollsters (10) + polls (>=0) presentes
  - Review CLI funciona (`list`, `approve`, `reject`)
- [ ] **Notas para Fase 3**:
  - Si los pollsters no están posteando encuestas con frecuencia, considerar agregar fuentes adicionales (notas periodísticas que reportan polls — re-extraer desde imagen de la nota).
  - Documentar la tasa de aprobación manual de polls (% de pending_review que aprobaste). Si es >90%, vale la pena auto-aprobar `confidence=alto` desde la próxima fase.
  - Anotar costo USD/día observado del SDK (Sonnet vision es la operación más cara).
  - Capturar 1-2 ejemplos reales de fallas en extracción para usarlos como golden test set en Fase 3.
- [ ] **Output operacional al final de Fase 2**: tres pipelines (Polymarket + News + Polls) corriendo en local, con datos en DB review-able vía CLI. Costos USD ~50-100/mes según volumen real de pollster posts.
