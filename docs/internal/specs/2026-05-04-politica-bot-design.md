# Política bot — Design doc

**Fecha:** 2026-05-04
**Estado:** approved (pendiente plan de implementación)
**Autor:** Ezequiel + Claude

## Resumen

Bot automatizado de X (Twitter) que postea cards visuales sobre política argentina cruzando tres fuentes:

1. **Polymarket** — mercado de predicción (oficialmente baneado en AR pero referencia clave para audiencias politizadas).
2. **Encuestas locales** — extraídas automáticamente de las cuentas X de las encuestadoras vía LLM-vision.
3. **Noticias** — feeds RSS de medios mainstream argentinos.

Foco principal: **elecciones generales 2027** (24/10/2027). Foco secundario: **legislativas 2026** + **provinciales** para alimentar el sistema con material mientras 2027 se acerca.

Acompañado por un sitio web minimalista en `politica.tryclawdia.com` que sirve de archivo navegable y review queue para los posts del bot.

**No hay monetización en V1.** El objetivo de V1 es viralidad en X. La capa de monetización (suscripción, API B2B) se evalúa después de tener tracción medible.

## Goals (V1)

- Postear contenido autónomo, factual, con citas a fuente, sobre el ciclo electoral AR 2026-2027.
- Generar cards visuales screenshot-friendly para máximo retweet en X político AR.
- Detectar y posicionarse cuando hay disonancia entre Polymarket y encuestas locales — la "noticia más viral" del producto.
- Operar con safeguards estrictos contra alucinación factual (cero tolerancia: política argentina es zona caliente).

## Non-goals (V1)

- X sentiment analysis a escala (firehose). Diferido a V2.
- Cuenta humana en paralelo. Bot puro.
- Panel de expertos / colaboradores invitados. Diferido.
- Predicciones generadas por el bot. El bot reporta lo que dicen los datos, no opina.
- Apuestas, mercados propios, gamification. Está fuera de alcance y posiblemente regulado en AR.

## Decisiones de producto

| Pregunta | Decisión | Notas |
|---|---|---|
| Posicionamiento | Análisis con narrativa | Tono "robot reporter": factual, citado, conservador. NO opinión |
| Quién escribe | AI 100% (sin humano en el loop) | Mitigado por safeguards estrictos (ver §Safeguards) |
| Alcance electoral | Hub + foco | Home siempre 2027; secciones secundarias para 2026 + provinciales |
| Distribución | Bot 100% + sitio archivo | Sitio NO es para acquisition; es credibilidad y SEO |
| Formato dominante | Cards visuales + Bloomberg-style fallback | PNG diseñado vía Satori; texto puro como fallback |
| Cadencia | Híbrido | Morning brief 9hs ARG fijo + alertas event-driven con caps |
| Fuentes V1 | Polymarket + encuestas (X-monitoring + LLM vision) + noticias RSS | Sin X sentiment |
| Monetización V1 | Ninguna | Viralidad first |

## Identidad visual — design system

**Design system:** WIRED-inspired (formato DESIGN.md, fuente: [awesome-design-md / wired](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/wired/DESIGN.md)).

DESIGN.md guardado en `/DESIGN.md` del proyecto. Lo aplican tanto el sitio como las cards generadas para X.

**Por qué este sistema:**

- **Diferenciación en X:** todo lo "datos políticos / mercado de predicción" en X usa el mismo look (dashboards, gradientes, rounded cards tipo Linear). Una card en estética magazine/broadsheet (paper-white, serif grande, mono uppercase kickers, hairline rules, sin sombras) se distingue desde el thumbnail. Más RT-able.
- **Coherencia editorial:** el posicionamiento del bot es "robot reporter, factual, citado" — no "trader chart". El look magazine refuerza esa promesa.
- **Trazabilidad cromática:** un solo color de acento (`#057dbc` ink-blue) hace que el footer de fuente ("Polymarket 14:32 · Opinaia 03/05/26") sea instantáneamente reconocible como "esto vino de @<handle>".

**Aplicación en cards (Satori):**

- Background: `#ffffff` (paper white). Sin gradientes, sin sombras.
- Header ribbon: barra negra full-bleed con eyebrow mono uppercase (ej: `POLYMARKET MOVE` / `NEW POLL` / `MORNING BRIEF`), tracking 0.9–1.2px.
- Headline: serif display 48-64px, line-height 0.95-1.05.
- Body / context: sans (sustituto de Apercu, ej Inter 700) o serif (sustituto de BreveText, ej Lora) según jerarquía.
- Footer: mono 12px uppercase con timestamp + fuente.
- Bordes 2px sólidos negros donde aplique. Cero `border-radius`. Cero box-shadow.
- Único color que no es grayscale: `#057dbc` para nombre/handle del proyecto y links.

