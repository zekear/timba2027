# politica

Bot automatizado de X (en construcción) que cruza Polymarket + encuestas locales + noticias para reportar el ciclo electoral argentino 2026-2027.

Spec: [`docs/superpowers/specs/2026-05-04-politica-bot-design.md`](docs/superpowers/specs/2026-05-04-politica-bot-design.md)
Design system (visual): [`DESIGN.md`](DESIGN.md)

## Estado

**Fase 3 — Trigger Engine + Content Generation** (en curso). Pipelines de Polymarket, noticias, polls + watchers + trigger engine + cards (Satori) + captions (LLM + linter) corriendo localmente. Posts generados como `bot_posts(status='draft')` en DB con cards en `storage/cards/`. Publisher (fase 4) y sitio público (fase 5) pendientes.

## Setup local

Requisitos: Node 20+, pnpm, Docker Desktop, `claude` CLI autenticado, X API bearer token (desde X developer portal).

```bash
cp .env.example .env
# Editar .env con X_API_BEARER_TOKEN
docker compose up -d           # Postgres
pnpm install
pnpm db:migrate
pnpm tsx scripts/seed-pollsters.ts   # idempotente, sólo primera vez
pnpm worker                    # arranca ingestion loop
```

## Comandos útiles

```bash
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
```

## Estructura

Ver `docs/superpowers/plans/` para los planes por fase.
