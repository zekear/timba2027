# politica

Bot automatizado de X que cruza Polymarket + encuestas locales + noticias para reportar el ciclo electoral argentino 2026-2027.

Sitio público: http://localhost:3000 · Admin: http://localhost:3000/admin

Spec: [`docs/superpowers/specs/2026-05-04-politica-bot-design.md`](docs/superpowers/specs/2026-05-04-politica-bot-design.md)
Design system (visual): [`DESIGN.md`](DESIGN.md)

## Estado

**Fase 5 — Sitio público** (en curso). Pipeline completo + admin + sitio público navegable. VPS deploy queda como tarea operacional separada (no incluida en Fase 5).

## URLs

### Público (sin auth)
- `/` — home (top 5 + últimos posts)
- `/2027` — timeline mercado presidenciales
- `/c/[candidate]` — página por candidato
- `/encuestadora/[slug]` — página por encuestadora
- `/posts/[id]` — detail de un post published

### Admin (basic auth via ADMIN_BASIC_AUTH_USER/PASS)
- `/admin` — drafts queue
- `/admin/settings` — kill switch + mode selector
- `/admin/posts/[id]` — detail con actions (approve/kill/publish-now)

## Setup local

Requisitos: Node 20+, pnpm, Docker Desktop, claude CLI autenticado, X API bearer token.

```bash
cp .env.example .env
# Editar .env con X_API_BEARER_TOKEN, ADMIN_BASIC_AUTH_USER/PASS

docker compose up -d
pnpm install
pnpm db:migrate
pnpm tsx scripts/seed-pollsters.ts
pnpm worker
pnpm web
```

## Comandos útiles

```bash
pnpm dev                          # worker en watch mode
pnpm worker
pnpm web
pnpm web:build && pnpm web:start
pnpm test
pnpm typecheck
pnpm db:generate
pnpm db:migrate
pnpm db:studio

# Bot posts admin
pnpm tsx scripts/admin.ts list
pnpm tsx scripts/admin.ts approve 42
pnpm tsx scripts/admin.ts publish-now 42
pnpm tsx scripts/admin.ts mode soft
pnpm tsx scripts/admin.ts kill-switch on
```

## Modos de publicación

- **Shadow** (default): no publica nada a X. Drafts quedan en queue.
- **Soft launch**: 9-22hs ARG, cap 3/día, delay 60s post-approve.
- **Full autonomous**: 24/7 con cap 6/día, quiet hours 1-7am ARG.

**Kill switch global** bloquea TODA publicación.

## Estructura

Ver `docs/superpowers/plans/` para los planes por fase.