**Fonts en producción** (Satori usa locally-bundled fonts; las propietarias de WIRED no son licenciables, usamos sustitutos sugeridos por el DESIGN.md):

- Display serif: **Playfair Display** o **Libre Caslon** (loose +0.10 line-height vs los tokens del DESIGN.md, ver §Note on Font Substitutes).
- Body serif: **Lora** o **Source Serif 4**.
- Sans UI: **Inter** o **Work Sans**.
- Mono kicker: **JetBrains Mono** o **IBM Plex Mono**.

**Aplicación en sitio** (Next.js): mismas reglas. El sitio se ve como un broadsheet web. Alta densidad de información, sin cards con sombras, hairline rules entre secciones.

**Setup técnico:** durante implementación se corre `npx getdesign@latest add wired` para mantener el DESIGN.md actualizado si la fuente upstream cambia.

## Arquitectura

```
┌──────────────┐   ┌──────────────────┐   ┌──────────┐   ┌────────────────┐   ┌──────────┐
│  INGESTION   │──▶│ EXTRACTION/NORM  │──▶│ STORAGE  │──▶│ TRIGGER ENGINE │──▶│PUBLISHER │
└──────────────┘   └──────────────────┘   └──────────┘   └────────────────┘   └──────────┘
  Polymarket API     Polymarket → schema    Postgres        Cron 9hs            X API
  X timelines        Poll classifier+vision (events,        Watchers:           Card composer
  RSS feeds          News tagger             prices,         - market move      Caption gen (LLM)
                                            polls,          - new poll          Admin queue
                                            news,           - hot news
                                            posts)
```

Cinco componentes lógicos, cada uno con responsabilidad acotada. La frontera entre Storage y Trigger Engine es la única bidireccional (Trigger Engine consulta Storage para detectar eventos; escribe los posts generados de vuelta a Storage).

## Pipeline de datos

### Polymarket

- **Fuente:** API pública de Polymarket (Gamma + CLOB). Sin auth para market data.
- **Frecuencia:** worker cada 15 min.
- **Mercados monitoreados:** presidenciales 2027 + cualquier mercado AR adyacente que Polymarket liste (gobernadores clave, legislativas 2026 si están listadas).
- **Esquema:**
  - `markets(id, slug, question, candidates[], end_date, status)`
  - `market_prices(market_id, candidate, price, volume_24h, ts)` — timeseries
- **Detección de movimiento:** query SQL "delta de precio en últimas 6h por candidato"; emite `MARKET_MOVE` event si `abs(delta) > 2%` (threshold configurable).

### Encuestas (X-monitoring + LLM vision)

Lista curada (configurable) de ~10 cuentas X de encuestadoras y analistas. Ejemplos: @opinaiagency, @cb_consultora, @SynopsisCons, @AtlasIntel, @ZubanCordoba, @Manage_Fit, @fede_gonzalez_ok, @CarlosFara, @ShilaVilker. La lista exacta se afina antes del launch.

Pipeline por cuenta, cada 6 horas:

1. **Fetch** últimos N tweets vía X API pay-per-use (~5 reads × 10 cuentas × 4 polleos/día = ~200 reads/día = ~USD 30/mes).
2. **Filtro grueso** por keywords (`encuesta`, `intención`, `%`, nombres de candidatos top). Descarta el ~80%.
3. **LLM classifier** (Claude Haiku, prompt corto): "¿Este post + imagen es una encuesta de intención de voto? sí/no/duda."
4. **LLM vision extractor** (Claude Sonnet con imagen): si "sí", devuelve JSON estructurado:
   ```json
   {
     "pollster": "Opinaia",
     "fecha_campo": "2026-04-28",
     "sample_size": 1200,
     "metodologia": "online | telefónica | mixta",
     "results": [{"candidato": "Milei", "pct": 45.2}, ...]
   }
   ```
5. **Validación:** schema check + sanity (suma ≤ 105%, sample > 200, fechas coherentes). Si falla → flag para review manual, NO se inserta.
6. **Insert** en `polls` con `source_url` (link al tweet) y `confidence` (alto / medio / bajo).
7. Emite `NEW_POLL` event si `confidence == alto`.

**Guardrail:** durante shadow mode + soft launch (semanas 1-8), TODAS las encuestas extraídas pasan por review manual antes de ser usadas en posts. Después de N=50 aprobaciones consecutivas correctas, se relaja: `confidence=alto` auto-aprueba; `medio/bajo` siguen en review.

