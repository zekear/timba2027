# Política Bot — Fase 1: Foundation + Ingestion Pipelines

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap el proyecto y construir los pipelines de ingestion de Polymarket y noticias RSS, corriendo en Docker local sobre Mac mini. Al terminar esta fase, el sistema ingiere continuamente precios de Polymarket (cada 15 min) y artículos de medios argentinos (cada 15 min con tagging LLM) hacia Postgres local, listo para alimentar las fases siguientes (polls, trigger engine, publisher).

**Architecture:** Proyecto TypeScript único corriendo en Node 20+. Postgres 16 en Docker para dev local. Workers son procesos Node invocados vía scripts `pnpm`; scheduling con `node-cron`. Acceso LLM detrás de una interfaz abstracta — esta fase implementa el transporte CLI (shellea a `claude -p`); el transporte SDK se agrega en una fase posterior. Sin Next.js todavía — UI viene en Fase 5.

**Tech Stack:** TypeScript 5.x, pnpm, tsx (ejecutor de TS sin build), Drizzle ORM, Postgres 16, node-cron, vitest, rss-parser, zod, dotenv, child_process (para shellear `claude` CLI).

**Tiempo estimado:** 2-3 semanas a 8-10 hrs/semana.

**Pre-requisitos:**
- Mac mini con Docker Desktop instalado
- `pnpm` instalado globalmente (`npm i -g pnpm`)
- `claude` CLI (Claude Code) instalado y autenticado en el host
- Node 20+ (`node --version`)

---

## Estructura de archivos al final de la Fase 1

```
/Users/zeke/Documents/Projects/Personal/politica/
├── DESIGN.md                          (ya existe)
├── docs/                              (ya existe)
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── .env.example
├── .env                               (gitignored)
├── .gitignore
├── docker-compose.yml
├── drizzle.config.ts
├── vitest.config.ts
├── src/
│   ├── lib/
│   │   ├── env.ts                     (carga + valida env vars)
│   │   └── logger.ts                  (pino-based, JSON structured logs)
│   ├── db/
│   │   ├── client.ts                  (drizzle + pg pool)
│   │   ├── schema.ts                  (todas las tablas)
│   │   └── migrations/                (generadas por drizzle-kit)
│   ├── llm/
│   │   ├── types.ts                   (interface LLMClient)
│   │   ├── cli.ts                     (ClaudeCLIClient: shellea a `claude -p`)
│   │   └── index.ts                   (factory: lee LLM_TRANSPORT env var)
│   ├── sources/
│   │   ├── polymarket/
│   │   │   ├── client.ts              (HTTP client de Polymarket)
│   │   │   ├── ingest.ts              (fetch markets + insert)
│   │   │   └── moves.ts               (detect movements >threshold)
│   │   └── news/
│   │       ├── feeds.ts               (lista de RSS feeds)
│   │       ├── ingest.ts              (parse + dedupe + insert)
│   │       └── tagger.ts              (LLM tag: candidates, category, relevance)
│   └── workers/
│       └── orchestrator.ts            (entry point: cron schedule todos los workers)
├── tests/
│   ├── fixtures/
│   │   ├── polymarket-response.json   (snapshot real de Polymarket API)
│   │   └── rss-clarin.xml             (snapshot de feed RSS)
│   ├── llm/cli.test.ts
│   ├── sources/polymarket/moves.test.ts
│   └── sources/news/ingest.test.ts
└── scripts/
    └── seed-pollsters.ts              (placeholder; se usa en fase 2)
```

---

## Task 1: Bootstrap del proyecto (TypeScript + pnpm + tsconfig)

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `.env.example`

- [ ] **Step 1: Crear package.json con scripts y dependencies base**

```bash
cd /Users/zeke/Documents/Projects/Personal/politica
cat > package.json <<'EOF'
{
  "name": "politica",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=20.0.0"
  },
  "scripts": {
    "dev": "tsx watch src/workers/orchestrator.ts",
    "worker": "tsx src/workers/orchestrator.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "drizzle-orm": "^0.36.0",
    "pg": "^8.13.0",
    "node-cron": "^3.0.3",
    "rss-parser": "^3.13.0",
    "zod": "^3.23.8",
    "dotenv": "^16.4.5",
    "pino": "^9.5.0",
    "pino-pretty": "^11.3.0"
  },
  "devDependencies": {
    "@types/node": "^22.9.0",
    "@types/pg": "^8.11.10",
    "@types/node-cron": "^3.0.11",
    "drizzle-kit": "^0.28.0",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "vitest": "^2.1.5"
  }
}
EOF
```

- [ ] **Step 2: Crear tsconfig.json**

```bash
cat > tsconfig.json <<'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": false,
    "verbatimModuleSyntax": false,
    "noEmit": true,
    "outDir": "dist",
    "rootDir": ".",
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src/**/*", "tests/**/*", "scripts/**/*", "drizzle.config.ts", "vitest.config.ts"],
  "exclude": ["node_modules", "dist"]
}
EOF
```

- [ ] **Step 3: Crear .gitignore**

```bash
cat > .gitignore <<'EOF'
node_modules/
dist/
.env
.env.local
*.log
.DS_Store
coverage/
.vitest/
drizzle/
EOF
```

- [ ] **Step 4: Crear .env.example**

```bash
cat > .env.example <<'EOF'
# Database
DATABASE_URL=postgresql://politica:politica@localhost:5432/politica

# LLM
LLM_TRANSPORT=cli                      # cli | sdk
LLM_CLI_BIN=claude                     # path al binario de claude CLI
LLM_CLI_TIMEOUT_MS=60000               # timeout por llamada CLI

# Logging
LOG_LEVEL=info                         # debug | info | warn | error

# Polymarket
POLYMARKET_API_BASE=https://gamma-api.polymarket.com
POLYMARKET_POLL_INTERVAL_MIN=15
MARKET_MOVE_THRESHOLD_PCT=2

# News
NEWS_POLL_INTERVAL_MIN=15

# Environment
NODE_ENV=development
EOF

cp .env.example .env
```

- [ ] **Step 5: Instalar dependencies**

```bash
pnpm install
```

Expected: `pnpm-lock.yaml` se crea, `node_modules/` se popula.

- [ ] **Step 6: Verificar typecheck pasa con archivos vacíos**

```bash
mkdir -p src
pnpm typecheck
```

Expected: PASS (0 errors).

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json .gitignore .env.example
git commit -m "chore: bootstrap TypeScript project with pnpm

Initial dependencies: drizzle-orm, pg, node-cron, rss-parser, zod, pino,
vitest, tsx. Sets the foundation for the ingestion pipelines.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Postgres en Docker

**Files:**
- Create: `docker-compose.yml`

- [ ] **Step 1: Crear docker-compose.yml con solo Postgres**

```bash
cat > docker-compose.yml <<'EOF'
# Dev local: solo Postgres en container.
# App + worker corren en host (más rápido para iterar).
# El compose de prod (futura fase 5) containeriza todo.
services:
  postgres:
    image: postgres:16
    container_name: politica-pg
    environment:
      POSTGRES_USER: politica
      POSTGRES_PASSWORD: politica
      POSTGRES_DB: politica
    ports:
      - "5432:5432"
    volumes:
      - pg_data:/var/lib/postgresql/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U politica"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  pg_data:
EOF
```

- [ ] **Step 2: Levantar Postgres y verificar conexión**

```bash
docker compose up -d
docker compose ps
```

