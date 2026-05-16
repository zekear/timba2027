# Política Bot — Fase 5: Sitio Público

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sitio público de archivo navegable. Cuando alguien clickea "ver fuente →" en un tweet del bot, aterriza en una página pulida con la fuente del dato y contexto histórico. Páginas indexables (SEO) para que Google y agregadores recojan el contenido. Asset propio fuera de X.

**Architecture:** Reusamos la Next.js app del Fase 4 — el admin se mueve bajo `/admin/*` (queda gated por middleware basic auth), y la raíz `/` se vuelve pública. Datos vienen del mismo Postgres. Páginas son server components (RSC) para SEO; gráficos como islands client-side con `'use client'`. Estilo broadsheet WIRED igual que las cards.

**Tech Stack:** Next.js 15 App Router, Tailwind, Recharts (time-series), Drizzle (mismo schema que worker).

**Tiempo estimado:** 2-3 semanas a 8-10 hs/semana.

**Out of scope (deferred a fase ops separada):**
- VPS deploy (corre solo local por ahora; deploy se planea aparte)
- Persistir patch de @shuding/opentype.js
- Backups de DB

---

## Estructura de archivos al final de Fase 5

```
app/
├── layout.tsx                      (sin cambios — root layout)
├── page.tsx                        ★ public home (era admin drafts)
├── posts/[id]/page.tsx             ★ public post detail (era admin detail; admin se mueve)
├── 2027/page.tsx                   ★ nueva — timeline mercado presidenciales
├── c/[candidate]/page.tsx          ★ nueva — página por candidato
├── encuestadora/[slug]/page.tsx    ★ nueva — página por encuestadora
├── sitemap.ts                      ★ nueva — Next.js MetadataRoute.Sitemap
├── robots.ts                       ★ nueva — Next.js MetadataRoute.Robots
├── admin/
│   ├── page.tsx                    ★ moved-here desde root: drafts queue (admin entry)
│   ├── settings/page.tsx           ★ era admin/page.tsx: kill switch + mode
│   └── posts/[id]/page.tsx         ★ moved-here desde root: admin detail con actions
├── api/
│   ├── cards/[file]/route.ts       (sin cambios — público)
│   ├── posts/[id]/...              (sin cambios — gated)
│   └── admin/state/route.ts        (sin cambios — gated)
├── components/
│   ├── DraftRow.tsx                (admin)
│   ├── ActionButtons.tsx           (admin)
│   ├── public/
│   │   ├── Header.tsx              ★ nuevo — broadsheet masthead
│   │   ├── Footer.tsx              ★ nuevo — disclosures + nav
│   │   ├── PostCard.tsx            ★ nuevo — preview card de un bot_post published
│   │   ├── MarketChart.tsx         ★ nuevo — Recharts time-series (use client)
│   │   ├── BarRow.tsx              ★ nuevo — barchart row simple
│   │   └── PollResultsTable.tsx    ★ nuevo
└── lib/
    └── slug.ts                     ★ nuevo — candidate name ↔ slug
middleware.ts                       (modify — gate /admin/* y write APIs)
public/
└── og-default.png                  ★ nuevo — fallback OG image
```

---

## Bloque A — Restructure

### Task 1: Mover admin bajo /admin/* + ajustar middleware

El sitio público va en root. El admin se mueve completo bajo `/admin/*`. Middleware gate solo lo que es admin (basic auth).

**Files:**
- Move: `app/page.tsx` → `app/admin/page.tsx` (la actual `app/admin/page.tsx` se mueve a `app/admin/settings/page.tsx`)
- Move: `app/posts/[id]/page.tsx` → `app/admin/posts/[id]/page.tsx`
- Modify: `middleware.ts` (gate solo `/admin/*` y write APIs)
- Modify: `app/components/DraftRow.tsx` (link href ahora `/admin/posts/${id}`)

- [ ] **Step 1: Mover la admin settings page**

```bash
mkdir -p app/admin/settings
mv app/admin/page.tsx app/admin/settings/page.tsx
```

- [ ] **Step 2: Mover drafts list a admin/page.tsx**

Read `app/page.tsx` y guardarlo. Luego:

```bash
mv app/page.tsx app/admin/page.tsx
```

Read `app/admin/page.tsx`. La línea con `<a href="/admin" ...>` ahora es self-link inútil, reemplazar por:

```tsx
<a href="/admin/settings" className="text-accent underline">settings</a>
```

- [ ] **Step 3: Mover detail page de admin**

```bash
mkdir -p "app/admin/posts/[id]"
mv "app/posts/[id]/page.tsx" "app/admin/posts/[id]/page.tsx"
rmdir "app/posts/[id]" "app/posts" 2>/dev/null || true
```

Read `app/admin/posts/[id]/page.tsx`. Find:
```tsx
import { db } from '../../../src/db/client.js';
import { botPosts } from '../../../src/db/schema.js';
import { ActionButtons } from '../../components/ActionButtons.js';
```
Now the depth changed (one more `../`), update to:
```tsx
import { db } from '../../../../src/db/client.js';
import { botPosts } from '../../../../src/db/schema.js';
import { ActionButtons } from '../../../components/ActionButtons.js';
```

Also update the back-link `<Link href="/" ...>` to `<Link href="/admin" ...>`.

- [ ] **Step 4: Update DraftRow link**

Read `app/components/DraftRow.tsx`. Find:
```tsx
<a href={`/posts/${p.id}`} ...>
```
Replace with:
```tsx
<a href={`/admin/posts/${p.id}`} ...>
```

- [ ] **Step 5: Update middleware to gate only admin paths**

Read `middleware.ts`. Replace the entire file with:

```bash
cat > middleware.ts <<'EOF'
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Basic auth gate solo para:
 *   - /admin/*  (drafts queue, settings, post detail con actions)
 *   - /api/admin/*  (toggle kill switch + mode)
 *   - /api/posts/*  (approve/kill/publish-now actions)
 *
 * Todo el resto (root, /posts, /c, /encuestadora, /2027, /api/cards) es público.
 */

const PROTECTED_PATTERNS = [
  /^\/admin(\/|$)/,
  /^\/api\/admin(\/|$)/,
  /^\/api\/posts(\/|$)/,
];

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Static + favicon: bypass siempre
  if (path.startsWith('/_next/') || path === '/favicon.ico') {
    return NextResponse.next();
  }

  const isProtected = PROTECTED_PATTERNS.some((rx) => rx.test(path));
  if (!isProtected) return NextResponse.next();

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

- [ ] **Step 6: Verificar el reorder funciona**

```bash
pkill -f "next dev" 2>/dev/null; sleep 1
pnpm web > /tmp/restructure-smoke.log 2>&1 &
sleep 12
PORT=$(grep -oE 'http://localhost:[0-9]+' /tmp/restructure-smoke.log | head -1 | grep -oE '[0-9]+$')
PORT=${PORT:-3000}

# Public root: 200 sin auth (placeholder por ahora — Task 3 lo reemplaza)
echo "--- public root sin auth (will 404 por ahora — todavía no hay app/page.tsx) ---"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:$PORT/"

# Admin: 401 sin auth
echo "--- /admin sin auth ---"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:$PORT/admin"

# Admin con auth: 200
echo "--- /admin con auth ---"
curl -s -u admin:changeme-en-produccion -o /dev/null -w "%{http_code}\n" "http://localhost:$PORT/admin"

# Admin settings con auth
echo "--- /admin/settings con auth ---"
curl -s -u admin:changeme-en-produccion -o /dev/null -w "%{http_code}\n" "http://localhost:$PORT/admin/settings"

