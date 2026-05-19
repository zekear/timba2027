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
 * Header OAuth para requests donde los query params SÍ entran en la base
 * string (INIT/FINALIZE/STATUS del chunked upload v1.1, que pasan
 * `command`, `media_id`, etc. por query string).
 */
function oauthHeaderWithQuery(method: 'POST' | 'GET', urlObj: URL): string {
  const { ck, cs, at, ats } = oauthCreds();
  const oauth: Record<string, string> = {
    oauth_consumer_key: ck,
    oauth_nonce: randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: at,
    oauth_version: '1.0',
  };
  const allParams: Record<string, string> = { ...oauth };
  urlObj.searchParams.forEach((v, k) => {
    allParams[k] = v;
  });
  const paramString = Object.keys(allParams)
    .sort()
    .map((k) => `${pctEncode(k)}=${pctEncode(allParams[k]!)}`)
    .join('&');
  const baseUrl = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
  const baseString = [method, pctEncode(baseUrl), pctEncode(paramString)].join('&');
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

const CHUNKED_UPLOAD_URL = 'https://upload.twitter.com/1.1/media/upload.json';
const CHUNKED_TIMEOUT_MS = 60_000;
const STATUS_POLL_TIMEOUT_MS = 60_000;

/**
 * Upload de GIF animado vía endpoint chunked v1.1 (3 pasos: INIT, APPEND,
 * FINALIZE; opcional STATUS polling).
 *
 * El endpoint simple v2 no acepta GIFs para uso en tweets. La cuenta
 * `tweet_gif` solo está disponible vía chunked v1.1.
 *
 * Para los GIFs nuestros (~200KB) basta con 1 segment. La función supporta
 * más segments si en el futuro pasamos a archivos más grandes (chunk size 5MB).
 */
async function uploadMediaChunked(buffer: Buffer, mimeType: 'image/gif'): Promise<string> {
  // ── STEP 1: INIT ─────────────────────────────────────────────
  const initUrl = new URL(CHUNKED_UPLOAD_URL);
  initUrl.searchParams.set('command', 'INIT');
  initUrl.searchParams.set('total_bytes', String(buffer.length));
  initUrl.searchParams.set('media_type', mimeType);
  initUrl.searchParams.set('media_category', 'tweet_gif');

  const initRes = await fetchWithTimeout(initUrl.toString(), {
    timeoutMs: CHUNKED_TIMEOUT_MS,
    method: 'POST',
    headers: {
      authorization: oauthHeaderWithQuery('POST', initUrl),
      accept: 'application/json',
    },
  });
  if (!initRes.ok) {
    const body = await initRes.text();
    throw new Error(`X chunked INIT failed: ${initRes.status} ${body.slice(0, 300)}`);
  }
  const initJson = (await initRes.json()) as { media_id_string?: string };
  const mediaId = initJson.media_id_string;
  if (!mediaId) throw new Error(`X chunked INIT returned no media_id: ${JSON.stringify(initJson).slice(0, 300)}`);

  // ── STEP 2: APPEND ────────────────────────────────────────────
  // APPEND es multipart, sus body params NO van en la base string (igual que
  // el endpoint simple v2). Los OAuth params del header son los únicos.
  // command, media_id y segment_index van como query string PERO según docs
  // de X tampoco entran en la base string para multipart. Para simplicidad
  // los pasamos como form fields (junto con el binary).
  const appendUrl = new URL(CHUNKED_UPLOAD_URL);
  const appendForm = new FormData();
  appendForm.append('command', 'APPEND');
  appendForm.append('media_id', mediaId);
  appendForm.append('segment_index', '0');
  appendForm.append('media', new Blob([buffer], { type: mimeType }), 'card.gif');

  const appendRes = await fetchWithTimeout(appendUrl.toString(), {
    timeoutMs: CHUNKED_TIMEOUT_MS,
    method: 'POST',
    headers: {
      authorization: oauthHeader('POST', appendUrl.toString()),
      accept: 'application/json',
    },
    body: appendForm,
  });
  if (!appendRes.ok) {
    const body = await appendRes.text();
    throw new Error(`X chunked APPEND failed: ${appendRes.status} ${body.slice(0, 300)}`);
  }
  // APPEND devuelve 2xx sin body (204 No Content típicamente)

  // ── STEP 3: FINALIZE ──────────────────────────────────────────
  const finalUrl = new URL(CHUNKED_UPLOAD_URL);
  finalUrl.searchParams.set('command', 'FINALIZE');
  finalUrl.searchParams.set('media_id', mediaId);
  const finalRes = await fetchWithTimeout(finalUrl.toString(), {
    timeoutMs: CHUNKED_TIMEOUT_MS,
    method: 'POST',
    headers: {
      authorization: oauthHeaderWithQuery('POST', finalUrl),
      accept: 'application/json',
    },
  });
  if (!finalRes.ok) {
    const body = await finalRes.text();
    throw new Error(`X chunked FINALIZE failed: ${finalRes.status} ${body.slice(0, 300)}`);
  }
  const finalJson = (await finalRes.json()) as {
    processing_info?: { state: string; check_after_secs?: number; error?: { message?: string } };
  };

  // ── STEP 4: STATUS polling (si hay processing_info) ──────────
  if (finalJson.processing_info) {
    const startedAt = Date.now();
    let pi = finalJson.processing_info;
    while (pi.state === 'pending' || pi.state === 'in_progress') {
      if (Date.now() - startedAt > STATUS_POLL_TIMEOUT_MS) {
        throw new Error(`X chunked STATUS timeout: still ${pi.state} after ${STATUS_POLL_TIMEOUT_MS}ms`);
      }
      await new Promise((r) => setTimeout(r, (pi.check_after_secs ?? 1) * 1000));
      const statusUrl = new URL(CHUNKED_UPLOAD_URL);
      statusUrl.searchParams.set('command', 'STATUS');
      statusUrl.searchParams.set('media_id', mediaId);
      const statusRes = await fetchWithTimeout(statusUrl.toString(), {
        timeoutMs: CHUNKED_TIMEOUT_MS,
        method: 'GET',
        headers: {
          authorization: oauthHeaderWithQuery('GET', statusUrl),
          accept: 'application/json',
        },
      });
      if (!statusRes.ok) {
        const body = await statusRes.text();
        throw new Error(`X chunked STATUS failed: ${statusRes.status} ${body.slice(0, 300)}`);
      }
      const statusJson = (await statusRes.json()) as {
        processing_info?: { state: string; check_after_secs?: number; error?: { message?: string } };
      };
      if (!statusJson.processing_info) break;
      pi = statusJson.processing_info;
    }
    if (pi.state === 'failed') {
      throw new Error(`X chunked processing failed: ${pi.error?.message ?? 'unknown'}`);
    }
  }

  logger.info(
    { endpoint: 'media/upload (chunked)', cost: 0.015, type: 'write', mediaId, bytes: buffer.length },
    'x-api: call',
  );
  return mediaId;
}

/**
 * Upload de media binario a X (POST /2/media/upload). Multipart con field 'media'.
 * Devuelve el media_id_string que se usa en createTweet().
 *
 * Costo: 1 write op + bandwidth.
 */
export async function uploadMedia(
  buffer: Buffer,
  mimeType: 'image/png' | 'image/jpeg' | 'image/gif',
): Promise<string> {
  // GIFs animados: el endpoint v2 simple los acepta pero el media_id no
  // se puede usar en createTweet. Hace falta el flow chunked v1.1
  // (INIT → APPEND → FINALIZE → STATUS) con media_category=tweet_gif.
  if (mimeType === 'image/gif') {
    return uploadMediaChunked(buffer, mimeType);
  }

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
  logger.info(
    { endpoint: 'media/upload', cost: 0.015, type: 'write', mediaId: id, bytes: buffer.length },
    'x-api: call',
  );
  return id;
}

/**
 * Crea un tweet con texto + media opcional. Devuelve el tweet id.
 * Si se pasa replyToTweetId, el tweet se postea como reply (threading).
 * POST /2/tweets — costo: 1 write ($0.015 desde abril 2026).
 */
export async function createTweet(opts: {
  text: string;
  mediaIds: string[];
  replyToTweetId?: string;
}): Promise<string> {
  const url = `${env.X_API_BASE}/tweets`;
  const body: Record<string, unknown> = { text: opts.text };
  if (opts.mediaIds.length > 0) {
    body.media = { media_ids: opts.mediaIds };
  }
  if (opts.replyToTweetId) {
    body.reply = { in_reply_to_tweet_id: opts.replyToTweetId };
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
  logger.info(
    { endpoint: 'tweets', cost: 0.015, type: 'write', tweetId: id, mediaCount: opts.mediaIds.length },
    'x-api: call',
  );
  return id;
}