Expected: `politica-pg` con status `Up (healthy)` (puede tardar 10-15s).

- [ ] **Step 3: Probar conexión psql**

```bash
docker exec -it politica-pg psql -U politica -d politica -c "SELECT version();"
```

Expected: PostgreSQL 16.x version string.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "chore: add Postgres docker-compose for local dev

Postgres 16 en container con healthcheck y volumen persistente.
App y workers corren en host por simplicidad de iteración.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Env loader y logger

**Files:**
- Create: `src/lib/env.ts`
- Create: `src/lib/logger.ts`

- [ ] **Step 1: Crear src/lib/env.ts con validación zod**

```bash
mkdir -p src/lib
cat > src/lib/env.ts <<'EOF'
import { config } from 'dotenv';
import { z } from 'zod';

config();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  LLM_TRANSPORT: z.enum(['cli', 'sdk']).default('cli'),
  LLM_CLI_BIN: z.string().default('claude'),
  LLM_CLI_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  POLYMARKET_API_BASE: z.string().url().default('https://gamma-api.polymarket.com'),
  POLYMARKET_POLL_INTERVAL_MIN: z.coerce.number().int().positive().default(15),
  MARKET_MOVE_THRESHOLD_PCT: z.coerce.number().positive().default(2),
  NEWS_POLL_INTERVAL_MIN: z.coerce.number().int().positive().default(15),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid env');
}

export const env = parsed.data;
EOF
```

- [ ] **Step 2: Crear src/lib/logger.ts**

```bash
cat > src/lib/logger.ts <<'EOF'
import pino from 'pino';
import { env } from './env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  transport: env.NODE_ENV === 'development'
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
    : undefined,
});

export type Logger = typeof logger;
EOF
```

- [ ] **Step 3: Smoke test del env loader**

```bash
pnpm tsx -e "import { env } from './src/lib/env.js'; console.log(env);"
```

Expected: imprime objeto con todas las env vars resueltas. Si falta alguna, falla con error claro.

- [ ] **Step 4: Smoke test del logger**

```bash
pnpm tsx -e "import { logger } from './src/lib/logger.js'; logger.info({ test: true }, 'hello');"
```

Expected: log JSON o pretty (según NODE_ENV), nivel `info`, mensaje "hello", contexto `{ test: true }`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/
git commit -m "feat: add env loader (zod-validated) and pino logger

env.ts valida las variables de entorno al arranque y falla rápido si
faltan. logger.ts usa pino con pretty-print en dev.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Drizzle setup + schema inicial

**Files:**
- Create: `drizzle.config.ts`
- Create: `src/db/schema.ts`
- Create: `src/db/client.ts`

- [ ] **Step 1: Crear drizzle.config.ts**

```bash
cat > drizzle.config.ts <<'EOF'
import { defineConfig } from 'drizzle-kit';
import { env } from './src/lib/env.js';

export default defineConfig({
  out: './src/db/migrations',
  schema: './src/db/schema.ts',
  dialect: 'postgresql',
  dbCredentials: { url: env.DATABASE_URL },
  verbose: true,
  strict: true,
});
EOF
```

- [ ] **Step 2: Crear src/db/schema.ts con tablas de Fase 1**

```bash
mkdir -p src/db
cat > src/db/schema.ts <<'EOF'
import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  numeric,
  boolean,
  jsonb,
  index,
  uniqueIndex,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ──────────────────────────────────────────────────────────────────
// Polymarket
// ──────────────────────────────────────────────────────────────────

export const markets = pgTable('markets', {
  id: text('id').primaryKey(),                    // polymarket market id
  slug: text('slug').notNull(),
  question: text('question').notNull(),
  candidates: jsonb('candidates').$type<string[]>().notNull(), // ["Milei", "Kicillof", ...]
  endDate: timestamp('end_date', { withTimezone: true }),
  status: text('status').notNull(),               // open | closed | resolved
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const marketPrices = pgTable(
  'market_prices',
  {
    id: serial('id').primaryKey(),
    marketId: text('market_id').notNull().references(() => markets.id),
    candidate: text('candidate').notNull(),
    price: numeric('price', { precision: 6, scale: 4 }).notNull(),  // 0.0000–1.0000
    volume24h: numeric('volume_24h', { precision: 14, scale: 2 }),
    ts: timestamp('ts', { withTimezone: true }).notNull(),
  },
  (t) => ({
    candidateTsIdx: index('market_prices_candidate_ts_idx').on(t.candidate, t.ts),
    marketCandidateTsIdx: index('market_prices_market_candidate_ts_idx').on(t.marketId, t.candidate, t.ts),
  }),
);

// ──────────────────────────────────────────────────────────────────
// News
// ──────────────────────────────────────────────────────────────────

export const newsCategoryEnum = pgEnum('news_category', [
  'campania',
  'gobierno',
  'economia',
  'escandalo',
  'debate',
  'otro',
]);

export const news = pgTable(
  'news',
  {
    id: serial('id').primaryKey(),
    source: text('source').notNull(),                    // 'clarin' | 'lanacion' | etc.
    url: text('url').notNull(),
    headline: text('headline').notNull(),
    bodyExcerpt: text('body_excerpt'),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
    candidatesMentioned: jsonb('candidates_mentioned').$type<string[]>().default([]).notNull(),
    category: newsCategoryEnum('category'),
    relevanceScore: numeric('relevance_score', { precision: 3, scale: 2 }), // 0.00–1.00
    taggedAt: timestamp('tagged_at', { withTimezone: true }),               // null = pending tag
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    urlUq: uniqueIndex('news_url_uq').on(t.url),
    publishedIdx: index('news_published_idx').on(t.publishedAt),
    pendingTagIdx: index('news_pending_tag_idx').on(t.taggedAt).where(sql`tagged_at IS NULL`),
  }),
);

// ──────────────────────────────────────────────────────────────────
// Eventos (cola para fase 3)
// ──────────────────────────────────────────────────────────────────

export const events = pgTable(
  'events',
  {
    id: serial('id').primaryKey(),
    type: text('type').notNull(),                        // MARKET_MOVE | NEW_POLL | HOT_NEWS
    payload: jsonb('payload').notNull(),
    status: text('status').notNull().default('pending'), // pending | processed | discarded
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => ({
    pendingIdx: index('events_pending_idx').on(t.status, t.createdAt),
  }),
);
EOF
```

- [ ] **Step 3: Crear src/db/client.ts**

```bash
cat > src/db/client.ts <<'EOF'
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../lib/env.js';
import * as schema from './schema.js';

const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

export const db = drizzle(pool, { schema });
export type DB = typeof db;
EOF
```

- [ ] **Step 4: Generar la primera migración**

```bash
pnpm db:generate
```

Expected: archivo `src/db/migrations/0000_*.sql` creado.

- [ ] **Step 5: Aplicar la migración**

```bash
pnpm db:migrate
```

Expected: `[✓] migrations applied successfully`.

- [ ] **Step 6: Verificar tablas en Postgres**

```bash
docker exec politica-pg psql -U politica -d politica -c "\dt"
```

Expected: lista incluye `markets`, `market_prices`, `news`, `events`, `__drizzle_migrations`.

- [ ] **Step 7: Commit**