pkill -f "next dev" 2>/dev/null
```

Expected:
- `/` → 404 (correcto — `app/page.tsx` no existe todavía; lo creamos en Task 3)
- `/admin` sin auth → 401
- `/admin` con auth → 200
- `/admin/settings` con auth → 200

- [ ] **Step 7: typecheck + tests**

```bash
pnpm typecheck && pnpm test
```

Expected: 64 tests pass. typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add app/admin app/components middleware.ts
git rm -rf "app/posts" 2>/dev/null
git commit -m "$(cat <<'COMMIT'
refactor(web): mover admin bajo /admin/* + middleware gate específico

Antes: / = drafts, /posts/[id] = detail, /admin = settings (todo gated).
Ahora: /admin = drafts, /admin/settings = kill switch + mode,
/admin/posts/[id] = detail con actions. Middleware gate solo
/admin/*, /api/admin/*, /api/posts/*. Root y resto quedan públicos
para Fase 5.

DraftRow link actualizado a /admin/posts/[id].

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Bloque B — Foundation pública

### Task 2: Layout components + slug helper

**Files:**
- Create: `app/lib/slug.ts`
- Create: `app/components/public/Header.tsx`
- Create: `app/components/public/Footer.tsx`
- Create: `tests/lib/slug.test.ts`

- [ ] **Step 1: Test slug failing**

```bash
mkdir -p tests/lib
cat > tests/lib/slug.test.ts <<'EOF'
import { describe, it, expect } from 'vitest';
import { candidateToSlug, slugToCandidate } from '../../app/lib/slug.js';

describe('candidateToSlug', () => {
  it('lowercases + replaces spaces with hyphens', () => {
    expect(candidateToSlug('Javier Milei')).toBe('javier-milei');
    expect(candidateToSlug('Cristina Fernández de Kirchner')).toBe('cristina-fernandez-de-kirchner');
  });

  it('strips accents', () => {
    expect(candidateToSlug('Patricia Bullrich')).toBe('patricia-bullrich');
    expect(candidateToSlug('Ñoño')).toBe('nono');
  });

  it('collapses repeated hyphens and strips trailing/leading', () => {
    expect(candidateToSlug('  Hello  World  ')).toBe('hello-world');
  });
});

describe('slugToCandidate', () => {
  it('roundtrips title-cased name (lossy: no accents recovered)', () => {
    expect(slugToCandidate('javier-milei')).toBe('Javier Milei');
  });
});
EOF
```

- [ ] **Step 2: Run RED**

```bash
pnpm test tests/lib/slug.test.ts
```

Expected: FAIL "Cannot find module".

- [ ] **Step 3: Implement slug**

```bash
mkdir -p app/lib
cat > app/lib/slug.ts <<'EOF'
/**
 * Candidate name ↔ URL slug.
 * "Javier Milei" → "javier-milei"
 * Lossy: accents stripped, case folded.
 */

const ACCENT_MAP: Record<string, string> = {
  á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ü: 'u', ñ: 'n',
  Á: 'a', É: 'e', Í: 'i', Ó: 'o', Ú: 'u', Ü: 'u', Ñ: 'n',
};

