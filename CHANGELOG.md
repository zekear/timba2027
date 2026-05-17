# Changelog

Todos los cambios significativos del proyecto se documentan en este archivo.

El formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el versionado sigue [SemVer](https://semver.org/lang/es/).

## [Unreleased]

## [0.1.0] — 2026-05-16

Primera apertura pública del repositorio.

### Added

- **Repo público bajo licencia MIT**, con `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md` y `README.md` reescrito en español ([commit](https://github.com/zekear/timba2027/commit/main)).
- **CI** (`.github/workflows/ci.yml`): typecheck + test corren en push a main y en cada PR. Postgres 16 como service, migrations aplicadas antes de tests.
- **Templates de issues y PRs** en `.github/ISSUE_TEMPLATE/` (bug report, feature request) + `pull_request_template.md`.
- **Branch protection** en `main`: require PR, CI required, no force-push, no deletions.
- **Dependabot** alerts + security updates + secret scanning + push protection habilitados.
- **Filtro por `shape` en el admin** ([#3](https://github.com/zekear/timba2027/pull/3)): pills clickeables arriba de la review queue (Todos / Market move / Hot news / New poll / Morning brief / Weekly recap), persistido vía `?shape=xxx` en URL.
- **Link a GitHub en el footer público** ([#4](https://github.com/zekear/timba2027/pull/4)) — `código en github` al lado del handle de X.
- **Feed RSS de Infobae** activado en la ingesta de noticias ([#5](https://github.com/zekear/timba2027/pull/5)). URL anterior daba 404; se actualizó a `/arc/outboundfeeds/rss/category/politica/?outputType=xml`.
- **Sparkline 7d + delta en pp en el top 5 de la home** ([#6](https://github.com/zekear/timba2027/pull/6)) — SVG inline sin librerías, muestreo cada 1h.
- **Card de market-move rediseñada** ([#7](https://github.com/zekear/timba2027/pull/7)): delta como protagonista visual (font display 140px) + sparkline 7d a la derecha.
- **Card de inflación nueva** ([#7](https://github.com/zekear/timba2027/pull/7)): "Escenario más probable" como big number + lista de todos los buckets con barras escaladas al consenso. El bucket que disparó el alert muestra su delta.
- **Trigger de duelo / crossover** ([#8](https://github.com/zekear/timba2027/pull/8)):
  - Nueva shape `duelo_crossover` en `bot_post_shape` enum (migration `0008`).
  - Watcher `src/trigger/watchers/duelo-crossover.ts` corre cada 30 min, compara top 5 ahora vs hace 24h, detecta cualquier swap en ranking. Cooldown 72h por par (passer, passed).
  - Card `src/render/cards/duelo-crossover.ts` con rank-swap protagonista ("2º → 1º", font display 160px).
  - Script `scripts/dry-run-crossover.ts` para inspeccionar detección sin emitir eventos.

### Changed

- **Bump Next.js** 15.5.15 → 15.5.18 (cubre 11 vulns: 7 high, 2 medium, 2 low).
- **Bump drizzle-orm** 0.36.4 → 0.45.2 ([#2](https://github.com/zekear/timba2027/pull/2)) — resuelve SQL injection (CVE) en `sql.identifier()` / `sql.as()`.
- **pnpm overrides** para forzar versiones safe de transitive deps: `vite@^6.4.2`, `esbuild@^0.25.0`, `postcss@^8.5.10`.
- **Hostname/path personal removido** de docstrings de scripts (`ssh timba2027 cd /home/timba/timba ...` → `pnpm tsx scripts/xxx.ts`).
- **Docs internos sanitizados**: referencias a dominios, IPs y otros proyectos personales reemplazadas por valores genéricos o públicos.
- **Renombre `docs/superpowers/` → `docs/internal/`** para nombre más neutral.
- **Script `preview-cards.ts`**: usa `env.BOT_HANDLE` en lugar de handle hardcodeado, y agrega ejemplos de las cards nuevas (market-move con sparkline, duelo, inflación con buckets).

### Fixed

- **CI workflow**: pin pnpm a v10 + Node 20 (pnpm v11 requiere Node 22 y bloquea `ERR_PNPM_IGNORED_BUILDS` en no-TTY). Postgres service + `db:migrate` antes de tests. Dummies de `X_API_*` para que tests de `x-write-client` (que mockean fetch) pasen la validación de creds. Test `tests/llm/cli.test.ts` excluido vía `vitest.config.ts` cuando `CI=true` (requiere binario `claude` no instalable en runners públicos).
- **Query de sparklines** ([#6](https://github.com/zekear/timba2027/pull/6) follow-up): drizzle expande JS arrays como tuple (`$1, $2, ...`) en lugar de array postgres. Workaround: pasar como literal `'{a,b}'::text[]`.
- **Conflicto de merge** ([#8](https://github.com/zekear/timba2027/pull/8)) entre `fetchAllBuckets` (de market-move redesign) y `handleCrossover` (de duelo) — ambos cohabitando en `src/trigger/orchestrator.ts`.

### Security

- **History de git reescrita** antes de hacer el repo público: 1 commit con email corporativo (`ezequiel.mina@uala.com.ar`) reemplazado por el email personal. Backup en bundle local.
- **Branches viejas con leak borradas** del remoto: `fase-1-foundation`, `fase-2-polls`, `fase-3-trigger-engine`, `fase-4-publisher`, `fase-5-public-site` (arrastraban el ancestro con el email corporativo).
- **Cuenta GitHub renombrada** `ezeqmina` → `zekear` y repo `ar-elections-2027` → `timba2027`. Referencias actualizadas en README, `.github/ISSUE_TEMPLATE/config.yml`, scripts y docs internos.

[Unreleased]: https://github.com/zekear/timba2027/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/zekear/timba2027/releases/tag/v0.1.0