```bash
git add drizzle.config.ts src/db/
git commit -m "feat(db): initial schema with markets, market_prices, news, events

Drizzle ORM con Postgres. Schema cubre Polymarket (markets + timeseries
de precios), noticias (con tagging diferido), y events queue (para fase 3).
Índices estratégicos para queries de movimiento y de news pendientes de tag.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Vitest setup

**Files:**
- Create: `vitest.config.ts`

- [ ] **Step 1: Crear vitest.config.ts**

```bash
cat > vitest.config.ts <<'EOF'
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    setupFiles: [],
    testTimeout: 30_000,
  },
});
EOF
```

- [ ] **Step 2: Crear test smoke trivial**

```bash
mkdir -p tests
cat > tests/smoke.test.ts <<'EOF'
import { describe, it, expect } from 'vitest';

describe('smoke', () => {
  it('arithmetic still works', () => {
    expect(2 + 2).toBe(4);
  });
});
EOF
```

- [ ] **Step 3: Correr tests**

```bash
pnpm test
```

Expected: 1 test passed.

- [ ] **Step 4: Borrar el smoke test (no aporta valor)**

```bash
rm tests/smoke.test.ts
```

- [ ] **Step 5: Commit (solo config; tests reales vienen en tasks siguientes)**

```bash
git add vitest.config.ts
git commit -m "chore: add vitest config

Tests live under tests/, espejando la estructura de src/.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: LLM transport interface (types only)

**Files:**
- Create: `src/llm/types.ts`

- [ ] **Step 1: Crear src/llm/types.ts**

```bash
mkdir -p src/llm
cat > src/llm/types.ts <<'EOF'
/**
 * Abstracción de transporte LLM.
 *
 * En fase 1 solo existe ClaudeCLIClient (shellea a `claude -p`).
 * En fase posterior se agrega ClaudeSDKClient (@anthropic-ai/sdk).
 * El consumidor importa `llm` de ./index.ts y no sabe cuál hay debajo.
 */

export type LLMModel = 'haiku' | 'sonnet';

export interface LLMClient {
  /**
   * Pregunta corta de clasificación. Devuelve el output crudo del LLM (texto).
   * El llamador parsea (sí/no/duda, JSON, etc.) según su contrato.
   */
  classify(prompt: string, opts?: { model?: LLMModel }): Promise<string>;

  /**
   * Extracción estructurada desde una imagen.
   * El prompt debe pedir JSON output explícitamente.
   * Devuelve el texto crudo (típicamente JSON); el llamador hace JSON.parse + zod.
   */
  extractFromImage(prompt: string, image: Buffer, opts?: { model?: LLMModel }): Promise<string>;

  /**
   * Generación de texto libre con prompt + contexto inyectado.
   * Usa modelo por default (haiku) salvo override.
   */
  generateText(prompt: string, opts?: { model?: LLMModel }): Promise<string>;
}

export class LLMError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'LLMError';
  }
}
EOF
```

- [ ] **Step 2: Verificar typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/llm/types.ts
git commit -m "feat(llm): define LLMClient interface

Tres operaciones: classify, extractFromImage, generateText. Permite
swap CLI↔SDK sin tocar callers.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: ClaudeCLIClient (TDD)

**Files:**
- Create: `tests/llm/cli.test.ts`
- Create: `src/llm/cli.ts`

- [ ] **Step 1: Escribir test de classify (failing)**

```bash
mkdir -p tests/llm
cat > tests/llm/cli.test.ts <<'EOF'
import { describe, it, expect } from 'vitest';
import { ClaudeCLIClient } from '../../src/llm/cli.js';

describe('ClaudeCLIClient', () => {
  it('classify returns trimmed string output', async () => {
    const client = new ClaudeCLIClient();
    const result = await client.classify(
      'Respondé únicamente con la palabra "ok" (sin comillas, sin nada más).',
    );
    expect(result.toLowerCase()).toContain('ok');
  }, 60_000);

  it('generateText returns non-empty string', async () => {
    const client = new ClaudeCLIClient();
    const result = await client.generateText('Decí "hola" en una sola palabra.');
    expect(result.length).toBeGreaterThan(0);
  }, 60_000);
});
EOF
```

- [ ] **Step 2: Correr test (debe fallar — el archivo no existe)**

```bash
pnpm test tests/llm/cli.test.ts
```

Expected: FAIL con error de "Cannot find module".

- [ ] **Step 3: Implementar src/llm/cli.ts**

```bash
cat > src/llm/cli.ts <<'EOF'
import { spawn } from 'node:child_process';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';
import { LLMError, type LLMClient, type LLMModel } from './types.js';

/**
 * Shell-out client a `claude -p "$prompt" --output-format text`.
 * Pensado para fase de prototipo. Latencia ~1-2s/call por startup del CLI.
 */
export class ClaudeCLIClient implements LLMClient {
  async classify(prompt: string, opts: { model?: LLMModel } = {}): Promise<string> {
    return this.runCli(prompt, opts.model);
  }

  async generateText(prompt: string, opts: { model?: LLMModel } = {}): Promise<string> {
    return this.runCli(prompt, opts.model);
  }

  async extractFromImage(
    prompt: string,
    image: Buffer,
    opts: { model?: LLMModel } = {},
  ): Promise<string> {
    // CLI no acepta imágenes vía stdin; escribimos a archivo temp y referenciamos.
    const tmpPath = join(tmpdir(), `politica-${randomUUID()}.png`);
    await writeFile(tmpPath, image);
    try {
      // El CLI acepta @path/to/file.png como referencia inline en el prompt.
      const promptWithImage = `${prompt}\n\n@${tmpPath}`;
      return await this.runCli(promptWithImage, opts.model ?? 'sonnet');
    } finally {
      await unlink(tmpPath).catch(() => undefined);
    }
  }

  private runCli(prompt: string, model?: LLMModel): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = ['-p', prompt, '--output-format', 'text'];
      if (model === 'haiku') args.push('--model', 'claude-haiku-4-5');
      if (model === 'sonnet') args.push('--model', 'claude-sonnet-4-6');

      const proc = spawn(env.LLM_CLI_BIN, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new LLMError(`CLI timeout after ${env.LLM_CLI_TIMEOUT_MS}ms`));
      }, env.LLM_CLI_TIMEOUT_MS);

      proc.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
      proc.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(new LLMError(`Failed to spawn ${env.LLM_CLI_BIN}: ${err.message}`, err));
      });
      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          logger.warn({ stderr, code }, 'claude CLI exited non-zero');
          reject(new LLMError(`CLI exit code ${code}: ${stderr.slice(0, 500)}`));
          return;
        }
        resolve(stdout.trim());
      });
    });
  }
}
EOF
```

- [ ] **Step 4: Correr test (debe pasar)**

```bash
pnpm test tests/llm/cli.test.ts
```

Expected: 2 tests passed. Si falla con timeout o error de auth, verificar que `claude` CLI esté instalado y autenticado en el host: `which claude && claude --version`.

- [ ] **Step 5: Crear src/llm/index.ts (factory)**

```bash
cat > src/llm/index.ts <<'EOF'
import { env } from '../lib/env.js';
import { ClaudeCLIClient } from './cli.js';
import type { LLMClient } from './types.js';

function createClient(): LLMClient {
  switch (env.LLM_TRANSPORT) {
    case 'cli':
      return new ClaudeCLIClient();
    case 'sdk':
      throw new Error('SDK transport not implemented yet (fase posterior)');
  }
}

export const llm: LLMClient = createClient();
export type { LLMClient } from './types.js';
EOF
```

- [ ] **Step 6: Commit**