### Noticias

- **Fuentes:** RSS de Clarín, La Nación, Infobae, Página 12, Cenital, Letra P, Ámbito, Perfil, BAE Negocios. Ajustable.
- **Frecuencia:** worker cada 15 min.
- **Esquema:** `news(id, source, url, headline, body_excerpt, published_at, candidates_mentioned[], category, relevance_score)`
- **LLM tagger** (Haiku, batch): por cada artículo nuevo extrae candidatos mencionados, categoría (`campaña | gobierno | economía | escándalo | debate | otro`), y `relevance_score` (0-1).
- Emite `HOT_NEWS` event si `relevance_score > 0.7` y al menos 1 candidato top-5 mencionado.

## Trigger Engine y tipos de post

Cuatro "shapes" de post, cada uno con su template de card y su prompt de caption:

| Shape | Trigger | Frecuencia esperada | Card |
|---|---|---|---|
| **Morning Brief** | Cron 9hs ARG diario | 1/día | **Variable** — el sistema elige entre varios shapes (top 5 actual, spread Polymarket-encuestas, semana de un candidato, comparación week-over-week, etc.) según qué fue más relevante el día anterior. Actúa como mini-editor. |
| **Market Move** | Δ Polymarket > 2% en 6h | 0-3/día | Candidato X subió/bajó N pp. Contexto: noticias del periodo + encuesta más cercana |
| **New Poll** | Encuesta detectada con confidence=alto | 1-3/semana | Encuesta vs Polymarket en este momento. Spread = N pp |
| **Hot News** | Noticia high-relevance + correlación con movimiento | 0-2/semana | Noticia + chart de Polymarket alrededor del evento |

### Anti-spam

- **Cap duro diario:** 6 posts. Si la cola excede, descarta el de menor prioridad (orden: `New Poll > Market Move > Hot News > Morning Brief`). Morning brief nunca se descarta.
- **Cooldown por candidato:** si ya hubo un Market Move post para "Milei" en las últimas 4h, los siguientes movimientos del mismo candidato se acumulan; solo se postea si delta acumulado > 4%.
- **Quiet hours:** 1am–7am ARG nada se postea. Excepción: eventos extremos (delta > 10%).

### Generación de cards

- **Stack:** Satori (React → SVG → PNG). Suficiente para los 4 shapes + variantes del morning brief.
- **Aspect ratio:** 16:9 (1200×675) — óptimo para Twitter card grande.
- **Branding consistente:** nombre del proyecto, color, fuente.
- **Footer obligatorio:** timestamp + fuente del dato (ej: "Polymarket 14:32 · Opinaia 03/05/26").
- **Microcopy obligatorio:** "🤖 datos automatizados, ver fuente →" + link al sitio.
- **Generación on-demand** cada vez que se dispara un evento. Cacheable 5 min.

### Generación de captions

LLM (Claude Haiku) con prompt template. Datos inyectados verbatim — el LLM jamás ve un número que no esté en el set de datos.

Prompt template (V1):

```
Estás escribiendo un tweet para una cuenta automatizada que reporta datos electorales.
Tono: factual, conciso, en español rioplatense, sin opinión política.
Datos:
- Tipo: {tipo}
- Candidato: {candidato}
- Movimiento: {delta} en {periodo}
- Precio actual: {precio}
- Volumen 24h: {volumen}
- Encuesta más cercana: {encuesta_resumen}
- Top noticia del periodo: {noticia_titulo}

Generá UN tweet de máximo 220 caracteres. NO inventes números, NO repitas
los datos verbatim (la card ya los muestra), enfocate en *qué pasó* y *contexto*.
Sin hashtags. Sin emojis (excepto un solo 🔔 al inicio si es alerta).
```

**Linter de output:**

- Largo ≤ 270 chars.
- **Number guardrail:** regex extrae todos los números del caption; cada uno debe coincidir con un número en el set de datos source. Si aparece un número no source, descarta y retry.
- (Lista de palabras prohibidas: TBD — definir después de ver outputs reales.)

Si el linter falla 2 veces, fallback a **template fijo Bloomberg-style** ("Milei +3.2% en Polymarket (6h). Encuesta más cercana: Opinaia 45% (28/04).").

## Safeguards (sistema operativo del bot)

**Principio rector:** los números en las **cards** se renderizan vía template (Satori inyecta el dato source directamente en el SVG; el LLM no participa). Los números en los **captions** sí pasan por el LLM (porque el caption es generado), pero un linter regex valida que cada número del caption matchee un número del set de datos source — si no, el caption se descarta y se reintenta o cae al fallback Bloomberg-style. Esto elimina ~99% del riesgo de alucinación factual.

