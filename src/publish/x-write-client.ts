import { env } from '../lib/env.js';
import { fetchWithTimeout } from '../lib/http.js';
import { logger } from '../lib/logger.js';

const TWEET_TIMEOUT_MS = 20_000;
const MEDIA_TIMEOUT_MS = 30_000;

function authHeaders(): Record<string, string> {
  if (!env.X_API_BEARER_TOKEN) {
    throw new Error('X_API_BEARER_TOKEN not set; cannot publish');
  }
  return {
    authorization: `Bearer ${env.X_API_BEARER_TOKEN}`,
    accept: 'application/json',
  };
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

  const res = await fetchWithTimeout(url, {
    timeoutMs: MEDIA_TIMEOUT_MS,
    method: 'POST',
    headers: authHeaders(),
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
    headers: { ...authHeaders(), 'content-type': 'application/json' },
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