```bash
git add src/llm/cli.ts src/llm/index.ts tests/llm/
git commit -m "feat(llm): implement CLI transport with smoke tests

Shell-out a 'claude -p' con timeout y manejo de errores.
Factory en src/llm/index.ts elige transport via LLM_TRANSPORT env var.
Tests verifican que el CLI responde para classify y generateText.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Polymarket client + types

**Files:**
- Create: `src/sources/polymarket/client.ts`
- Create: `src/sources/polymarket/types.ts`

- [ ] **Step 1: Crear types.ts con shape esperado de la API**

```bash
mkdir -p src/sources/polymarket
cat > src/sources/polymarket/types.ts <<'EOF'
import { z } from 'zod';

// Schema parcial de la respuesta de Gamma API (solo los campos que usamos).
// Polymarket API devuelve mucho más; aceptamos passthrough para no romper si agregan campos.
export const polymarketEventSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string().optional(),
  endDate: z.string().datetime().optional(),
  closed: z.boolean().optional(),
  archived: z.boolean().optional(),
  markets: z.array(
    z.object({
      id: z.string(),
      question: z.string(),
      outcomes: z.string(),     // JSON-encoded array string, e.g. '["Yes","No"]'
      outcomePrices: z.string(),// JSON-encoded array string of prices
      volume24hr: z.union([z.string(), z.number()]).optional(),
      groupItemTitle: z.string().optional(), // candidato si es multi-outcome event
    }),
  ),
});

export type PolymarketEvent = z.infer<typeof polymarketEventSchema>;
EOF
```

- [ ] **Step 2: Crear client.ts (HTTP client minimalista)**

```bash
cat > src/sources/polymarket/client.ts <<'EOF'
import { env } from '../../lib/env.js';
import { logger } from '../../lib/logger.js';
import { polymarketEventSchema, type PolymarketEvent } from './types.js';

/**
 * Fetch eventos de Polymarket por tag o slug.
 * El endpoint Gamma `/events` permite filtrar por `tag_slug=argentina-elections-2027` o similar.
 */
export async function fetchEventsByTag(tagSlug: string): Promise<PolymarketEvent[]> {
  const url = `${env.POLYMARKET_API_BASE}/events?tag_slug=${encodeURIComponent(tagSlug)}&closed=false&archived=false&limit=50`;
  logger.debug({ url }, 'polymarket: fetching events');

  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`Polymarket fetch failed: ${res.status} ${res.statusText}`);
  }

  const json: unknown = await res.json();
  if (!Array.isArray(json)) {
    throw new Error(`Polymarket returned non-array: ${typeof json}`);
  }

  const parsed: PolymarketEvent[] = [];
  for (const item of json) {
    const result = polymarketEventSchema.safeParse(item);
    if (result.success) {
      parsed.push(result.data);
    } else {
      logger.warn({ errors: result.error.flatten() }, 'polymarket: skipping malformed event');
    }
  }
  return parsed;
}
EOF
```

- [ ] **Step 3: Smoke test (NO automated test — validamos contra API real una vez)**

```bash
pnpm tsx -e "
import { fetchEventsByTag } from './src/sources/polymarket/client.js';
const events = await fetchEventsByTag('argentina');
console.log('Fetched', events.length, 'events');
events.slice(0, 3).forEach(e => console.log(' -', e.slug, '|', e.markets.length, 'markets'));
"
```

Expected: imprime cantidad de eventos y los primeros 3 slugs. Si el tag `argentina` no existe en Polymarket, probar otros: `argentine-presidential-election`, `argentina-elections`, `argentina-2027`. Anotar el slug correcto en `.env` o constants.

- [ ] **Step 4: Commit**

```bash
git add src/sources/polymarket/
git commit -m "feat(polymarket): minimal Gamma API client

fetchEventsByTag con validación zod parcial (passthrough para campos
nuevos). Logger warns sobre eventos malformados sin abortar.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Polymarket ingest worker (TDD del normalizer)

**Files:**
- Create: `tests/fixtures/polymarket-event.json`
- Create: `tests/sources/polymarket/normalize.test.ts`
- Create: `src/sources/polymarket/normalize.ts`
- Create: `src/sources/polymarket/ingest.ts`

- [ ] **Step 1: Capturar fixture real desde la API**

```bash
mkdir -p tests/fixtures
pnpm tsx -e "
import { fetchEventsByTag } from './src/sources/polymarket/client.js';
import { writeFileSync } from 'fs';
const events = await fetchEventsByTag('argentina');
const sample = events.find(e => e.markets.length > 1) ?? events[0];
writeFileSync('tests/fixtures/polymarket-event.json', JSON.stringify(sample, null, 2));
console.log('Wrote', sample?.slug);
"
```

Expected: `tests/fixtures/polymarket-event.json` creado con un evento real de AR.

- [ ] **Step 2: Escribir test del normalizer (failing)**

```bash
mkdir -p tests/sources/polymarket
cat > tests/sources/polymarket/normalize.test.ts <<'EOF'
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { normalizeEvent } from '../../../src/sources/polymarket/normalize.js';
import { polymarketEventSchema } from '../../../src/sources/polymarket/types.js';

const raw = JSON.parse(readFileSync('tests/fixtures/polymarket-event.json', 'utf-8'));
const event = polymarketEventSchema.parse(raw);

describe('normalizeEvent', () => {
  it('returns one market record per polymarket event', () => {
    const { market } = normalizeEvent(event);
    expect(market.id).toBe(event.id);
    expect(market.slug).toBe(event.slug);
    expect(market.candidates.length).toBeGreaterThan(0);
  });

  it('returns one price record per (market, candidate)', () => {
    const { prices } = normalizeEvent(event);
    expect(prices.length).toBe(event.markets.length);
    for (const p of prices) {
      const numericPrice = Number(p.price);
      expect(numericPrice).toBeGreaterThanOrEqual(0);
      expect(numericPrice).toBeLessThanOrEqual(1);
      expect(p.candidate).toBeTruthy();
    }
  });

  it('extracts candidate names into the market.candidates array', () => {
    const { market, prices } = normalizeEvent(event);
    for (const p of prices) {
      expect(market.candidates).toContain(p.candidate);
    }
  });
});
EOF
```

- [ ] **Step 3: Correr test (debe fallar — normalize.ts no existe)**

```bash
pnpm test tests/sources/polymarket/normalize.test.ts
```

Expected: FAIL "Cannot find module".

- [ ] **Step 4: Implementar normalize.ts**