### Shadow mode (semanas 1-4)

- Pipeline corre completo, pero ningún post va a X.
- Cola de review en `/admin` del sitio.
- Aprobación con un click; publicación manual en X copiando caption + descargando imagen.

### Soft launch (semanas 5-8)

- Auto-publish habilitado, pero solo entre 9hs–22hs ARG.
- Cap reducido: 3 posts/día.
- **Delay de 60 segundos antes de publicar** — vos podés "kill" un post pendiente desde el admin.

### Full autonomous (semana 9+)

- Cap 6/día, 24/7 con quiet hours.
- Sin delay.
- Kill switch global siempre disponible.

### Kill switch global

Toggle en `/admin` que pausa toda publicación inmediatamente. Útil ante: fake news viral, error grave detectado, ataque coordinado, etc.

### Audit log inmutable

Cada post publicado guarda snapshot completo:

- Datos source (snapshot de Polymarket, encuestas, noticias usadas)
- Prompt enviado al LLM
- Output del LLM
- Caption final post-linter
- Card binary (PNG)
- Timestamp + X post id

Permite trazabilidad total si después aparece un error.

## Stack técnico

| Capa | Elección | Razón |
|---|---|---|
| Lenguaje | TypeScript | Background Ualá / Node ecosystem maduro |
| Web | Next.js (App Router) | Sitio + API routes en un solo proceso |
| DB | Postgres 16 | Time-series + relacional + jsonb. Container propio (no se reutiliza el Supabase de adopta.mx) |
| Workers | Node + node-cron (V1) | Simple. Inngest evaluable después si necesitamos durable workflows |
| LLM | Claude (Haiku para classify/tag, Sonnet para vision) | Calidad de vision + structured output + prompt caching |
| Card gen | Satori | React → PNG, lib estable de Vercel |
| X API | pay-per-use (USD 0.005/read, USD 0.015/write desde abril 2026) | Reemplazó tiers fijos en feb 2026 |
| Hosting V1 | Local (dev) | Docker compose en Mac |
| Hosting V2 | DigitalOcean droplet `137.184.218.9` | Mismo VPS que adopta.mx |
| TLS / proxy | nginx + Let's Encrypt en VPS | Mismo pattern que `*.tryclawdia.com` |

### LLM transport — abstracción desde día 1

Para soportar la fase "CLI primero, SDK después" sin refactorizar después, se abstrae el cliente LLM detrás de una interfaz:

```ts
// lib/llm/types.ts
interface LLMClient {
  classify(prompt: string, opts?: { model?: 'haiku' | 'sonnet' }): Promise<string>
  extractFromImage(prompt: string, image: Buffer): Promise<unknown>
  generateCaption(prompt: string, ctx: object): Promise<string>
}

// lib/llm/cli.ts — V1
class ClaudeCLIClient implements LLMClient { /* shellea a `claude -p` */ }

// lib/llm/sdk.ts — V2
class ClaudeSDKClient implements LLMClient { /* @anthropic-ai/sdk */ }

// lib/llm/index.ts
export const llm: LLMClient = process.env.LLM_TRANSPORT === 'sdk'
  ? new ClaudeSDKClient()
  : new ClaudeCLIClient()
```

El resto del código consume `llm` sin saber qué transporte hay debajo. Switch en una env var.

**Nota de latencia:** el CLI tiene ~1-2s de overhead de startup por call. Aceptable para clasificar 50-100 tweets/día (1-2 min total). NO aceptable para event-driven Market Moves (un alert debería tardar segundos, no minutos). Plan: CLI hasta validar end-to-end; swap a SDK antes del soft launch (semana 4-5).

### Esquema de DB (resumen)

```sql
-- Polymarket
markets(id, slug, question, candidates jsonb, end_date, status, created_at)
market_prices(market_id, candidate, price, volume_24h, ts) -- timeseries; índice (candidate, ts)

-- Encuestas
pollsters(id, name, x_handle, methodology, active)
polls(id, pollster_id, source_url, fecha_campo, sample_size, metodologia,
      results jsonb, confidence, status, ingested_at)

-- Noticias
news(id, source, url unique, headline, body_excerpt, published_at,
     candidates_mentioned text[], category, relevance_score)

-- Posts del bot
bot_posts(id, type, status, generated_at, posted_at, x_post_id,
          caption, card_url, source_snapshot jsonb, llm_metadata jsonb,
          metrics jsonb)

-- Eventos (cola)
events(id, type, payload jsonb, status, created_at, processed_at)
```

