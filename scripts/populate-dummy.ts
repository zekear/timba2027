/**
 * Populate idempotente con datos dummy para preview del sitio público.
 * Marca todos los rows con un prefijo 'dummy-' o flag jsonb { dummy: true }
 * para poder borrarlos después sin tocar datos reales.
 *
 * Uso:
 *   pnpm tsx scripts/populate-dummy.ts        # insert
 *   pnpm tsx scripts/populate-dummy.ts clean  # remove
 */
import { sql, eq } from 'drizzle-orm';
import { db, pool } from '../src/db/client.js';
import { botPosts, polls, pollsters, marketPrices, markets } from '../src/db/schema.js';

const DUMMY_TWEET_PREFIX = 'dummy-tweet-';
const DUMMY_POLL_PREFIX = 'dummy-poll-';

async function clean(): Promise<void> {
  // Cubre tanto published (con x_post_id dummy) como drafts (sin x_post_id pero
  // con llm_metadata.dummy = true). Único predicate.
  await db.execute(sql`DELETE FROM bot_posts WHERE llm_metadata->>'dummy' = 'true'`);
  await db.execute(sql`DELETE FROM polls WHERE source_tweet_id LIKE ${DUMMY_POLL_PREFIX + '%'}`);
  // Synthetic price snapshots: timestamp at exact noon UTC, > 6h ago.
  // Polymarket ingest jamás tira ts a las 12:00:00.000Z exactas.
  await db.execute(sql`
    DELETE FROM market_prices
    WHERE EXTRACT(HOUR FROM ts) = 12
      AND EXTRACT(MINUTE FROM ts) = 0
      AND EXTRACT(SECOND FROM ts) = 0
      AND EXTRACT(MILLISECOND FROM ts) = 0
      AND ts < NOW() - INTERVAL '6 hours'
  `);
  console.log('Dummy data removed.');
}

async function populatePriceHistory(): Promise<number> {
  // Buscar el market de presidenciales 2027
  const [market] = await db
    .select()
    .from(markets)
    .where(eq(markets.slug, 'argentina-presidential-election-winner'));
  if (!market) {
    console.log('Market argentina-presidential-election-winner no existe — skip price history.');
    return 0;
  }

  // Latest price por candidato (la "actual")
  const latestRes = await db.execute(sql`
    SELECT DISTINCT ON (candidate) candidate, price::float AS price
    FROM market_prices
    WHERE market_id = ${market.id}
    ORDER BY candidate, ts DESC
  `);
  const candidates = (latestRes.rows as Array<{ candidate: string; price: number }>);
  if (candidates.length === 0) {
    console.log('Sin candidatos en market_prices — skip.');
    return 0;
  }

  // Para cada candidato, generar 30 snapshots diarios (12:00 UTC) terminando ayer.
  // Random walk centrado en el precio actual con variación ~±0.02 día a día.
  const NOW = Date.now();
  const DAY = 24 * 3_600_000;
  let inserted = 0;

  for (const { candidate, price: latest } of candidates) {
    let price = Math.max(0.005, latest - 0.05); // empieza más bajo, sube hacia el actual
    const targetTrend = (latest - price) / 30;  // converge linealmente hacia latest
    const rows: Array<{ ts: Date; price: number }> = [];
    for (let daysAgo = 30; daysAgo >= 1; daysAgo--) {
      // Trend gradual + noise pequeño
      const noise = (Math.random() - 0.5) * 0.015;
      price = Math.max(0.005, Math.min(0.95, price + targetTrend + noise));
      const date = new Date(NOW - daysAgo * DAY);
      date.setUTCHours(12, 0, 0, 0);
      rows.push({ ts: date, price });
    }
    // Insert batch
    for (const r of rows) {
      await db.insert(marketPrices).values({
        marketId: market.id,
        candidate,
        price: r.price.toFixed(4),
        ts: r.ts,
      });
      inserted++;
    }
  }
  return inserted;
}