```bash
cat > src/sources/polymarket/normalize.ts <<'EOF'
import type { PolymarketEvent } from './types.js';
import type { markets, marketPrices } from '../../db/schema.js';
import type { InferInsertModel } from 'drizzle-orm';

type MarketInsert = InferInsertModel<typeof markets>;
type PriceInsert = Omit<InferInsertModel<typeof marketPrices>, 'id'>;

export interface NormalizedEvent {
  market: MarketInsert;
  prices: PriceInsert[];
}

/**
 * Polymarket events de elección suelen tener:
 *   - 1 event con N markets (uno por candidato)
 *   - cada market tiene outcomes ["Yes","No"] y outcomePrices ["0.52","0.48"]
 *   - el "candidato" se infiere de market.groupItemTitle o de market.question
 */
export function normalizeEvent(event: PolymarketEvent): NormalizedEvent {
  const ts = new Date();
  const candidates: string[] = [];
  const prices: PriceInsert[] = [];

  for (const market of event.markets) {
    const candidate =
      market.groupItemTitle?.trim() ||
      market.question.replace(/^Will\s+/i, '').replace(/\s+win\b.*$/i, '').trim();
    candidates.push(candidate);

    const outcomes = JSON.parse(market.outcomes) as string[];
    const outcomePrices = JSON.parse(market.outcomePrices) as string[];
    const yesIdx = outcomes.findIndex((o) => o.toLowerCase() === 'yes');
    if (yesIdx === -1) continue;
    const yesPrice = outcomePrices[yesIdx];
    if (!yesPrice) continue;

    prices.push({
      marketId: event.id,
      candidate,
      price: yesPrice,
      volume24h:
        typeof market.volume24hr === 'number'
          ? market.volume24hr.toFixed(2)
          : market.volume24hr ?? null,
      ts,
    });
  }

  return {
    market: {
      id: event.id,
      slug: event.slug,
      question: event.title,
      candidates,
      endDate: event.endDate ? new Date(event.endDate) : null,
      status: event.closed ? 'closed' : event.archived ? 'archived' : 'open',
    },
    prices,
  };
}
EOF
```

- [ ] **Step 5: Correr tests (deben pasar)**

```bash
pnpm test tests/sources/polymarket/normalize.test.ts
```

Expected: 3 tests passed.

- [ ] **Step 6: Implementar ingest.ts (orquestador: fetch → normalize → upsert)**

```bash
cat > src/sources/polymarket/ingest.ts <<'EOF'
import { db } from '../../db/client.js';
import { markets, marketPrices } from '../../db/schema.js';
import { logger } from '../../lib/logger.js';
import { fetchEventsByTag } from './client.js';
import { normalizeEvent } from './normalize.js';

const TAG_SLUGS = ['argentina', 'argentine-presidential-election', 'argentina-elections'];

export async function runPolymarketIngest(): Promise<{ markets: number; prices: number }> {
  const start = Date.now();
  const seen = new Set<string>();
  let marketsCount = 0;
  let pricesCount = 0;

  for (const tag of TAG_SLUGS) {
    const events = await fetchEventsByTag(tag);
    for (const event of events) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);

      const { market, prices } = normalizeEvent(event);

      await db
        .insert(markets)
        .values(market)
        .onConflictDoUpdate({
          target: markets.id,
          set: {
            slug: market.slug,
            question: market.question,
            candidates: market.candidates,
            endDate: market.endDate,
            status: market.status,
            updatedAt: new Date(),
          },
        });
      marketsCount++;

      if (prices.length) {
        await db.insert(marketPrices).values(prices);
        pricesCount += prices.length;
      }
    }
  }

  logger.info(
    { marketsCount, pricesCount, ms: Date.now() - start },
    'polymarket: ingest complete',
  );
  return { markets: marketsCount, prices: pricesCount };
}
EOF
```

- [ ] **Step 7: Smoke test del ingest end-to-end**

```bash
pnpm tsx -e "import { runPolymarketIngest } from './src/sources/polymarket/ingest.js'; await runPolymarketIngest(); process.exit(0);"
```

Expected: log "polymarket: ingest complete" con counts > 0.

- [ ] **Step 8: Verificar datos en DB**

```bash
docker exec politica-pg psql -U politica -d politica -c "SELECT slug, jsonb_array_length(candidates) FROM markets;"
docker exec politica-pg psql -U politica -d politica -c "SELECT candidate, price, ts FROM market_prices ORDER BY ts DESC LIMIT 10;"
```

Expected: tabla `markets` con eventos AR, `market_prices` con precios entre 0 y 1.

- [ ] **Step 9: Commit**

```bash
git add src/sources/polymarket/normalize.ts src/sources/polymarket/ingest.ts tests/fixtures/polymarket-event.json tests/sources/polymarket/
git commit -m "feat(polymarket): normalize + ingest pipeline

normalize.ts convierte Polymarket Gamma events en filas de markets +
market_prices (TDD contra fixture real). ingest.ts itera tags AR,
upserta markets y appendea snapshots de precios.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Detección de movimientos de mercado (TDD)

**Files:**
- Create: `tests/sources/polymarket/moves.test.ts`
- Create: `src/sources/polymarket/moves.ts`

- [ ] **Step 1: Escribir test del detector (failing)**

```bash
cat > tests/sources/polymarket/moves.test.ts <<'EOF'
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../../src/db/client.js';
import { markets, marketPrices } from '../../../src/db/schema.js';
import { detectMoves } from '../../../src/sources/polymarket/moves.js';
import { sql } from 'drizzle-orm';

const TEST_MARKET_ID = 'test-market-moves';

beforeEach(async () => {
  await db.execute(sql`DELETE FROM market_prices WHERE market_id = ${TEST_MARKET_ID}`);
  await db.execute(sql`DELETE FROM markets WHERE id = ${TEST_MARKET_ID}`);
  await db.insert(markets).values({
    id: TEST_MARKET_ID,
    slug: 'test',
    question: 'Test market',
    candidates: ['Alice', 'Bob'],
    status: 'open',
  });
});

describe('detectMoves', () => {
  it('reports a move when delta exceeds threshold within window', async () => {
    const now = new Date();
    const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);
    await db.insert(marketPrices).values([
      { marketId: TEST_MARKET_ID, candidate: 'Alice', price: '0.4000', ts: sixHoursAgo },
      { marketId: TEST_MARKET_ID, candidate: 'Alice', price: '0.4500', ts: now },
    ]);

    const moves = await detectMoves({ thresholdPct: 2, windowHours: 6 });
    const aliceMove = moves.find((m) => m.candidate === 'Alice' && m.marketId === TEST_MARKET_ID);
    expect(aliceMove).toBeDefined();
    expect(aliceMove!.deltaPct).toBeCloseTo(5, 1); // 0.45 - 0.40 = 0.05 = 5pp
  });

  it('does not report a move under threshold', async () => {
    const now = new Date();
    const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);
    await db.insert(marketPrices).values([
      { marketId: TEST_MARKET_ID, candidate: 'Bob', price: '0.4000', ts: sixHoursAgo },
      { marketId: TEST_MARKET_ID, candidate: 'Bob', price: '0.4100', ts: now }, // 1pp delta
    ]);

    const moves = await detectMoves({ thresholdPct: 2, windowHours: 6 });
    const bobMove = moves.find((m) => m.candidate === 'Bob' && m.marketId === TEST_MARKET_ID);
    expect(bobMove).toBeUndefined();
  });
});
EOF
```

- [ ] **Step 2: Correr test (debe fallar — moves.ts no existe)**

```bash
pnpm test tests/sources/polymarket/moves.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implementar moves.ts**

