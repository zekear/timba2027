/**
 * Lectura de métricas públicas de tweets desde X API v2.
 *
 * Usa el endpoint bulk `GET /2/tweets?ids=<csv>` que acepta hasta 100 ids
 * por request → 1 read op (~$0.005) por batch, independiente del N.
 *
 * Devuelve { like_count, reply_count, retweet_count, quote_count,
 * bookmark_count, impression_count } por tweet.
 *
 * NOTA: para `non_public_metrics` (e.g. profile_clicks, url_link_clicks)
 * X exige OAuth user context. Hoy solo expone `public_metrics` con bearer;
 * con OAuth 1.0a también devuelve `non_public_metrics` para tweets del
 * propio user. Acá usamos `public_metrics` (suficiente para engagement
 * básico) — bumpear a non_public si quisiéramos profile clicks.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { env } from '../lib/env.js';
import { fetchWithTimeout } from '../lib/http.js';
import { logger } from '../lib/logger.js';

const TIMEOUT_MS = 20_000;
const BATCH_SIZE = 100; // X max ids per request

export interface PublicMetrics {
  like_count: number;
  reply_count: number;
  retweet_count: number;
  quote_count: number;
  bookmark_count?: number;
  impression_count?: number;
}

function pctEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!*'()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function oauthCreds() {
  const ck = env.X_API_CONSUMER_KEY;
  const cs = env.X_API_CONSUMER_SECRET;
  const at = env.X_API_ACCESS_TOKEN;
  const ats = env.X_API_ACCESS_TOKEN_SECRET;
  if (!ck || !cs || !at || !ats) {
    throw new Error('OAuth 1.0a creds missing — cannot fetch metrics');
  }
  return { ck, cs, at, ats };
}

/**
 * Firma OAuth 1.0a HMAC-SHA1 para GET request. Los query params SÍ
 * entran en la base string (a diferencia de POST application/json).
 */
function signedAuthHeader(url: URL): string {
  const { ck, cs, at, ats } = oauthCreds();
  const oauth: Record<string, string> = {
    oauth_consumer_key: ck,
    oauth_nonce: randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: at,
    oauth_version: '1.0',
  };
  // Merge oauth + query params para la base string
  const allParams: Record<string, string> = { ...oauth };
  url.searchParams.forEach((v, k) => {
    allParams[k] = v;
  });
  const paramString = Object.keys(allParams)
    .sort()
    .map((k) => `${pctEncode(k)}=${pctEncode(allParams[k]!)}`)
    .join('&');
  const baseUrl = `${url.protocol}//${url.host}${url.pathname}`;
  const baseString = ['GET', pctEncode(baseUrl), pctEncode(paramString)].join('&');
  const signingKey = `${pctEncode(cs)}&${pctEncode(ats)}`;
  const signature = createHmac('sha1', signingKey).update(baseString).digest('base64');
  const headerParams = { ...oauth, oauth_signature: signature };
  return (
    'OAuth ' +
    Object.keys(headerParams)
      .sort()
      .map((k) => `${pctEncode(k)}="${pctEncode(headerParams[k as keyof typeof headerParams]!)}"`)
      .join(', ')
  );
}

/**
 * Trae public_metrics para una lista de tweet ids. Hace batches de 100.
 * Devuelve un Map id → metrics. Tweets borrados o protegidos no aparecen
 * en el map.
 */
export async function fetchPostMetrics(tweetIds: string[]): Promise<Map<string, PublicMetrics>> {
  const out = new Map<string, PublicMetrics>();
  if (tweetIds.length === 0) return out;

  for (let i = 0; i < tweetIds.length; i += BATCH_SIZE) {
    const batch = tweetIds.slice(i, i + BATCH_SIZE);
    const url = new URL(`${env.X_API_BASE}/tweets`);
    url.searchParams.set('ids', batch.join(','));
    url.searchParams.set('tweet.fields', 'public_metrics');

    const res = await fetchWithTimeout(url.toString(), {
      timeoutMs: TIMEOUT_MS,
      method: 'GET',
      headers: {
        authorization: signedAuthHeader(url),
        accept: 'application/json',
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`X metrics fetch failed: ${res.status} ${body.slice(0, 300)}`);
    }
    const json = (await res.json()) as {
      data?: Array<{ id: string; public_metrics?: PublicMetrics }>;
      errors?: unknown[];
    };
    for (const t of json.data ?? []) {
      if (t.public_metrics) out.set(t.id, t.public_metrics);
    }
    logger.debug(
      { batchSize: batch.length, returned: json.data?.length ?? 0, errors: json.errors?.length ?? 0 },
      'x-metrics: batch fetched',
    );
  }

  return out;
}
