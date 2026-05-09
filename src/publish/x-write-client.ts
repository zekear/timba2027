import { createHmac, randomBytes } from 'node:crypto';
import { env } from '../lib/env.js';
import { fetchWithTimeout } from '../lib/http.js';
import { logger } from '../lib/logger.js';

const TWEET_TIMEOUT_MS = 20_000;
const MEDIA_TIMEOUT_MS = 30_000;

function pctEncode(s: string): string {
  return encodeURIComponent(s).replace(
    /[!*'()]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

function oauthCreds() {
  const ck = env.X_API_CONSUMER_KEY;
  const cs = env.X_API_CONSUMER_SECRET;
  const at = env.X_API_ACCESS_TOKEN;
  const ats = env.X_API_ACCESS_TOKEN_SECRET;
  if (!ck || !cs || !at || !ats) {
    throw new Error(
      'OAuth 1.0a credentials missing (X_API_CONSUMER_KEY / _SECRET / _ACCESS_TOKEN / _ACCESS_TOKEN_SECRET); cannot publish',
    );
  }
  return { ck, cs, at, ats };
}

/**
 * Construye el header Authorization: OAuth ... para una request firmada con OAuth 1.0a HMAC-SHA1.
 * Para multipart (uploadMedia) los params del body NO entran en la base string — solo los oauth_*.
 * Para application/json (createTweet) tampoco — solo oauth_*.
 * (form-encoded es el único caso donde sí entrarían, y no lo usamos.)
 */
function oauthHeader(method: 'POST' | 'GET', url: string): string {
  const { ck, cs, at, ats } = oauthCreds();
  const params: Record<string, string> = {
    oauth_consumer_key: ck,
    oauth_nonce: randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: at,
    oauth_version: '1.0',
  };

  const paramString = Object.keys(params)
    .sort()
    .map((k) => `${pctEncode(k)}=${pctEncode(params[k]!)}`)
    .join('&');

  const baseString = [method, pctEncode(url), pctEncode(paramString)].join('&');
  const signingKey = `${pctEncode(cs)}&${pctEncode(ats)}`;
  const signature = createHmac('sha1', signingKey).update(baseString).digest('base64');

  const headerParams = { ...params, oauth_signature: signature };
  return (
    'OAuth ' +
    Object.keys(headerParams)
      .sort()
      .map((k) => `${pctEncode(k)}="${pctEncode(headerParams[k as keyof typeof headerParams]!)}"`)
      .join(', ')
  );
}

/**
 * Upload de media binario a X (POST /2/media/upload). Multipart con field 'media'.
 * Devuelve el media_id_string que se usa en createTweet().
 *
 * Costo: 1 write op + bandwidth.
 */
export async function uploadMedia(
  buffer: Buffer,
  mimeType: 'image/png' | 'image/jpeg',
): Promise<string> {
  const url = `${env.X_API_BASE}/media/upload`;
  const blob = new Blob([buffer], { type: mimeType });
  const form = new FormData();
  form.append('media', blob, 'card.png');
  form.append('media_category', 'tweet_image');

  const res = await fetchWithTimeout(url, {
    timeoutMs: MEDIA_TIMEOUT_MS,
    method: 'POST',
    headers: {
      authorization: oauthHeader('POST', url),
      accept: 'application/json',
    },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`X uploadMedia failed: ${res.status} ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { data?: { id?: string } };
  const id = json.data?.id;
  if (!id) {
    throw new Error(`X uploadMedia returned no id: ${JSON.stringify(json).slice(0, 300)}`);
  }
  logger.debug({ mediaId: id, bytes: buffer.length }, 'x: media uploaded');
  return id;
}

/**
 * Crea un tweet con texto + media opcional. Devuelve el tweet id.
 * POST /2/tweets — costo: 1 write ($0.015 desde abril 2026).
 */
export async function createTweet(opts: {
  text: string;
  mediaIds: string[];
}): Promise<string> {
  const url = `${env.X_API_BASE}/tweets`;
  const body: Record<string, unknown> = { text: opts.text };
  if (opts.mediaIds.length > 0) {
    body.media = { media_ids: opts.mediaIds };
  }
  const res = await fetchWithTimeout(url, {
    timeoutMs: TWEET_TIMEOUT_MS,
    method: 'POST',
    headers: {
      authorization: oauthHeader('POST', url),
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`X createTweet failed: ${res.status} ${errText.slice(0, 300)}`);
  }
  const json = (await res.json()) as { data?: { id?: string } };
  const id = json.data?.id;
  if (!id) {
    throw new Error(`X createTweet returned no id: ${JSON.stringify(json).slice(0, 300)}`);
  }
  logger.info({ tweetId: id, mediaCount: opts.mediaIds.length }, 'x: tweet created');
  return id;
}