```bash
cat > src/sources/polymarket/moves.ts <<'EOF'
import { sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';

export interface MarketMove {
  marketId: string;
  candidate: string;
  priceNow: number;
  priceThen: number;
  deltaPct: number;       // points percentuales (puede ser negativo)
  windowHours: number;
  detectedAt: Date;
}

/**
 * Detecta candidatos cuyo precio se movió más de `thresholdPct` (en pp)
 * dentro de las últimas `windowHours` horas.
 *
 * Lógica:
 *   priceNow   = precio más reciente (último ts)
 *   priceThen  = precio más cercano a (now - windowHours)
 *   deltaPct   = (priceNow - priceThen) * 100
 */
export async function detectMoves(opts: {
  thresholdPct: number;
  windowHours: number;
}): Promise<MarketMove[]> {
  const { thresholdPct, windowHours } = opts;
  const now = new Date();

  // Para cada (market_id, candidate), traemos el precio más reciente
  // y el precio más cercano al borde de la ventana.
  const rows = await db.execute(sql`
    WITH latest AS (
      SELECT DISTINCT ON (market_id, candidate)
        market_id, candidate, price::float AS price, ts
      FROM market_prices
      ORDER BY market_id, candidate, ts DESC
    ),
    earlier AS (
      SELECT DISTINCT ON (market_id, candidate)
        market_id, candidate, price::float AS price, ts
      FROM market_prices
      WHERE ts <= ${new Date(now.getTime() - windowHours * 3600 * 1000)}
      ORDER BY market_id, candidate, ts DESC
    )
    SELECT
      l.market_id,
      l.candidate,
      l.price AS price_now,
      e.price AS price_then,
      (l.price - e.price) * 100 AS delta_pct
    FROM latest l
    JOIN earlier e USING (market_id, candidate)
    WHERE ABS(l.price - e.price) * 100 >= ${thresholdPct};
  `);

  const moves: MarketMove[] = (rows.rows as Array<Record<string, unknown>>).map((r) => ({
    marketId: r.market_id as string,
    candidate: r.candidate as string,
    priceNow: Number(r.price_now),
    priceThen: Number(r.price_then),
    deltaPct: Number(r.delta_pct),
    windowHours,
    detectedAt: now,
  }));

  if (moves.length) {
    logger.info({ count: moves.length, thresholdPct, windowHours }, 'polymarket: moves detected');
  }
  return moves;
}
EOF
```

- [ ] **Step 4: Correr test (debe pasar)**

```bash
pnpm test tests/sources/polymarket/moves.test.ts
```

Expected: 2 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/sources/polymarket/moves.ts tests/sources/polymarket/moves.test.ts
git commit -m "feat(polymarket): movement detection query

detectMoves devuelve candidatos cuyo precio se movió >= threshold pp en
la ventana especificada. Usa SQL window comparison contra el snapshot
más reciente y el más cercano al borde de la ventana.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: News feeds list + RSS parser

**Files:**
- Create: `src/sources/news/feeds.ts`
- Create: `src/sources/news/parse.ts`
- Create: `tests/fixtures/rss-clarin.xml`
- Create: `tests/sources/news/parse.test.ts`

- [ ] **Step 1: Crear feeds.ts con la lista de medios**

```bash
mkdir -p src/sources/news
cat > src/sources/news/feeds.ts <<'EOF'
export interface NewsFeed {
  source: string;       // identificador corto, va a la columna news.source
  url: string;          // URL del feed RSS
  active: boolean;
}

export const FEEDS: NewsFeed[] = [
  { source: 'clarin', url: 'https://www.clarin.com/rss/politica/', active: true },
  { source: 'lanacion', url: 'https://www.lanacion.com.ar/arc/outboundfeeds/rss/category/politica/?outputType=xml', active: true },
  { source: 'infobae', url: 'https://www.infobae.com/feeds/rss/sections/politica/', active: true },
  { source: 'pagina12', url: 'https://www.pagina12.com.ar/rss/secciones/el-pais/notas', active: true },
  { source: 'cenital', url: 'https://www.cenital.com/feed/', active: true },
  { source: 'letrap', url: 'https://www.letrap.com.ar/rss/politica.xml', active: true },
  { source: 'ambito', url: 'https://www.ambito.com/rss/politica.xml', active: true },
  { source: 'perfil', url: 'https://www.perfil.com/feed/politica', active: true },
];

// Nota: las URLs son tentativas. Ezequiel debe verificar cada una con `curl -I` o navegador
// y ajustar si alguna devuelve 404 o cambió de path. Después del primer run podemos podar
// las que no respondan.
EOF
```

- [ ] **Step 2: Capturar fixture real de un feed**

```bash
mkdir -p tests/fixtures
curl -sL "https://www.clarin.com/rss/politica/" -o tests/fixtures/rss-clarin.xml
head -30 tests/fixtures/rss-clarin.xml
```

Expected: archivo con XML/RSS válido. Si Clarín cambió el feed, intentar otro de la lista.

- [ ] **Step 3: Test del parser (failing)**

```bash
mkdir -p tests/sources/news
cat > tests/sources/news/parse.test.ts <<'EOF'
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { parseRssXml } from '../../../src/sources/news/parse.js';

describe('parseRssXml', () => {
  it('parses fixture into items with required fields', async () => {
    const xml = readFileSync('tests/fixtures/rss-clarin.xml', 'utf-8');
    const items = await parseRssXml(xml);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.url).toMatch(/^https?:\/\//);
      expect(item.headline.length).toBeGreaterThan(0);
      expect(item.publishedAt).toBeInstanceOf(Date);
    }
  });
});
EOF
```

- [ ] **Step 4: Correr test (debe fallar)**

```bash
pnpm test tests/sources/news/parse.test.ts
```

Expected: FAIL.

- [ ] **Step 5: Implementar parse.ts**

```bash
cat > src/sources/news/parse.ts <<'EOF'
import Parser from 'rss-parser';

export interface NewsItem {
  url: string;
  headline: string;
  bodyExcerpt: string | null;
  publishedAt: Date;
}

const parser = new Parser({
  customFields: { item: ['content:encoded', 'description'] },
});

export async function parseRssXml(xml: string): Promise<NewsItem[]> {
  const feed = await parser.parseString(xml);
  const items: NewsItem[] = [];
  for (const it of feed.items) {
    const url = it.link?.trim();
    const headline = it.title?.trim();
    const dateStr = it.isoDate ?? it.pubDate;
    if (!url || !headline || !dateStr) continue;
    const publishedAt = new Date(dateStr);
    if (Number.isNaN(publishedAt.getTime())) continue;
    items.push({
      url,
      headline,
      bodyExcerpt: stripHtml(it.contentSnippet ?? it.content ?? it['content:encoded'] ?? '').slice(0, 500) || null,
      publishedAt,
    });
  }
  return items;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}
EOF
```

- [ ] **Step 6: Correr test (debe pasar)**

```bash
pnpm test tests/sources/news/parse.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/sources/news/feeds.ts src/sources/news/parse.ts tests/fixtures/rss-clarin.xml tests/sources/news/parse.test.ts
git commit -m "feat(news): RSS parser + feed list

parseRssXml extrae items con url/headline/publishedAt/excerpt desde XML.
feeds.ts lista los medios mainstream AR a monitorear; URLs validables
con curl antes de prender el ingest worker.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: News ingest (fetch + dedupe + insert)

**Files:**
- Create: `src/sources/news/ingest.ts`

- [ ] **Step 1: Implementar ingest.ts**

```bash
cat > src/sources/news/ingest.ts <<'EOF'
import { sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { news } from '../../db/schema.js';
import { logger } from '../../lib/logger.js';
import { FEEDS } from './feeds.js';
import { parseRssXml, type NewsItem } from './parse.js';

async function fetchFeed(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { accept: 'application/rss+xml,application/xml,*/*' },
  });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.text();
}