## Setup local (dev)

`docker-compose.yml` minimalista:

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: politica
      POSTGRES_PASSWORD: politica
      POSTGRES_DB: politica
    volumes:
      - pg_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
volumes:
  pg_data:
```

App y worker corren en host (`pnpm dev` y `pnpm worker`), shellean al `claude` CLI del host (donde ya hay auth).

## Deploy a VPS (V2)

Stack 100% en Docker en `/home/webadmin/politica/`:

- `postgres` (volumen persistente, no expuesto fuera del compose)
- `app` (Next.js, expuesto al nginx host)
- `worker` (Node con SDK, sin puertos)
- `nginx` host (no en el compose) sirve `politica.tryclawdia.com` con TLS

Deploy:

1. Build local: `pnpm build && docker build -t politica:latest .`
2. `docker save | ssh ... docker load` (o push a registry y pull)
3. SSH a VPS, `docker compose up -d`
4. Migraciones via container `migrate` (one-shot) en el compose

Backups: dump diario de Postgres a Backblaze B2 (o S3 compatible) con retención 30 días.

## Testing

- **Unit:** normalizers de Polymarket, RSS parsers, schema validators de polls. Determinístico.
- **Integration con fixtures:** snapshots reales de respuestas de Polymarket, X timelines, RSS, encuestas en imagen. Pipeline corre end-to-end sin red.
- **LLM eval harness:** golden set de 50 imágenes de encuestas con ground truth manual. Cada cambio de prompt corre el eval. Métrica: % de extracciones donde todos los candidatos top-5 coinciden con ground truth dentro de ±0.5pp. Target: >95%.
- **Smoke E2E pre-launch:** dry run completo durante 2 semanas (datos reales, generación de posts, NO publica). Si el resultado es coherente, prendés.

## Costos estimados (V1, monthly)

| Item | USD/mes |
|---|---|
| X API (pay-per-use) | 30-50 |
| Claude API (con prompt caching) | 10-30 |
| DigitalOcean droplet (compartido con adopta.mx) | 0 incremental |
| Storage (cards en VPS / B2 backups) | 1-5 |
| Dominio | ~1 (subdominio existente) |
| **Total** | **~50-100/mes** |

## Rollout

| Fase | Duración | Qué pasa |
|---|---|---|
| 0. Build | 4-6 semanas | Construir todo. Sin publicar. CLI transport. |
| 1. Shadow + dry-run | 2 semanas | Pipeline corre, posts generan a queue, no publica. Ajustes a prompts y templates. |
| 2. Manual publish | 2 semanas | Vos copiás+pegás aprobados a X manualmente. Swap CLI → SDK durante esta fase. |
| 3. Soft launch | 4 semanas | Auto-publish con caps + delay 60s + horario reducido. |
| 4. Full autonomous | indefinido | Cap 6/día, 24/7, kill switch siempre. |

Total hasta autonomía completa: **~3 meses** desde primer commit. Factible para un side project con 8-10 hs/semana.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| LLM aluciona un número | Number guardrail (regex contra source). Fallback Bloomberg si falla. |
| Encuestadora cambia formato de imagen | Eval harness detecta drop de accuracy. Manual review queue actúa de buffer. |
| Polymarket retira mercado AR | Sistema sigue funcionando con encuestas + noticias; morning brief usa shapes alternativos. |
| Banean la cuenta de X | Sitio sobrevive como archivo. Plan de contingencia: cuenta backup + posibilidad de pivot a Bluesky / Threads. |
| Tweet del bot genera quilombo político real | Kill switch global. Audit log para análisis post-mortem. Política conservadora de tono ("robot reporter", no opinión). |
| Costo X API se va de control | Cap configurable de reads/día. Alert si proyectado > 2× del baseline. |
| Encuesta extraída con error factual se postea | Shadow mode + soft launch como filtro. Después de fase autonomous: confidence=alto auto-publica, resto sigue en review. |

## Open questions (para refinar en plan de implementación)

- Lista exacta de cuentas X de encuestadoras a monitorear (definir antes del build).
- Lista exacta de RSS feeds de medios.
- Diseño visual de las cards (paleta, tipografía, branding) — requiere iteración con mockups.
- Nombre del proyecto / handle de X (reservar handle ASAP).
- Lista de palabras prohibidas en captions (definir después de 2-3 semanas de outputs en shadow mode).
- Política exacta de retención de datos (cuánto histórico de market_prices guardamos).