export function candidateToSlug(name: string): string {
  return name
    .trim()
    .split('')
    .map((c) => ACCENT_MAP[c] ?? c)
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function slugToCandidate(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
EOF
```

- [ ] **Step 4: Run GREEN**

```bash
pnpm test tests/lib/slug.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Header component**

```bash
mkdir -p app/components/public
cat > app/components/public/Header.tsx <<'EOF'
import Link from 'next/link';

export function Header() {
  return (
    <header className="border-b-2 border-ink">
      <div className="max-w-5xl mx-auto px-6 py-4 flex items-baseline gap-6">
        <Link href="/" className="font-serif text-2xl font-normal hover:text-accent">
          POLITICA
        </Link>
        <nav className="font-mono text-xs uppercase tracking-wide text-pageInk flex gap-4 ml-auto">
          <Link href="/2027" className="hover:text-accent">2027</Link>
          <Link href="/" className="hover:text-accent">posts</Link>
        </nav>
      </div>
    </header>
  );
}
EOF
```

- [ ] **Step 6: Footer component**

```bash
cat > app/components/public/Footer.tsx <<'EOF'
export function Footer() {
  return (
    <footer className="border-t-2 border-ink mt-16">
      <div className="max-w-5xl mx-auto px-6 py-8 font-mono text-xs uppercase tracking-wide text-caption space-y-2">
        <p>
          🤖 Datos automatizados · Polymarket + encuestas locales + noticias mainstream argentinas.
        </p>
        <p>
          Sin afiliación política. Cada post tiene fuente verificable. No es asesoramiento ni predicción.
        </p>
        <p>
          <a href="https://github.com/zekear/timba2027" className="text-accent underline">code</a>
          {' · '}
          <a href="/admin" className="text-accent underline">admin</a>
        </p>
      </div>
    </footer>
  );
}
EOF
```

- [ ] **Step 7: typecheck + tests**

```bash
pnpm typecheck && pnpm test
```

Expected: 68 tests pass (64 + 4 new slug).

- [ ] **Step 8: Commit**

```bash
git add app/lib app/components/public tests/lib/slug.test.ts
git commit -m "$(cat <<'COMMIT'
feat(web): public layout primitives + slug helper

candidateToSlug/slugToCandidate para URLs lindas (/c/javier-milei).
Header con logo POLITICA + nav. Footer con disclosure + links.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Bloque C — Páginas públicas

### Task 3: Home page (root público)

**Files:**
- Create: `app/page.tsx` (era admin, ahora público)
- Create: `app/components/public/PostCard.tsx`
- Create: `app/components/public/BarRow.tsx`

- [ ] **Step 1: PostCard component**

```bash
cat > app/components/public/PostCard.tsx <<'EOF'
import Link from 'next/link';
import { basename } from 'node:path';

export interface PublicPostProps {
  id: number;
  shape: string;
  caption: string;
  cardPath: string;
  publishedAt: Date | null;
}

const SHAPE_LABEL: Record<string, string> = {
  morning_brief: 'MORNING BRIEF',
  market_move: 'POLYMARKET MOVE',
  new_poll: 'NUEVA ENCUESTA',
  hot_news: 'HOT NEWS',
};

export function PostCard({ id, shape, caption, cardPath, publishedAt }: PublicPostProps) {
  const cardFile = basename(cardPath);
  const cardUrl = `/api/cards/${encodeURIComponent(cardFile)}`;
  const ts = publishedAt ? publishedAt.toLocaleDateString('es-AR') : 's/d';
  return (
    <article className="border-b border-hairline pb-6 mb-6">
      <div className="font-mono text-xs uppercase tracking-wide text-caption mb-2">
        {SHAPE_LABEL[shape] ?? shape} · {ts}
      </div>
      <Link href={`/posts/${id}`} className="block group">
        <img src={cardUrl} alt="" className="w-full border-2 border-ink mb-3 group-hover:opacity-90 transition-opacity" />
        <p className="font-serif text-xl leading-snug text-pageInk group-hover:text-accent">
          {caption}
        </p>
      </Link>
    </article>
  );
}
EOF
```

- [ ] **Step 2: BarRow component**

```bash
cat > app/components/public/BarRow.tsx <<'EOF'
import Link from 'next/link';
import { candidateToSlug } from '../../lib/slug.js';

export interface BarRowProps {
  candidato: string;
  pct: number;        // 0-100
  maxPct: number;     // para escalar
  linkable?: boolean;
}

const MAX_W = 480;

export function BarRow({ candidato, pct, maxPct, linkable = true }: BarRowProps) {
  const w = Math.max(8, (pct / Math.max(maxPct, 1)) * MAX_W);
  const inner = (
    <>
      <div className="font-sans font-bold text-base w-44 truncate text-pageInk">{candidato}</div>
      <div className="bg-ink h-6" style={{ width: w }} />
      <div className="font-mono font-bold text-base text-pageInk">{pct.toFixed(1)}%</div>
    </>
  );
  return linkable ? (
    <Link
      href={`/c/${candidateToSlug(candidato)}`}
      className="flex items-center gap-3 py-1 hover:text-accent group"
    >
      {inner}
    </Link>
  ) : (
    <div className="flex items-center gap-3 py-1">{inner}</div>
  );
}
EOF
```

- [ ] **Step 3: Home page**

```bash
cat > app/page.tsx <<'EOF'
import Link from 'next/link';
import { sql, desc, eq } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { botPosts } from '../src/db/schema.js';
import { Header } from './components/public/Header.js';
import { Footer } from './components/public/Footer.js';
import { PostCard } from './components/public/PostCard.js';
import { BarRow } from './components/public/BarRow.js';

export const dynamic = 'force-dynamic';

interface CandidateRow {
  candidate: string;
  pct: number;
}

async function getCurrentTop5(): Promise<CandidateRow[]> {
  const r = await db.execute(sql`
    SELECT DISTINCT ON (candidate) candidate, (price::float * 100) AS pct
    FROM market_prices mp JOIN markets m ON m.id = mp.market_id
    WHERE m.slug = 'argentina-presidential-election-winner'
    ORDER BY candidate, ts DESC
  `);
  const rows = r.rows as Array<{ candidate: string; pct: number }>;
  return rows.sort((a, b) => b.pct - a.pct).slice(0, 5);
}

export default async function Home() {
  const [top5, recentPosts] = await Promise.all([
    getCurrentTop5(),
    db.select().from(botPosts).where(eq(botPosts.status, 'published')).orderBy(desc(botPosts.publishedAt)).limit(6),
  ]);

  const maxPct = Math.max(...top5.map((c) => c.pct), 1);

  return (
    <>
      <Header />
      <main className="max-w-5xl mx-auto px-6 py-12">
        <section className="mb-16">
          <div className="font-mono text-xs uppercase tracking-wide text-caption mb-3">
            Política argentina · datos automatizados
          </div>
          <h1 className="font-serif text-5xl md:text-7xl leading-none mb-6 text-pageInk">
            Camino al 2027.
          </h1>
          <p className="font-serif text-xl md:text-2xl leading-snug text-pageInk max-w-3xl">
            Un robot lee Polymarket, encuestas locales y noticias mainstream, y reporta lo
            que pasa con el mercado de elecciones. Sin opinión. Con fuente.
          </p>
        </section>

        {top5.length > 0 && (
          <section className="mb-16">
            <div className="flex items-baseline justify-between border-b-2 border-ink pb-2 mb-4">
              <h2 className="font-mono text-xs uppercase tracking-wide font-bold">
                Polymarket — top 5 ahora
              </h2>
              <Link href="/2027" className="font-mono text-xs uppercase tracking-wide text-accent underline">
                ver timeline →
              </Link>
            </div>
            <div className="space-y-1">
              {top5.map((c) => (
                <BarRow key={c.candidate} candidato={c.candidate} pct={c.pct} maxPct={maxPct} />
              ))}
            </div>
          </section>
        )}

        <section>
          <h2 className="font-mono text-xs uppercase tracking-wide font-bold border-b-2 border-ink pb-2 mb-4">
            Últimos posts del bot
          </h2>
          {recentPosts.length === 0 ? (
            <p className="font-serif text-lg text-caption">No hay posts publicados todavía.</p>
          ) : (
            <div className="grid md:grid-cols-2 gap-x-8">
              {recentPosts.map((p) => (
                <PostCard
                  key={p.id}
                  id={p.id}
                  shape={p.shape}
                  caption={p.caption}
                  cardPath={p.cardPath}
                  publishedAt={p.publishedAt}
                />
              ))}
            </div>
          )}
        </section>
      </main>
      <Footer />
    </>
  );
}
EOF
```

- [ ] **Step 4: Smoke**

```bash
pkill -f "next dev" 2>/dev/null; sleep 1
pnpm web > /tmp/home-smoke.log 2>&1 &
sleep 12
PORT=$(grep -oE 'http://localhost:[0-9]+' /tmp/home-smoke.log | head -1 | grep -oE '[0-9]+$')
PORT=${PORT:-3000}

# Home sin auth: 200
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:$PORT/"

# Verificar contenido
curl -s "http://localhost:$PORT/" | grep -oE "Camino al 2027|Polymarket — top 5|Últimos posts" | head -3

pkill -f "next dev" 2>/dev/null
```

Expected:
- 200
- HTML contiene "Camino al 2027", "Polymarket — top 5" (si hay datos), "Últimos posts"

- [ ] **Step 5: typecheck + tests**

```bash
pnpm typecheck && pnpm test
```

Expected: 68 tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/page.tsx app/components/public/PostCard.tsx app/components/public/BarRow.tsx
git commit -m "$(cat <<'COMMIT'
feat(web): public home page

Hero con headline serif. Top 5 actual de Polymarket con BarRow
component (link a /c/[candidato]). Grid de últimos 6 posts published.
Layout broadsheet (max-w-5xl, hairline rules). PostCard reusable.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

### Task 4: /posts/[id] público

**Files:**
- Create: `app/posts/[id]/page.tsx`

- [ ] **Step 1: Public post detail**

```bash
mkdir -p "app/posts/[id]"
cat > "app/posts/[id]/page.tsx" <<'EOF'
import { eq } from 'drizzle-orm';
import { basename } from 'node:path';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '../../../src/db/client.js';
import { botPosts } from '../../../src/db/schema.js';
import { Header } from '../../components/public/Header.js';
import { Footer } from '../../components/public/Footer.js';

export const dynamic = 'force-dynamic';

const SHAPE_LABEL: Record<string, string> = {
  morning_brief: 'MORNING BRIEF',
  market_move: 'POLYMARKET MOVE',
  new_poll: 'NUEVA ENCUESTA',
  hot_news: 'HOT NEWS',
};

export default async function PublicPost({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const numId = Number(id);
  if (!Number.isInteger(numId)) notFound();

  const [p] = await db.select().from(botPosts).where(eq(botPosts.id, numId));
  // Solo posts published son visibles públicamente
  if (!p || p.status !== 'published') notFound();

  const cardFile = basename(p.cardPath);
  const cardUrl = `/api/cards/${encodeURIComponent(cardFile)}`;

  // Source resumen amigable (sin LLM metadata interna)
  const source = p.sourceSnapshot as Record<string, unknown>;
  const sourceJson = JSON.stringify(source, null, 2);

  return (
    <>
      <Header />
      <main className="max-w-3xl mx-auto px-6 py-12">
        <Link href="/" className="font-mono text-xs uppercase tracking-wide text-accent underline mb-4 inline-block">
          ← home
        </Link>
        <div className="font-mono text-xs uppercase tracking-wide text-caption mb-3">
          {SHAPE_LABEL[p.shape] ?? p.shape} · #{p.id} · {p.publishedAt?.toLocaleDateString('es-AR') ?? 's/d'}
        </div>

        <img src={cardUrl} alt="" className="w-full border-2 border-ink mb-8" />

        <p className="font-serif text-2xl leading-snug text-pageInk mb-8">{p.caption}</p>

        {p.xPostId && (
          <p className="mb-8">
            <a
              href={`https://x.com/i/status/${p.xPostId}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-xs uppercase tracking-wide text-accent underline"
            >
              ver en X →
            </a>
          </p>
        )}

        <details className="mb-8">
          <summary className="font-mono text-xs uppercase tracking-wide text-caption cursor-pointer">
            Datos source ↓
          </summary>
          <pre className="text-xs mt-3 bg-hairline/30 p-4 overflow-auto whitespace-pre-wrap">
            {sourceJson}
          </pre>
        </details>
      </main>
      <Footer />
    </>
  );
}
EOF
```

- [ ] **Step 2: Smoke (con un published de prueba)**

```bash
# Crear un fake published post para test
PUBLISHED_ID=$(docker exec politica-pg psql -U politica -d politica -tA -c "
  INSERT INTO bot_posts (shape, status, caption, card_path, source_snapshot, llm_metadata, x_post_id, published_at)
  VALUES ('market_move', 'published', 'TEST PUBLIC POST', 'storage/cards/smoke-market-move.png', '{}'::jsonb, '{}'::jsonb, 'tweet-fake-1', NOW())
  RETURNING id
")
echo "Created published post id: $PUBLISHED_ID"

pkill -f "next dev" 2>/dev/null; sleep 1
pnpm web > /tmp/post-smoke.log 2>&1 &
sleep 12
PORT=$(grep -oE 'http://localhost:[0-9]+' /tmp/post-smoke.log | head -1 | grep -oE '[0-9]+$')
PORT=${PORT:-3000}

# Public detail sin auth: 200
echo "--- /posts/$PUBLISHED_ID sin auth ---"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:$PORT/posts/$PUBLISHED_ID"
curl -s "http://localhost:$PORT/posts/$PUBLISHED_ID" | grep -oE "TEST PUBLIC POST|ver en X" | head -2

# Draft / non-published debe ser 404 (publicly invisible)
DRAFT_ID=$(docker exec politica-pg psql -U politica -d politica -tA -c "
  INSERT INTO bot_posts (shape, status, caption, card_path, source_snapshot, llm_metadata)
  VALUES ('market_move', 'draft', 'TEST DRAFT INVISIBLE', 'storage/cards/smoke-market-move.png', '{}'::jsonb, '{}'::jsonb)
  RETURNING id
")
echo "--- /posts/$DRAFT_ID (draft, debe ser 404) ---"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:$PORT/posts/$DRAFT_ID"

# Cleanup
docker exec politica-pg psql -U politica -d politica -c "DELETE FROM bot_posts WHERE caption IN ('TEST PUBLIC POST', 'TEST DRAFT INVISIBLE');"

pkill -f "next dev" 2>/dev/null
```

Expected:
- Public published post: 200, contiene "TEST PUBLIC POST"
- Draft post: 404 (drafts no se exponen públicamente)

- [ ] **Step 3: typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add "app/posts"
git commit -m "$(cat <<'COMMIT'
feat(web): public post detail page

Solo posts published son visibles. Drafts/scheduled/killed devuelven
404. Muestra card grande + caption + link al tweet original. Source
snapshot expandible (audit). Sin acciones (eso vive en /admin).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

### Task 5: /c/[candidate] página por candidato

**Files:**
- Create: `app/c/[candidate]/page.tsx`

- [ ] **Step 1: Candidate page**

```bash
mkdir -p "app/c/[candidate]"
cat > "app/c/[candidate]/page.tsx" <<'EOF'
import { sql, eq, desc } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '../../../src/db/client.js';
import { botPosts } from '../../../src/db/schema.js';
import { candidateToSlug, slugToCandidate } from '../../lib/slug.js';
import { Header } from '../../components/public/Header.js';
import { Footer } from '../../components/public/Footer.js';
import { PostCard } from '../../components/public/PostCard.js';

export const dynamic = 'force-dynamic';

async function findCandidateByName(slug: string): Promise<string | null> {
  // Buscar el candidato real cuyo slug matchea
  const r = await db.execute(sql`
    SELECT DISTINCT candidate FROM market_prices mp
    JOIN markets m ON m.id = mp.market_id
    WHERE m.slug = 'argentina-presidential-election-winner'
  `);
  const candidates = (r.rows as Array<{ candidate: string }>).map((row) => row.candidate);
  return candidates.find((c) => candidateToSlug(c) === slug) ?? null;
}

export default async function CandidatePage({
  params,
}: {
  params: Promise<{ candidate: string }>;
}) {
  const { candidate: slug } = await params;
  const realName = (await findCandidateByName(slug)) ?? slugToCandidate(slug);

  // Precio actual + delta 7d
  const priceRes = await db.execute(sql`
    WITH latest AS (
      SELECT price::float AS price, ts FROM market_prices mp
      JOIN markets m ON m.id = mp.market_id
      WHERE m.slug = 'argentina-presidential-election-winner' AND mp.candidate = ${realName}
      ORDER BY ts DESC LIMIT 1
    ),
    week_ago AS (
      SELECT price::float AS price FROM market_prices mp
      JOIN markets m ON m.id = mp.market_id
      WHERE m.slug = 'argentina-presidential-election-winner' AND mp.candidate = ${realName}
        AND ts <= NOW() - INTERVAL '7 days'
      ORDER BY ts DESC LIMIT 1
    )
    SELECT l.price * 100 AS pct_now, COALESCE((l.price - w.price) * 100, 0) AS delta_7d
    FROM latest l LEFT JOIN week_ago w ON true;
  `);
  const priceRow = priceRes.rows[0] as { pct_now?: number; delta_7d?: number } | undefined;
  if (!priceRow || priceRow.pct_now == null) notFound();

  const pctNow = priceRow.pct_now;
  const delta = priceRow.delta_7d ?? 0;

  // Bot posts publicados sobre este candidato
  const posts = await db
    .select()
    .from(botPosts)
    .where(sql`${botPosts.status} = 'published' AND ${botPosts.candidateFocus} = ${realName}`)
    .orderBy(desc(botPosts.publishedAt))
    .limit(6);

  return (
    <>
      <Header />
      <main className="max-w-4xl mx-auto px-6 py-12">
        <Link href="/" className="font-mono text-xs uppercase tracking-wide text-accent underline mb-4 inline-block">
          ← home
        </Link>
        <div className="font-mono text-xs uppercase tracking-wide text-caption mb-2">
          Candidato — Polymarket 2027
        </div>
        <h1 className="font-serif text-6xl md:text-7xl leading-none mb-8 text-pageInk">{realName}</h1>

        <section className="border-y-2 border-ink py-6 mb-12 grid grid-cols-2 gap-6">
          <div>
            <div className="font-mono text-xs uppercase tracking-wide text-caption">Precio actual</div>
            <div className="font-serif text-5xl mt-1">{pctNow.toFixed(1)}<span className="text-2xl">%</span></div>
          </div>
          <div>
            <div className="font-mono text-xs uppercase tracking-wide text-caption">Δ 7 días</div>
            <div className="font-serif text-5xl mt-1">
              {delta >= 0 ? '+' : ''}{delta.toFixed(1)}<span className="text-2xl">pp</span>
            </div>
          </div>
        </section>

        {posts.length > 0 && (
          <section>
            <h2 className="font-mono text-xs uppercase tracking-wide font-bold border-b-2 border-ink pb-2 mb-4">
              Posts del bot sobre {realName}
            </h2>
            <div className="grid md:grid-cols-2 gap-x-8">
              {posts.map((p) => (
                <PostCard
                  key={p.id}
                  id={p.id}
                  shape={p.shape}
                  caption={p.caption}
                  cardPath={p.cardPath}
                  publishedAt={p.publishedAt}
                />
              ))}
            </div>
          </section>
        )}
      </main>
      <Footer />
    </>
  );
}
EOF
```

- [ ] **Step 2: Smoke**

```bash
pkill -f "next dev" 2>/dev/null; sleep 1
pnpm web > /tmp/candidate-smoke.log 2>&1 &
sleep 12
PORT=$(grep -oE 'http://localhost:[0-9]+' /tmp/candidate-smoke.log | head -1 | grep -oE '[0-9]+$')
PORT=${PORT:-3000}

# Buscar un candidato real en DB
CAND=$(docker exec politica-pg psql -U politica -d politica -tA -c "
  SELECT DISTINCT candidate FROM market_prices mp JOIN markets m ON m.id = mp.market_id
  WHERE m.slug = 'argentina-presidential-election-winner' LIMIT 1
")
echo "Testing candidate: $CAND"

if [ -n "$CAND" ]; then
  # Convertir a slug (lowercase + hyphens, sin acentos)
  SLUG=$(echo "$CAND" | tr 'A-Z' 'a-z' | sed 's/á/a/g;s/é/e/g;s/í/i/g;s/ó/o/g;s/ú/u/g;s/ñ/n/g' | sed 's/[^a-z0-9]\{1,\}/-/g' | sed 's/^-//;s/-$//')
  echo "Slug: $SLUG"
  curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:$PORT/c/$SLUG"
  curl -s "http://localhost:$PORT/c/$SLUG" | grep -oE "Precio actual|Δ 7 días" | head -2
fi

# Slug inexistente: 404
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:$PORT/c/no-existe-este-candidato-xyz"

pkill -f "next dev" 2>/dev/null
```

Expected:
- Candidato real: 200, contiene "Precio actual" y "Δ 7 días"
- Slug inexistente: 404

- [ ] **Step 3: typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add "app/c"
git commit -m "$(cat <<'COMMIT'
feat(web): public /c/[candidate] page

Página por candidato: precio actual + delta 7 días + grid de posts
del bot que tienen candidate_focus = este candidato. Resolves slug a
nombre real vía lookup en market_prices distinct candidates. 404 si
no existe en DB.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

### Task 6: /encuestadora/[slug] página por encuestadora

**Files:**
- Create: `app/encuestadora/[slug]/page.tsx`
- Create: `app/components/public/PollResultsTable.tsx`

- [ ] **Step 1: PollResultsTable component**

```bash
cat > app/components/public/PollResultsTable.tsx <<'EOF'
export interface PollResultsTableProps {
  results: Array<{ candidato: string; pct: number }>;
}

export function PollResultsTable({ results }: PollResultsTableProps) {
  const maxPct = Math.max(...results.map((r) => r.pct), 1);
  return (
    <table className="w-full">
      <tbody>
        {results.map((r) => (
          <tr key={r.candidato} className="border-b border-hairline">
            <td className="py-2 font-sans font-bold w-44 text-pageInk">{r.candidato}</td>
            <td className="py-2 w-full">
              <div className="bg-ink h-5" style={{ width: `${(r.pct / maxPct) * 100}%`, maxWidth: 400 }} />
            </td>
            <td className="py-2 font-mono font-bold text-right text-pageInk pl-2">{r.pct.toFixed(1)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
EOF
```

- [ ] **Step 2: Encuestadora page**

```bash
mkdir -p "app/encuestadora/[slug]"
cat > "app/encuestadora/[slug]/page.tsx" <<'EOF'
import { eq, desc } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '../../../src/db/client.js';
import { pollsters, polls } from '../../../src/db/schema.js';
import { Header } from '../../components/public/Header.js';
import { Footer } from '../../components/public/Footer.js';
import { PollResultsTable } from '../../components/public/PollResultsTable.js';

export const dynamic = 'force-dynamic';

export default async function EncuestadoraPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [pollster] = await db.select().from(pollsters).where(eq(pollsters.slug, slug));
  if (!pollster) notFound();

  const recent = await db
    .select()
    .from(polls)
    .where(eq(polls.pollsterId, pollster.id))
    .orderBy(desc(polls.fechaCampo))
    .limit(10);

  return (
    <>
      <Header />
      <main className="max-w-4xl mx-auto px-6 py-12">
        <Link href="/" className="font-mono text-xs uppercase tracking-wide text-accent underline mb-4 inline-block">
          ← home
        </Link>
        <div className="font-mono text-xs uppercase tracking-wide text-caption mb-2">Encuestadora</div>
        <h1 className="font-serif text-6xl md:text-7xl leading-none mb-2 text-pageInk">{pollster.displayName}</h1>
        <p className="font-mono text-xs uppercase tracking-wide text-caption mb-12">
          @{pollster.xHandle}
        </p>

        <h2 className="font-mono text-xs uppercase tracking-wide font-bold border-b-2 border-ink pb-2 mb-6">
          Últimas encuestas ({recent.length})
        </h2>

        {recent.length === 0 ? (
          <p className="font-serif text-lg text-caption">
            Sin encuestas publicadas todavía. Cuando {pollster.displayName} postee una nueva
            con datos numéricos, aparecerá acá.
          </p>
        ) : (
          <div className="space-y-12">
            {recent.map((poll) => (
              <article key={poll.id} className="border-b-2 border-hairline pb-8">
                <div className="font-mono text-xs uppercase tracking-wide text-caption mb-3">
                  {poll.fechaCampo ? `Campo ${poll.fechaCampo.toISOString().slice(0, 10)}` : 'fecha s/d'}
                  {poll.sampleSize ? ` · n=${poll.sampleSize}` : ''}
                  {poll.metodologia ? ` · ${poll.metodologia}` : ''}
                </div>
                <PollResultsTable results={poll.results} />
                <a
                  href={poll.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-xs uppercase tracking-wide text-accent underline mt-3 inline-block"
                >
                  fuente original →
                </a>
              </article>
            ))}
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
EOF
```

- [ ] **Step 3: Smoke**

```bash
pkill -f "next dev" 2>/dev/null; sleep 1
pnpm web > /tmp/pollster-smoke.log 2>&1 &
sleep 12
PORT=$(grep -oE 'http://localhost:[0-9]+' /tmp/pollster-smoke.log | head -1 | grep -oE '[0-9]+$')
PORT=${PORT:-3000}

# Probá con un slug seedeado
SLUG=$(docker exec politica-pg psql -U politica -d politica -tA -c "SELECT slug FROM pollsters LIMIT 1")
echo "Testing pollster: $SLUG"
if [ -n "$SLUG" ]; then
  curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:$PORT/encuestadora/$SLUG"
  curl -s "http://localhost:$PORT/encuestadora/$SLUG" | grep -oE "Encuestadora|Últimas encuestas" | head -2
fi

# Slug inexistente: 404
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:$PORT/encuestadora/no-existe"

pkill -f "next dev" 2>/dev/null
```

Expected:
- Slug existente: 200
- Slug inexistente: 404

- [ ] **Step 4: typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add "app/encuestadora" app/components/public/PollResultsTable.tsx
git commit -m "$(cat <<'COMMIT'
feat(web): public /encuestadora/[slug] page

Lista las últimas 10 encuestas de la pollster. PollResultsTable
muestra cada poll con bar chart inline. Link a fuente original
(tweet en X). 404 si la pollster no existe.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

### Task 7: /2027 timeline page (con chart Recharts)

**Files:**
- Modify: `package.json` (add recharts)
- Create: `app/components/public/MarketChart.tsx` (use client)
- Create: `app/2027/page.tsx`

- [ ] **Step 1: Install Recharts**

```bash
pnpm add recharts
```

- [ ] **Step 2: MarketChart client component**

```bash
cat > app/components/public/MarketChart.tsx <<'EOF'
'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  CartesianGrid,
} from 'recharts';

export interface ChartPoint {
  date: string;             // ISO date
  [candidate: string]: string | number;
}

export interface MarketChartProps {
  data: ChartPoint[];
  candidates: string[];     // names que figuran en data
}

const COLORS = ['#000000', '#057dbc', '#757575', '#1a1a1a', '#a0a0a0'];

export function MarketChart({ data, candidates }: MarketChartProps) {
  return (
    <div className="w-full" style={{ height: 360 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#e2e8f0" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontFamily: 'monospace', fontSize: 11, fill: '#757575' }}
            tickFormatter={(s: string) => s.slice(5)}  // MM-DD
          />
          <YAxis
            tick={{ fontFamily: 'monospace', fontSize: 11, fill: '#757575' }}
            tickFormatter={(v: number) => `${v}%`}
            domain={[0, 'auto']}
          />
          <Tooltip
            contentStyle={{
              border: '2px solid #000',
              borderRadius: 0,
              background: '#fff',
              fontFamily: 'sans-serif',
              fontSize: 13,
            }}
            formatter={(v: number) => [`${v.toFixed(1)}%`, '']}
          />
          <Legend wrapperStyle={{ fontFamily: 'monospace', fontSize: 11, textTransform: 'uppercase' }} />
          {candidates.slice(0, 5).map((c, i) => (
            <Line
              key={c}
              type="monotone"
              dataKey={c}
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={i === 0 ? 3 : 2}
              dot={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
EOF
```

- [ ] **Step 3: 2027 page**

```bash
mkdir -p app/2027
cat > app/2027/page.tsx <<'EOF'
import { sql } from 'drizzle-orm';
import Link from 'next/link';
import { db } from '../../src/db/client.js';
import { Header } from '../components/public/Header.js';
import { Footer } from '../components/public/Footer.js';
import { MarketChart, type ChartPoint } from '../components/public/MarketChart.js';
import { BarRow } from '../components/public/BarRow.js';

export const dynamic = 'force-dynamic';

interface PriceRow {
  candidate: string;
  pct: number;
  ts: Date;
}

async function getTimeSeriesData(): Promise<{ data: ChartPoint[]; candidates: string[] }> {
  // Top 5 actual
  const topRes = await db.execute(sql`
    SELECT DISTINCT ON (candidate) candidate, price::float AS price
    FROM market_prices mp JOIN markets m ON m.id = mp.market_id
    WHERE m.slug = 'argentina-presidential-election-winner'
    ORDER BY candidate, ts DESC
  `);
  const top = (topRes.rows as Array<{ candidate: string; price: number }>)
    .sort((a, b) => b.price - a.price)
    .slice(0, 5)
    .map((r) => r.candidate);

  if (top.length === 0) return { data: [], candidates: [] };

  // Series últimos 30 días, agrupado por día
  const seriesRes = await db.execute(sql`
    SELECT candidate, DATE_TRUNC('day', ts)::date AS day, AVG(price::float * 100) AS pct
    FROM market_prices mp JOIN markets m ON m.id = mp.market_id
    WHERE m.slug = 'argentina-presidential-election-winner'
      AND mp.candidate = ANY(ARRAY[${sql.join(top.map((c) => sql`${c}`), sql`, `)}])
      AND ts >= NOW() - INTERVAL '30 days'
    GROUP BY candidate, day
    ORDER BY day ASC
  `);
  const rows = seriesRes.rows as Array<{ candidate: string; day: string; pct: number }>;

  // Pivotar a { date, [candidate]: pct, ... }
  const byDay = new Map<string, ChartPoint>();
  for (const r of rows) {
    const date = String(r.day).slice(0, 10);
    if (!byDay.has(date)) byDay.set(date, { date });
    const point = byDay.get(date)!;
    point[r.candidate] = Number(r.pct);
  }
  const data = Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date));

  return { data, candidates: top };
}

export default async function Year2027() {
  const { data, candidates } = await getTimeSeriesData();

  // Top 5 con valor actual (último día con dato)
  const last = data[data.length - 1];
  const top5Latest = candidates
    .map((c) => ({ candidato: c, pct: Number(last?.[c] ?? 0) }))
    .filter((x) => x.pct > 0)
    .sort((a, b) => b.pct - a.pct);
  const maxPct = Math.max(...top5Latest.map((c) => c.pct), 1);

  return (
    <>
      <Header />
      <main className="max-w-5xl mx-auto px-6 py-12">
        <Link href="/" className="font-mono text-xs uppercase tracking-wide text-accent underline mb-4 inline-block">
          ← home
        </Link>
        <div className="font-mono text-xs uppercase tracking-wide text-caption mb-2">
          Polymarket — Argentina presidential election
        </div>
        <h1 className="font-serif text-6xl md:text-7xl leading-none mb-12 text-pageInk">2027</h1>

        <section className="mb-12">
          <h2 className="font-mono text-xs uppercase tracking-wide font-bold border-b-2 border-ink pb-2 mb-4">
            Top 5 ahora
          </h2>
          <div className="space-y-1">
            {top5Latest.map((c) => (
              <BarRow key={c.candidato} candidato={c.candidato} pct={c.pct} maxPct={maxPct} />
            ))}
          </div>
        </section>

        <section>
          <h2 className="font-mono text-xs uppercase tracking-wide font-bold border-b-2 border-ink pb-2 mb-4">
            Últimos 30 días
          </h2>
          {data.length < 2 ? (
            <p className="font-serif text-lg text-caption">
              Necesitamos al menos 2 días de datos para dibujar el chart. Esperá un poco.
            </p>
          ) : (
            <MarketChart data={data} candidates={candidates} />
          )}
        </section>
      </main>
      <Footer />
    </>
  );
}
EOF
```

- [ ] **Step 4: Smoke**

```bash
pkill -f "next dev" 2>/dev/null; sleep 1
pnpm web > /tmp/2027-smoke.log 2>&1 &
sleep 15
PORT=$(grep -oE 'http://localhost:[0-9]+' /tmp/2027-smoke.log | head -1 | grep -oE '[0-9]+$')
PORT=${PORT:-3000}

curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:$PORT/2027"
curl -s "http://localhost:$PORT/2027" | grep -oE "Polymarket|Top 5 ahora|Últimos 30 días" | head -3

pkill -f "next dev" 2>/dev/null
```

Expected: 200, contiene "Top 5 ahora" y "Últimos 30 días". Si la DB tiene <2 días de data, muestra el placeholder en vez del chart.

- [ ] **Step 5: typecheck + tests**

```bash
pnpm typecheck && pnpm test
```

Expected: 68 tests pass.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml app/2027 app/components/public/MarketChart.tsx
git commit -m "$(cat <<'COMMIT'
feat(web): /2027 timeline page

Top 5 actual con BarRow + chart Recharts time-series últimos 30 días
agrupado por día. Estilo broadsheet (paper white, ink-blue accent
para link líder, hairline grid). Si hay <2 días de data muestra
placeholder en vez del chart roto.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Bloque D — SEO + cierre

### Task 8: SEO (metadata + Open Graph + sitemap + robots)

**Files:**
- Create: `app/sitemap.ts`
- Create: `app/robots.ts`
- Modify: `app/layout.tsx` (metadata + OG defaults)
- Modify: `app/page.tsx`, `app/posts/[id]/page.tsx`, `app/c/[candidate]/page.tsx`, `app/encuestadora/[slug]/page.tsx`, `app/2027/page.tsx` (each con generateMetadata o metadata export)
- Create: `public/og-default.png` (placeholder OG image)

- [ ] **Step 1: sitemap.ts**

```bash
cat > app/sitemap.ts <<'EOF'
import type { MetadataRoute } from 'next';
import { sql, eq } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { botPosts, pollsters } from '../src/db/schema.js';
import { candidateToSlug } from './lib/slug.js';

const BASE = process.env.SITE_URL ?? 'http://localhost:3000';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  // Static + 2027
  const entries: MetadataRoute.Sitemap = [
    { url: `${BASE}/`, lastModified: now, priority: 1.0, changeFrequency: 'hourly' },
    { url: `${BASE}/2027`, lastModified: now, priority: 0.9, changeFrequency: 'hourly' },
  ];

  // Published posts
  const posts = await db
    .select({ id: botPosts.id, publishedAt: botPosts.publishedAt })
    .from(botPosts)
    .where(eq(botPosts.status, 'published'));
  for (const p of posts) {
    entries.push({
      url: `${BASE}/posts/${p.id}`,
      lastModified: p.publishedAt ?? now,
      priority: 0.7,
      changeFrequency: 'never',
    });
  }

  // Candidatos (distinct from market_prices)
  const candRes = await db.execute(sql`
    SELECT DISTINCT candidate FROM market_prices mp
    JOIN markets m ON m.id = mp.market_id
    WHERE m.slug = 'argentina-presidential-election-winner'
  `);
  for (const row of candRes.rows as Array<{ candidate: string }>) {
    entries.push({
      url: `${BASE}/c/${candidateToSlug(row.candidate)}`,
      lastModified: now,
      priority: 0.8,
      changeFrequency: 'daily',
    });
  }

  // Encuestadoras activas
  const ps = await db.select({ slug: pollsters.slug }).from(pollsters);
  for (const p of ps) {
    entries.push({
      url: `${BASE}/encuestadora/${p.slug}`,
      lastModified: now,
      priority: 0.6,
      changeFrequency: 'weekly',
    });
  }

  return entries;
}
EOF
```

- [ ] **Step 2: robots.ts**

```bash
cat > app/robots.ts <<'EOF'
import type { MetadataRoute } from 'next';

const BASE = process.env.SITE_URL ?? 'http://localhost:3000';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin/', '/api/admin/', '/api/posts/'],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
  };
}
EOF
```

- [ ] **Step 3: Add SITE_URL env var**

Read `src/lib/env.ts`. Add to schema:

```ts
SITE_URL: z.string().url().default('http://localhost:3000'),
```

Append to `.env.example`:

```bash
cat >> .env.example <<'EOF'

# Public site base URL (used in sitemap, OG tags)
SITE_URL=http://localhost:3000
EOF
```

- [ ] **Step 4: Update root layout metadata**

Read `app/layout.tsx`. Replace the `metadata` export with:

```ts
export const metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? 'http://localhost:3000'),
  title: {
    default: 'política — datos automatizados de la elección 2027',
    template: '%s · política',
  },
  description: 'Bot automatizado que cruza Polymarket + encuestas + noticias para reportar el ciclo electoral argentino.',
  openGraph: {
    type: 'website',
    locale: 'es_AR',
    siteName: 'política',
    images: ['/og-default.png'],
  },
  twitter: { card: 'summary_large_image' },
};
```

- [ ] **Step 5: Per-page metadata**

In `app/posts/[id]/page.tsx`, add at the top (before the default export):

```ts
import type { Metadata } from 'next';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const numId = Number(id);
  if (!Number.isInteger(numId)) return { title: 'Post' };
  const [p] = await db.select().from(botPosts).where(eq(botPosts.id, numId));
  if (!p || p.status !== 'published') return { title: 'Post' };
  const cardFile = (await import('node:path')).basename(p.cardPath);
  return {
    title: p.caption.slice(0, 70),
    description: p.caption.slice(0, 200),
    openGraph: {
      title: p.caption.slice(0, 70),
      images: [`/api/cards/${encodeURIComponent(cardFile)}`],
    },
  };
}
```

In `app/c/[candidate]/page.tsx`:

```ts
import type { Metadata } from 'next';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ candidate: string }>;
}): Promise<Metadata> {
  const { candidate } = await params;
  const real = (await findCandidateByName(candidate)) ?? slugToCandidate(candidate);
  return {
    title: `${real} — Polymarket 2027`,
    description: `Cotización en Polymarket y posts del bot sobre ${real}.`,
  };
}
```

In `app/encuestadora/[slug]/page.tsx`:

```ts
import type { Metadata } from 'next';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const [pollster] = await db.select().from(pollsters).where(eq(pollsters.slug, slug));
  if (!pollster) return { title: 'Encuestadora' };
  return {
    title: pollster.displayName,
    description: `Histórico de encuestas de ${pollster.displayName}.`,
  };
}
```

In `app/2027/page.tsx`:

```ts
export const metadata = {
  title: '2027 — Mercado de elecciones presidenciales',
  description: 'Top 5 candidatos en Polymarket y timeline de últimos 30 días.',
};
```

- [ ] **Step 6: Default OG image (placeholder)**

Generate a basic OG image using existing render system:

```bash
pnpm tsx -e "
import { renderToPng } from './src/render/compose.js';
import { Ribbon } from './src/render/components/Ribbon.js';
import { Footer } from './src/render/components/Footer.js';
import { frame } from './src/render/compose.js';
import { fonts, sizes, colors } from './src/render/tokens.js';
const card = frame([
  Ribbon('POLITICA · ELECCIONES 2027 · ARGENTINA'),
  {
    type: 'div',
    props: {
      style: { flex: 1, padding: sizes.padding, display: 'flex', flexDirection: 'column', justifyContent: 'center' },
      children: [
        { type: 'div', props: { style: { fontFamily: fonts.display, fontSize: 96, color: colors.pageInk, lineHeight: 1.0 }, children: 'política' } },
        { type: 'div', props: { style: { fontFamily: fonts.body, fontSize: sizes.bodyLarge, color: colors.pageInk, marginTop: 16 }, children: 'Datos automatizados del ciclo electoral 2027.' } },
      ],
    },
  },
  Footer('siempre', 'POLYMARKET + ENCUESTAS + NOTICIAS', '@ezeqmina'),
]);
const { absPath } = await renderToPng(card, '../public/og-default');
import { copyFileSync, mkdirSync } from 'node:fs';
mkdirSync('public', { recursive: true });
copyFileSync(absPath, 'public/og-default.png');
console.log('Wrote public/og-default.png');
process.exit(0);
"

ls -la public/og-default.png
```

Expected: archivo ~25KB en `public/og-default.png`.

- [ ] **Step 7: Smoke**

```bash
pkill -f "next dev" 2>/dev/null; sleep 1
pnpm web > /tmp/seo-smoke.log 2>&1 &
sleep 12
PORT=$(grep -oE 'http://localhost:[0-9]+' /tmp/seo-smoke.log | head -1 | grep -oE '[0-9]+$')
PORT=${PORT:-3000}

# Sitemap
echo "--- /sitemap.xml ---"
curl -s "http://localhost:$PORT/sitemap.xml" | head -10

# Robots
echo "--- /robots.txt ---"
curl -s "http://localhost:$PORT/robots.txt"

# OG image
echo "--- /og-default.png ---"
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" "http://localhost:$PORT/og-default.png"

pkill -f "next dev" 2>/dev/null
```

Expected:
- sitemap.xml: válido XML con URLs
- robots.txt: contiene `Disallow: /admin/` y `Sitemap: ...`
- og-default.png: 200 image/png

- [ ] **Step 8: typecheck + tests**

```bash
pnpm typecheck && pnpm test
```

Expected: 68 tests pass.

- [ ] **Step 9: Commit**

```bash
git add app/sitemap.ts app/robots.ts app/layout.tsx app/posts app/c app/encuestadora app/2027 src/lib/env.ts .env.example public/og-default.png
git commit -m "$(cat <<'COMMIT'
feat(web): SEO — metadata, OG tags, sitemap, robots, default OG image

sitemap.ts genera URLs para home, /2027, posts published, candidatos
y encuestadoras. robots.ts disallow /admin y /api/admin|posts.
generateMetadata por página con OG images apuntando a la card del
post o a /og-default.png como fallback. SITE_URL env var (default
localhost para dev).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

### Task 9: README + smoke E2E

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README**

Use Write tool to replace `README.md` entirely:

```
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

Requisitos: Node 20+, pnpm, Docker Desktop, `claude` CLI autenticado, X API bearer token.

\`\`\`bash
cp .env.example .env
# Editar .env con X_API_BEARER_TOKEN, ADMIN_BASIC_AUTH_USER/PASS
docker compose up -d           # Postgres
pnpm install
pnpm db:migrate
pnpm tsx scripts/seed-pollsters.ts   # idempotente, solo primera vez
pnpm worker                    # arranca todo el pipeline (en una terminal)
pnpm web                       # admin + sitio público (en otra terminal)
\`\`\`

## Comandos útiles

\`\`\`bash
pnpm dev                       # worker en watch mode
pnpm worker                    # worker sin watch
pnpm web                       # Next.js dev server
pnpm web:build && pnpm web:start   # web prod build
pnpm test                      # vitest run
pnpm typecheck                 # tsc --noEmit
pnpm db:generate               # genera migración nueva
pnpm db:migrate                # aplica migraciones pendientes
pnpm db:studio                 # UI web de drizzle (browse DB)

# Bot posts admin
pnpm tsx scripts/admin.ts list
pnpm tsx scripts/admin.ts approve 42
pnpm tsx scripts/admin.ts publish-now 42
pnpm tsx scripts/admin.ts mode soft       # shadow|soft|full
pnpm tsx scripts/admin.ts kill-switch on
\`\`\`

## Modos de publicación

- **Shadow** (default): no publica nada a X. Drafts quedan en queue.
- **Soft launch**: 9-22hs ARG, cap 3/día, delay 60s post-approve.
- **Full autonomous**: 24/7 con cap 6/día, quiet hours 1-7am ARG.

**Kill switch global** bloquea TODA publicación.

## Estructura

Ver `docs/superpowers/plans/` para los planes por fase.
```

- [ ] **Step 2: E2E manual smoke**

```bash
pkill -f "next dev" 2>/dev/null; pkill -f "tsx.*orchestrator" 2>/dev/null; sleep 1

# Reset DB y seed para E2E limpio
docker compose down -v
docker compose up -d
sleep 5
pnpm db:migrate
pnpm tsx scripts/seed-pollsters.ts

# Forzar 2 events para tener algo de data
pnpm tsx -e "
import { emitEvent } from './src/trigger/events.js';
import { pool } from './src/db/client.js';
await emitEvent('MARKET_MOVE', { marketId: 'e2e5-1', candidate: 'Milei', priceNow: 0.55, priceThen: 0.50, deltaPct: 5, windowHours: 6 });
await emitEvent('MARKET_MOVE', { marketId: 'e2e5-2', candidate: 'Kicillof', priceNow: 0.30, priceThen: 0.27, deltaPct: 3, windowHours: 6 });
await pool.end();
"

# Boot worker — esperá que el orchestrator procese events
pnpm worker > /tmp/e2e5-worker.log 2>&1 &
WORKER_PID=$!
sleep 180  # 3 min: trigger orchestrator (cada 2min) procesa los 2 events

# Boot web
pnpm web > /tmp/e2e5-web.log 2>&1 &
WEB_PID=$!
sleep 12
PORT=$(grep -oE 'http://localhost:[0-9]+' /tmp/e2e5-web.log | head -1 | grep -oE '[0-9]+$')
PORT=${PORT:-3000}

# Verificar todas las páginas públicas
for path in / /2027 /encuestadora/opinaia; do
  echo "--- $path ---"
  curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:$PORT$path"
done

# Sitemap incluye URLs
echo "--- sitemap counts ---"
curl -s "http://localhost:$PORT/sitemap.xml" | grep -c "<url>"

# Admin gated
echo "--- /admin sin auth ---"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:$PORT/admin"

# Admin con auth
echo "--- /admin con auth ---"
curl -s -u admin:changeme-en-produccion -o /dev/null -w "%{http_code}\n" "http://localhost:$PORT/admin"

kill $WEB_PID 2>/dev/null
kill -INT $WORKER_PID 2>/dev/null
sleep 2
```

Expected:
- `/` → 200
- `/2027` → 200
- `/encuestadora/opinaia` → 200
- sitemap: ≥3 URLs
- `/admin` sin auth → 401
- `/admin` con auth → 200

- [ ] **Step 3: Final test suite**

```bash
pnpm typecheck && pnpm test
```

Expected: 68 tests pass.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "$(cat <<'COMMIT'
docs: README updates for Fase 5 (sitio público)

E2E manual: home, /2027, /c/[candidate], /encuestadora/[slug] y
/posts/[id] todas accesibles sin auth. /admin/* sigue gated por
basic auth. Sitemap auto-generado con URLs de todos los recursos.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Cierre de Fase 5

- [ ] **Verificación final**
  - `pnpm typecheck` y `pnpm test` pasan (68/68)
  - `pnpm worker` corre sin errores (modo shadow + KILL_SWITCH)
  - `pnpm web` levanta y todas las rutas públicas devuelven 200
  - `/admin/*` requiere basic auth (401 sin, 200 con)
  - `/sitemap.xml` y `/robots.txt` válidos
  - OG image `/og-default.png` accesible

- [ ] **Notas para Fase Ops (deploy a VPS, separada)**
  - Persistir patch de `@shuding/opentype.js` con `pnpm patch`
  - Configurar nginx en VPS con TLS para `timba2027.com`
  - `SITE_URL=https://timba2027.com` en `.env.production`
  - Backups diarios de Postgres a Backblaze B2
  - Auth admin de basic-auth → algo más serio (NextAuth con magic link?) antes de exponer público
  - Reservar handle del bot en X y ajustar `BOT_HANDLE` en env
  - Pollster handles correctos (todavía pendiente desde Fase 2)

**Output operacional**: sitio público navegable + admin gated, todo corriendo local en Mac mini. Listo para mostrar/compartir el link del staging cuando quieras (vía Tailscale ahora; vía VPS cuando hagas el deploy).