export async function runNewsIngest(): Promise<{ inserted: number; skipped: number }> {
  const start = Date.now();
  let inserted = 0;
  let skipped = 0;

  for (const feed of FEEDS.filter((f) => f.active)) {
    try {
      const xml = await fetchFeed(feed.url);
      const items = await parseRssXml(xml);
      logger.debug({ source: feed.source, count: items.length }, 'news: feed parsed');

      for (const item of items) {
        const result = await db
          .insert(news)
          .values({
            source: feed.source,
            url: item.url,
            headline: item.headline,
            bodyExcerpt: item.bodyExcerpt,
            publishedAt: item.publishedAt,
          })
          .onConflictDoNothing({ target: news.url })
          .returning({ id: news.id });
        if (result.length === 1) inserted++;
        else skipped++;
      }
    } catch (err) {
      logger.warn({ source: feed.source, err: (err as Error).message }, 'news: feed failed');
    }
  }

  logger.info({ inserted, skipped, ms: Date.now() - start }, 'news: ingest complete');
  return { inserted, skipped };
}
EOF
```

- [ ] **Step 2: Smoke test end-to-end**

```bash
pnpm tsx -e "import { runNewsIngest } from './src/sources/news/ingest.js'; await runNewsIngest(); process.exit(0);"
```

Expected: log con `inserted: N` (N>0 la primera vez) y `skipped: 0`. Una segunda corrida debería tener `inserted: ~0` y `skipped: ~igual a inserted anterior` (idempotencia por url).

- [ ] **Step 3: Verificar en DB**

```bash
docker exec politica-pg psql -U politica -d politica -c "SELECT source, count(*) FROM news GROUP BY source ORDER BY 2 DESC;"
```

Expected: counts por medio. Si algún medio tiene 0, el feed URL probablemente está caído — investigar y actualizar `feeds.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/sources/news/ingest.ts
git commit -m "feat(news): ingest pipeline (fetch + dedupe + insert)

Idempotente por unique index en url. Feeds que fallan se loguean como
warn y no abortan el resto del run.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: News tagger (LLM via abstract client)

**Files:**
- Create: `src/sources/news/tagger.ts`

- [ ] **Step 1: Implementar tagger.ts**

```bash
cat > src/sources/news/tagger.ts <<'EOF'
import { isNull, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { news } from '../../db/schema.js';
import { llm } from '../../llm/index.js';
import { logger } from '../../lib/logger.js';

const tagSchema = z.object({
  candidates: z.array(z.string()),  // nombres mencionados (ej: ["Milei", "Kicillof"])
  category: z.enum(['campania', 'gobierno', 'economia', 'escandalo', 'debate', 'otro']),
  relevance: z.number().min(0).max(1),
});

const PROMPT_TEMPLATE = (headline: string, excerpt: string | null) => `
Sos un clasificador de noticias políticas argentinas.
Dada una nota, devolvé EXCLUSIVAMENTE un JSON con la siguiente forma:

{
  "candidates": ["nombre1", ...],   // candidatos/políticos mencionados (apellido o nombre completo)
  "category": "campania" | "gobierno" | "economia" | "escandalo" | "debate" | "otro",
  "relevance": 0.0-1.0              // qué tan relevante es para el ciclo electoral 2027/2026
}

Reglas:
- "candidates" SOLO incluye personas con potencial electoral nacional (presidenciables, gobernadores con peso, líderes de partidos). NO incluye periodistas o funcionarios menores.
- "category": "campania" si trata de elecciones/candidatos; "gobierno" gestión/decisiones del Ejecutivo; "economia" macro/medidas económicas; "escandalo" denuncias/judicial; "debate" eventos/foros; "otro" si no encaja.
- "relevance" alto (>0.7) si la nota mueve la aguja electoral, bajo (<0.3) si es color/anecdótico.

Headline: ${headline}
Excerpt: ${excerpt ?? '(sin excerpt)'}

Devolvé SOLO el JSON, sin texto adicional, sin markdown.
`.trim();

const BATCH_SIZE = 20;

export async function runNewsTagger(): Promise<{ tagged: number; failed: number }> {
  const pending = await db
    .select({ id: news.id, headline: news.headline, excerpt: news.bodyExcerpt })
    .from(news)
    .where(isNull(news.taggedAt))
    .limit(BATCH_SIZE);

  if (!pending.length) {
    logger.debug('news: no pending items to tag');
    return { tagged: 0, failed: 0 };
  }

  let tagged = 0;
  let failed = 0;

  for (const item of pending) {
    try {
      const raw = await llm.classify(PROMPT_TEMPLATE(item.headline, item.excerpt), { model: 'haiku' });
      const json = extractJson(raw);
      const parsed = tagSchema.parse(json);

      await db
        .update(news)
        .set({
          candidatesMentioned: parsed.candidates,
          category: parsed.category,
          relevanceScore: parsed.relevance.toFixed(2),
          taggedAt: new Date(),
        })
        .where(eq(news.id, item.id));
      tagged++;
    } catch (err) {
      logger.warn({ id: item.id, err: (err as Error).message }, 'news: tag failed');
      failed++;
      // no marcamos taggedAt — se reintenta en el próximo run
    }
  }

  logger.info({ tagged, failed }, 'news: tagging batch complete');
  return { tagged, failed };
}

/** Extrae el primer bloque JSON de la respuesta del LLM (tolera prosa alrededor). */
function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  // Caso feliz: el LLM devolvió JSON puro.
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  // Fallback: buscar el primer { ... } balanceado.
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`No JSON found in LLM output: ${trimmed.slice(0, 200)}`);
  }
  return JSON.parse(trimmed.slice(start, end + 1));
}
EOF
```

- [ ] **Step 2: Smoke test del tagger**

```bash
pnpm tsx -e "import { runNewsTagger } from './src/sources/news/tagger.js'; await runNewsTagger(); process.exit(0);"
```

Expected: log "news: tagging batch complete" con tagged > 0. Cada call al CLI tarda 1-3s, así que 20 items tarda ~20-60s.

- [ ] **Step 3: Verificar en DB**

```bash
docker exec politica-pg psql -U politica -d politica -c "SELECT headline, category, relevance_score, candidates_mentioned FROM news WHERE tagged_at IS NOT NULL ORDER BY tagged_at DESC LIMIT 5;"
```

Expected: 5 filas con category, score (0.00-1.00), y candidates como array JSON.

- [ ] **Step 4: Commit**

```bash
git add src/sources/news/tagger.ts
git commit -m "feat(news): LLM tagger (candidates + category + relevance)

Procesa items pending en batches de 20. Usa el cliente LLM abstracto
(actualmente CLI). Falla blanda: items que fallan vuelven a estar pending
en el próximo run.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Worker orchestrator (cron schedule)

**Files:**
- Create: `src/workers/orchestrator.ts`

- [ ] **Step 1: Implementar orchestrator**

```bash
mkdir -p src/workers
cat > src/workers/orchestrator.ts <<'EOF'
import cron from 'node-cron';
import { logger } from '../lib/logger.js';
import { env } from '../lib/env.js';
import { runPolymarketIngest } from '../sources/polymarket/ingest.js';
import { detectMoves } from '../sources/polymarket/moves.js';
import { runNewsIngest } from '../sources/news/ingest.js';
import { runNewsTagger } from '../sources/news/tagger.js';

/**
 * Wrapper para que un cron job no se solape con sí mismo si tarda más de
 * lo esperado. Si la ejecución previa todavía corre, esta tick se descarta.
 */
