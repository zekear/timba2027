# politica

Bot automatizado de X (en construcción) que cruza Polymarket + encuestas locales + noticias para reportar el ciclo electoral argentino 2026-2027.

Spec: [`docs/superpowers/specs/2026-05-04-politica-bot-design.md`](docs/superpowers/specs/2026-05-04-politica-bot-design.md)
Design system (visual): [`DESIGN.md`](DESIGN.md)

## Estado

**Fase 1 — Foundation + Ingestion** (en curso). Pipelines de Polymarket y noticias RSS corriendo localmente. Polls (fase 2), trigger engine (fase 3), publisher (fase 4) y sitio público (fase 5) pendientes.

## Setup local

Requisitos: Node 20+, pnpm, Docker Desktop, `claude` CLI autenticado.

```bash
cp .env.example .env
docker compose up -d           # Postgres
pnpm install
pnpm db:migrate
pnpm worker                    # arranca ingestion loop
```

## Comandos útiles

```bash
pnpm dev                       # worker en watch mode (reinicia al cambiar src/)
pnpm worker                    # worker sin watch
pnpm test                      # vitest run
pnpm test:watch                # vitest watch
pnpm typecheck                 # tsc --noEmit
pnpm db:generate               # genera migración nueva
pnpm db:migrate                # aplica migraciones pendientes
pnpm db:studio                 # UI web de drizzle (browse DB)
```

## Estructura

Ver `docs/superpowers/plans/` para el plan de implementación por fases.
