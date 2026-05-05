# politica

Bot automatizado de X (en construcción) que cruza Polymarket + encuestas locales + noticias para reportar el ciclo electoral argentino 2026-2027.

Spec: [`docs/superpowers/specs/2026-05-04-politica-bot-design.md`](docs/superpowers/specs/2026-05-04-politica-bot-design.md)
Design system (visual): [`DESIGN.md`](DESIGN.md)

## Estado

**Fase 4 — Publisher + Admin** (en curso). Pipeline completo: Polymarket + News + Polls → Watchers → Trigger Engine → Cards + Captions → bot_posts(status='draft') → Admin (web/CLI) review → Publisher → X. Tres modos de publicación (shadow/soft/full) con kill switch global. Sitio público (fase 5) pendiente.

## URLs

- Worker: `pnpm worker` (no port, just logs)
- Admin web: `pnpm web` → http://localhost:3000 (basic auth via ADMIN_BASIC_AUTH_USER/PASS)
- Drafts CLI: `pnpm tsx scripts/admin.ts list`

## Setup local

Requisitos: Node 20+, pnpm, Docker Desktop, `claude` CLI autenticado, X API bearer token (desde X developer portal).

```bash
cp .env.example .env
# Editar .env con X_API_BEARER_TOKEN, ADMIN_BASIC_AUTH_USER/PASS
docker compose up -d           # Postgres
pnpm install
pnpm db:migrate
pnpm tsx scripts/seed-pollsters.ts   # idempotente, sólo primera vez
pnpm worker                    # arranca ingestion + trigger + publisher loops
pnpm web                       # Next.js admin UI (en otra terminal)
```

## Comandos útiles

```bash
pnpm dev                       # worker en watch mode
pnpm worker                    # worker sin watch
pnpm web                       # Next.js admin dev server
pnpm web:build && pnpm web:start   # admin prod build
pnpm test                      # vitest run
pnpm typecheck                 # tsc --noEmit
pnpm db:generate               # genera migración nueva
pnpm db:migrate                # aplica migraciones pendientes
pnpm db:studio                 # UI web de drizzle (browse DB)

# Polls review queue (Fase 2)
pnpm tsx scripts/review-polls.ts list

# Bot posts admin (Fase 4)
pnpm tsx scripts/admin.ts list
pnpm tsx scripts/admin.ts approve 42
pnpm tsx scripts/admin.ts publish-now 42
pnpm tsx scripts/admin.ts mode soft       # shadow|soft|full
pnpm tsx scripts/admin.ts kill-switch on  # bloquea publicación
```

## Modos de publicación

- **Shadow** (default): no publica nada a X. Drafts se generan pero quedan en queue para review manual. Útil para semanas iniciales o cuando hay incertidumbre.
- **Soft launch**: publica solo entre 9-22hs ARG, cap 3/día, delay 60s post-approve (vos podés cancelar en esa ventana).
- **Full autonomous**: publica 24/7 con cap 6/día, quiet hours 1-7am ARG.

El **kill switch global** (env `KILL_SWITCH=true` o admin UI) bloquea TODA publicación independientemente del modo.

## Estructura

Ver `docs/superpowers/plans/` para los planes por fase.