function singleflight(name: string, fn: () => Promise<unknown>) {
  let running = false;
  return async () => {
    if (running) {
      logger.debug({ job: name }, 'job: skipped (previous still running)');
      return;
    }
    running = true;
    const start = Date.now();
    try {
      await fn();
      logger.debug({ job: name, ms: Date.now() - start }, 'job: ok');
    } catch (err) {
      logger.error({ job: name, err: (err as Error).message }, 'job: failed');
    } finally {
      running = false;
    }
  };
}

async function main() {
  logger.info('orchestrator: starting');

  // Run once at boot para validar que todo el wiring funciona.
  await runPolymarketIngest();
  await runNewsIngest();

  // Polymarket cada N min
  cron.schedule(`*/${env.POLYMARKET_POLL_INTERVAL_MIN} * * * *`, singleflight('polymarket-ingest', async () => {
    await runPolymarketIngest();
    const moves = await detectMoves({
      thresholdPct: env.MARKET_MOVE_THRESHOLD_PCT,
      windowHours: 6,
    });
    if (moves.length) logger.info({ moves }, 'orchestrator: market moves');
    // En fase 3 aquí se emiten events a la cola. Por ahora solo logueamos.
  }));

  // News ingest cada N min
  cron.schedule(`*/${env.NEWS_POLL_INTERVAL_MIN} * * * *`, singleflight('news-ingest', runNewsIngest));

  // News tagger cada 5 min (batches de 20)
  cron.schedule('*/5 * * * *', singleflight('news-tagger', runNewsTagger));

  logger.info(
    {
      polymarket_min: env.POLYMARKET_POLL_INTERVAL_MIN,
      news_min: env.NEWS_POLL_INTERVAL_MIN,
    },
    'orchestrator: schedules registered',
  );
}

main().catch((err) => {
  logger.fatal({ err: (err as Error).message }, 'orchestrator: fatal');
  process.exit(1);
});

// Graceful shutdown — node-cron no tiene cleanup explícito; basta con que el proceso muera.
process.on('SIGTERM', () => {
  logger.info('orchestrator: SIGTERM received, exiting');
  process.exit(0);
});
EOF
```

- [ ] **Step 2: Correrlo (debería arrancar y permanecer corriendo)**

```bash
pnpm worker
```

Expected:
- log "orchestrator: starting"
- log "polymarket: ingest complete"
- log "news: ingest complete"
- log "orchestrator: schedules registered"
- proceso sigue corriendo. `Ctrl+C` para detener.

Dejarlo correr 5-10 min y verificar que se registran ticks de cron en logs.

- [ ] **Step 3: Verificar growth de datos**

```bash
docker exec politica-pg psql -U politica -d politica -c "SELECT count(*) FROM market_prices;"
docker exec politica-pg psql -U politica -d politica -c "SELECT count(*) FROM news;"
```

Después de 30 min corriendo: counts de `market_prices` deberían crecer cada 15 min (~2 entradas por candidato cada tick). News debería tener entries con `tagged_at` populado para items viejos.

- [ ] **Step 4: Commit**

```bash
git add src/workers/orchestrator.ts
git commit -m "feat(worker): orchestrator with cron-scheduled ingests

Single-flight wrapper previene overlapping runs. Run-once-at-boot
valida wiring antes de delegar a cron. SIGTERM exit limpio.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: README mínimo + validación E2E

**Files:**
- Create: `README.md`

- [ ] **Step 1: Crear README**

```bash
cat > README.md <<'EOF'
# politica

Bot automatizado de X (en construcción) que cruza Polymarket + encuestas locales + noticias para reportar el ciclo electoral argentino 2026-2027.

Spec: [`docs/superpowers/specs/2026-05-04-politica-bot-design.md`](docs/superpowers/specs/2026-05-04-politica-bot-design.md)
Design system (visual): [`DESIGN.md`](DESIGN.md)

## Estado

**Fase 1 — Foundation + Ingestion** (en curso). Pipelines de Polymarket y noticias RSS corriendo localmente. Polls (fase 2), trigger engine (fase 3), publisher (fase 4) y sitio público (fase 5) pendientes.

## Setup local

Requisitos: Node 20+, pnpm, Docker Desktop, `claude` CLI autenticado.

\`\`\`bash
cp .env.example .env
docker compose up -d           # Postgres
pnpm install
pnpm db:migrate
pnpm worker                    # arranca ingestion loop
\`\`\`

## Comandos útiles

\`\`\`bash
pnpm dev                       # worker en watch mode (reinicia al cambiar src/)
pnpm worker                    # worker sin watch
pnpm test                      # vitest run
pnpm test:watch                # vitest watch
pnpm typecheck                 # tsc --noEmit
pnpm db:generate               # genera migración nueva
pnpm db:migrate                # aplica migraciones pendientes
pnpm db:studio                 # UI web de drizzle (browse DB)
\`\`\`

## Estructura

Ver \`docs/superpowers/plans/\` para el plan de implementación por fases.
EOF
```

- [ ] **Step 2: Detener cualquier worker corriendo**

```bash
# Si hay un worker en otra terminal, Ctrl+C ahí.
docker compose ps
```

- [ ] **Step 3: Validación E2E desde cero (simulando un nuevo dev)**

```bash
docker compose down -v         # destruye DB
docker compose up -d
sleep 5
pnpm db:migrate
pnpm worker &
WORKER_PID=$!
sleep 60                       # 1 minuto de operación
kill $WORKER_PID
```

- [ ] **Step 4: Verificar que se ingirieron datos en 1 minuto**

```bash
docker exec politica-pg psql -U politica -d politica -c "
  SELECT 'markets' AS tbl, count(*) FROM markets
  UNION ALL SELECT 'market_prices', count(*) FROM market_prices
  UNION ALL SELECT 'news', count(*) FROM news
  UNION ALL SELECT 'news_tagged', count(*) FROM news WHERE tagged_at IS NOT NULL
  ORDER BY tbl;
"
```

Expected: counts > 0 en todas las tablas (excepto quizás `news_tagged` si pasó muy rápido).

- [ ] **Step 5: Run de la suite de tests completa**

```bash
pnpm test
pnpm typecheck
```

Expected: todo pasa.

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: add README with setup instructions

E2E validation passes: from-scratch run ingiere markets, prices,
news y aplica tagging dentro del primer minuto.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Cierre de Fase 1

Al terminar todas las tareas:

- [ ] **Verificación final**
  - `pnpm test` pasa
  - `pnpm typecheck` pasa
  - `pnpm worker` arranca sin errores
  - DB tiene datos creciendo (markets, market_prices, news con tagging)
- [ ] **Logs revisados**: ningún warn repetitivo (especialmente "feed failed" — si un feed RSS está consistentemente caído, removerlo de `feeds.ts` o reemplazarlo).
- [ ] **Notas para Fase 2**:
  - Anotar el `slug` exacto que Polymarket usa para AR 2027 (lo descubriste en Task 8 step 3).
  - Listar feeds RSS que dieron problema o cero items.
  - Si el `claude` CLI muestra latencia inaceptable (>5s/call), considerar hacer la migración a SDK ANTES que la fase 2 (los polls extraen vía LLM-vision con Sonnet, son más caros que el tagger Haiku).
  - Capturar el costo aproximado de USD/día del tagger después de 48h de operación continua, para extrapolar costo total con polls + captions + cards.

**Output operacional al final de Fase 1:** un proceso `pnpm worker` corriendo en la Mac mini que mantiene Postgres actualizado con datos políticos AR. Próxima fase: agregar polls (X API + LLM vision) sobre esta base.
