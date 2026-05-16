# Contribuir a Timba

¡Gracias por interesarte! Este doc te dice cómo levantar el proyecto, qué convenciones seguimos, y cómo abrir un PR que tenga buenas chances de mergear rápido.

## Antes de empezar

- Para cambios chicos (bugfix, typo, refactor local): mandá el PR directo.
- Para cambios grandes (nueva fuente de datos, nuevo tipo de card, cambios de arquitectura): **abrí primero un issue** explicando qué querés hacer y por qué. Ahorra ida y vuelta.

## Levantar el entorno

Ver [Quick start en el README](./README.md#quick-start). En resumen:

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm db:migrate
pnpm tsx scripts/seed-pollsters.ts
pnpm worker   # terminal 1
pnpm web      # terminal 2
```

**Importante:** trabajá siempre con `PUBLISH_MODE=shadow` y `KILL_SWITCH=true` (defaults) mientras desarrollás. El worker va a generar drafts pero no va a tocar X.

## Antes de mandar el PR

```bash
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest
pnpm web:build    # asegurar que Next compila
```

Si tu cambio toca UI, agregá screenshots al PR. Si toca el schema de DB, generá la migration (`pnpm db:generate`) y commiteala.

## Convenciones de código

- **TypeScript estricto** — sin `any` salvo justificado en comentario.
- **No tirar errores genéricos** — usar `throw new Error('contexto específico')`.
- **Logging:** `pino` (`src/lib/logger.ts`). Nunca `console.log` en código de producción.
- **Validación de input externo:** zod. Ver `src/lib/env.ts` como referencia.
- **DB queries:** Drizzle ORM. No raw SQL salvo casos justificados.
- **Sin comentarios obvios.** Comentá el *por qué*, no el *qué*.

## Convenciones de commits

Usamos prefijos tipo Conventional Commits:

- `feat(scope): ...` — feature nueva
- `fix(scope): ...` — bugfix
- `chore(scope): ...` — refactors, build, configuración
- `docs(scope): ...` — solo documentación
- `test(scope): ...` — solo tests

Ejemplos:

```
feat(market-move): un evento por mercado con co-moves como siblings
fix(card): sacar prefijo 'Rango' redundante
chore: scripts/regen-caption.ts para re-generar captions de drafts
```

Si usás Claude Code u otro asistente, el `Co-Authored-By:` está bien — lo dejamos.

## Cómo agregar una fuente nueva

### Nueva encuestadora

1. Agregá la fila a `scripts/seed-pollsters.ts`.
2. Si la encuestadora postea con formato raro, ajustá los prompts en `src/sources/polls/`.
3. Corré `pnpm tsx scripts/seed-pollsters.ts` y `pnpm tsx scripts/smoke-polls-ingest.ts`.

### Nuevo feed de noticias

1. Agregá el feed a `src/sources/news/feeds.ts`.
2. Si necesita scoring custom, ajustá `src/trigger/hot-news.ts`.

### Nuevo tipo de card

1. Creá `src/render/cards/<tu-tipo>.ts` siguiendo el patrón de `market-move.ts` / `hot-news.ts`.
2. Registralo en `src/render/compose.ts`.
3. Test visual: `pnpm tsx scripts/preview-cards.ts`.

## Cómo abrir el PR

1. Fork + branch desde `main`.
2. Hacé los cambios + verificaciones de arriba.
3. PR contra `main`. Linkeá issues relacionados.
4. Esperá review. Suelen ser rápidas si el PR es chico y enfocado.

## Code of conduct

Ver [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md). TL;DR: sé buena onda.