async function populate(): Promise<void> {
  await clean();

  const now = Date.now();
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;

  // 6 published bot_posts con shapes variados, fechas escalonadas
  const dummies: Array<{
    shape: 'morning_brief' | 'market_move' | 'new_poll' | 'hot_news';
    caption: string;
    cardPath: string;
    candidateFocus: string | null;
    sourceSnapshot: Record<string, unknown>;
    daysAgo: number;
  }> = [
    {
      shape: 'morning_brief',
      caption:
        'Morning brief: Polymarket sin sorpresas. Milei mantiene liderazgo con 51.5%, Kicillof segundo con 29.5%. Bullrich consolida tercer lugar.',
      cardPath: 'storage/cards/smoke-morning-brief.png',
      candidateFocus: null,
      sourceSnapshot: {
        topCandidates: [
          { candidato: 'Milei', pct: 51.5 },
          { candidato: 'Kicillof', pct: 29.5 },
          { candidato: 'Bullrich', pct: 9.2 },
        ],
      },
      daysAgo: 0,
    },
    {
      shape: 'market_move',
      caption:
        '🔔 Milei sube 4.2 puntos en Polymarket en las últimas 6 horas. Mercado actual: 52.0%. Encuesta más cercana de Opinaia: 45.2%.',
      cardPath: 'storage/cards/smoke-market-move.png',
      candidateFocus: 'Milei',
      sourceSnapshot: {
        event: {
          marketId: 'dummy',
          candidate: 'Milei',
          priceNow: 0.52,
          priceThen: 0.48,
          deltaPct: 4.2,
          windowHours: 6,
        },
      },
      daysAgo: 0,
    },
    {
      shape: 'new_poll',
      caption:
        'Nueva encuesta de Opinaia (campo 28/04, n=1200): Milei 45.2%, Kicillof 28.5%, Bullrich 12.0%, Massa 8.5%.',
      cardPath: 'storage/cards/smoke-new-poll.png',
      candidateFocus: 'Milei',
      sourceSnapshot: {
        pollsterDisplayName: 'Opinaia',
        topCandidate: 'Milei',
        topCandidatePct: 45.2,
        sampleSize: 1200,
      },
      daysAgo: 1,
    },
    {
      shape: 'hot_news',
      caption:
        'Clarín: Diputados aprobó la reforma jubilatoria que impulsó el gobierno. Polymarket Milei +3.2pp en las últimas 24h.',
      cardPath: 'storage/cards/smoke-hot-news.png',
      candidateFocus: 'Milei',
      sourceSnapshot: {
        source: 'Clarín',
        headline: 'Diputados aprobó la reforma jubilatoria',
        candidatesMentioned: ['Milei', 'Bullrich'],
        relevanceScore: 0.85,
        correlatedMove: { candidate: 'Milei', deltaPct: 3.2 },
      },
      daysAgo: 1,
    },
    {
      shape: 'market_move',
      caption:
        'Kicillof recupera 2.1 puntos en Polymarket tras cierre de semana legislativa. Mercado actual: 31.5%.',
      cardPath: 'storage/cards/event-263-market-move.png',
      candidateFocus: 'Kicillof',
      sourceSnapshot: {
        event: {
          marketId: 'dummy',
          candidate: 'Kicillof',
          priceNow: 0.315,
          priceThen: 0.294,
          deltaPct: 2.1,
          windowHours: 12,
        },
      },
      daysAgo: 2,
    },
    {
      shape: 'new_poll',
      caption:
        'CB Consultora publicó nueva medición: Milei 47.8%, Kicillof 27.1%, Bullrich 11.4%. Diferencia con Polymarket: 4.3pp.',
      cardPath: 'storage/cards/event-262-new-poll.png',
      candidateFocus: 'Milei',
      sourceSnapshot: {
        pollsterDisplayName: 'CB Consultora',
        topCandidate: 'Milei',
        topCandidatePct: 47.8,
        sampleSize: 1500,
      },
      daysAgo: 3,
    },
  ];

  let inserted = 0;
  for (let i = 0; i < dummies.length; i++) {
    const d = dummies[i];
    await db.insert(botPosts).values({
      shape: d.shape,
      status: 'published',
      caption: d.caption,
      cardPath: d.cardPath,
      sourceSnapshot: d.sourceSnapshot,
      llmMetadata: { source: 'fallback', attempts: 1, lintViolations: [], dummy: true },
      candidateFocus: d.candidateFocus,
      generatedAt: new Date(now - d.daysAgo * DAY - HOUR),
      publishedAt: new Date(now - d.daysAgo * DAY),
      xPostId: `${DUMMY_TWEET_PREFIX}${i + 1}`,
    });
    inserted++;
  }

  // 3 polls dummies para CB Consultora (para que /encuestadora/cb_consultora tenga contenido)
  const [cb] = await db.select().from(pollsters).where(eq(pollsters.slug, 'cb_consultora'));
  if (cb) {
    const pollsData = [
      {
        sourceUrl: 'https://x.com/i/status/dummy-poll-1',
        sourceTweetId: `${DUMMY_POLL_PREFIX}1`,
        fechaCampo: new Date(now - 7 * DAY),
        sampleSize: 1200,
        metodologia: 'online',
        results: [
          { candidato: 'Milei', pct: 45.2 },
          { candidato: 'Kicillof', pct: 28.5 },
          { candidato: 'Bullrich', pct: 12.0 },
          { candidato: 'Massa', pct: 8.5 },
          { candidato: 'Otros', pct: 5.8 },
        ],
        confidence: 'alto' as const,
        status: 'auto_approved' as const,
      },
      {
        sourceUrl: 'https://x.com/i/status/dummy-poll-2',
        sourceTweetId: `${DUMMY_POLL_PREFIX}2`,
        fechaCampo: new Date(now - 14 * DAY),
        sampleSize: 1100,
        metodologia: 'online',
        results: [
          { candidato: 'Milei', pct: 44.0 },
          { candidato: 'Kicillof', pct: 29.2 },
          { candidato: 'Bullrich', pct: 11.8 },
          { candidato: 'Massa', pct: 9.0 },
          { candidato: 'Otros', pct: 6.0 },
        ],
        confidence: 'alto' as const,
        status: 'auto_approved' as const,
      },
      {
        sourceUrl: 'https://x.com/i/status/dummy-poll-3',
        sourceTweetId: `${DUMMY_POLL_PREFIX}3`,
        fechaCampo: new Date(now - 21 * DAY),
        sampleSize: 1300,
        metodologia: 'mixta',
        results: [
          { candidato: 'Milei', pct: 42.5 },
          { candidato: 'Kicillof', pct: 30.1 },
          { candidato: 'Bullrich', pct: 12.5 },
          { candidato: 'Massa', pct: 9.2 },
          { candidato: 'Otros', pct: 5.7 },
        ],
        confidence: 'alto' as const,
        status: 'auto_approved' as const,
      },
    ];
    for (const p of pollsData) {
      await db.insert(polls).values({ ...p, pollsterId: cb.id });
    }
  }

  // 4 drafts (uno por shape) para popular la review queue del admin
  const drafts: Array<{
    shape: 'morning_brief' | 'market_move' | 'new_poll' | 'hot_news';
    caption: string;
    cardPath: string;
    candidateFocus: string | null;
    sourceSnapshot: Record<string, unknown>;
    minutesAgo: number;
  }> = [
    {
      shape: 'morning_brief',
      caption:
        'Morning brief: Polymarket abre la semana sin grandes movimientos. Milei 51.5% lidera, Kicillof 29.5% segundo.',
      cardPath: 'storage/cards/morning-brief-2026-05-05.png',
      candidateFocus: null,
      sourceSnapshot: {
        topCandidates: [
          { candidato: 'Milei', pct: 51.5, deltaPct: 0.3 },
          { candidato: 'Kicillof', pct: 29.5, deltaPct: -0.2 },
          { candidato: 'Bullrich', pct: 9.2, deltaPct: 0.0 },
        ],
      },
      minutesAgo: 15,
    },
    {
      shape: 'market_move',
      caption:
        '🔔 Milei +3.5pp en Polymarket en 6 horas. Mercado actual 53.0% — máximo de los últimos 30 días.',
      cardPath: 'storage/cards/event-263-market-move.png',
      candidateFocus: 'Milei',
      sourceSnapshot: {
        event: {
          marketId: 'dummy',
          candidate: 'Milei',
          priceNow: 0.53,
          priceThen: 0.495,
          deltaPct: 3.5,
          windowHours: 6,
        },
      },
      minutesAgo: 45,
    },
    {
      shape: 'new_poll',
      caption:
        'Synopsis publicó nueva medición: Bullrich repunta a 13.8%, Milei 46.5%. Spread con Polymarket: -5pp.',
      cardPath: 'storage/cards/event-262-new-poll.png',
      candidateFocus: 'Bullrich',
      sourceSnapshot: {
        pollsterDisplayName: 'Synopsis Consultores',
        topCandidate: 'Milei',
        topCandidatePct: 46.5,
        sampleSize: 1100,
      },
      minutesAgo: 90,
    },
    {
      shape: 'hot_news',
      caption:
        'La Nación: Kicillof anunció gabinete de campaña. Polymarket Kicillof +1.8pp/24h.',
      cardPath: 'storage/cards/smoke-hot-news.png',
      candidateFocus: 'Kicillof',
      sourceSnapshot: {
        source: 'La Nación',
        headline: 'Kicillof presentó equipo de campaña 2027',
        candidatesMentioned: ['Kicillof', 'Massa'],
        relevanceScore: 0.78,
        correlatedMove: { candidate: 'Kicillof', deltaPct: 1.8 },
      },
      minutesAgo: 180,
    },
  ];

  for (const d of drafts) {
    await db.insert(botPosts).values({
      shape: d.shape,
      status: 'draft',
      caption: d.caption,
      cardPath: d.cardPath,
      sourceSnapshot: d.sourceSnapshot,
      llmMetadata: {
        source: 'llm',
        attempts: 1,
        lintViolations: [],
        rawOutputs: [d.caption],
        dummy: true,
      },
      candidateFocus: d.candidateFocus,
      generatedAt: new Date(now - d.minutesAgo * 60 * 1000),
    });
    inserted++;
  }

  const priceRows = await populatePriceHistory();
  console.log(
    `Inserted ${inserted} bot_posts (6 published + 4 drafts), ${cb ? 3 : 0} polls, ${priceRows} price snapshots (30 days).`,
  );
}

const cmd = process.argv[2];
try {
  if (cmd === 'clean') await clean();
  else await populate();
} finally {
  await pool.end();
}
