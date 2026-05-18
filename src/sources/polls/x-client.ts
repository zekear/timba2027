import { z } from 'zod';
import { env } from '../../lib/env.js';
import { fetchWithTimeout } from '../../lib/http.js';
import { logger } from '../../lib/logger.js';

// ─── Schemas ───────────────────────────────────────────────────────

export const xUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  name: z.string(),
});
export type XUser = z.infer<typeof xUserSchema>;

export const xMediaSchema = z.object({
  media_key: z.string(),
  type: z.enum(['photo', 'video', 'animated_gif']),
  url: z.string().url().optional(),
  preview_image_url: z.string().url().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
});
export type XMedia = z.infer<typeof xMediaSchema>;

export const xTweetSchema = z.object({
  id: z.string(),
  text: z.string(),
  author_id: z.string().optional(),
  created_at: z.string().datetime().optional(),
  attachments: z.object({
    media_keys: z.array(z.string()).optional(),
  }).optional(),
});
export type XTweet = z.infer<typeof xTweetSchema>;

export interface XTimelinePage {
  tweets: XTweet[];
  media: Map<string, XMedia>;
}

// ─── Client ────────────────────────────────────────────────────────

function authHeaders(): Record<string, string> {
  const token = env.X_API_BEARER_TOKEN;
  if (!token) {
    throw new Error('X_API_BEARER_TOKEN no está set (configurar en .env)');
  }
  return { authorization: `Bearer ${token}`, accept: 'application/json' };
}

/**
 * Buscar el user_id de una username. Cuesta 1 read.
 */
export async function getUserByUsername(username: string): Promise<XUser> {
  const url = `${env.X_API_BASE}/users/by/username/${encodeURIComponent(username)}`;
  const res = await fetchWithTimeout(url, { timeoutMs: 10_000, headers: authHeaders() });
  if (!res.ok) throw new Error(`X getUserByUsername ${username} failed: ${res.status} ${await res.text()}`);
  const json = await res.json() as { data?: unknown };
  logger.info({ endpoint: 'users/by/username', cost: 0.005, type: 'read', username }, 'x-api: call');
  return xUserSchema.parse(json.data);
}

/**
 * Fetch últimos N tweets de un usuario, con media expandida.
 * max_results: 5 a 100. Cuesta `max_results` reads aprox.
 */
export async function getUserTimeline(
  userId: string,
  opts: { maxResults?: number; sinceId?: string } = {},
): Promise<XTimelinePage> {
  const params = new URLSearchParams({
    max_results: String(opts.maxResults ?? 10),
    'tweet.fields': 'created_at,attachments,author_id',
    expansions: 'attachments.media_keys',
    'media.fields': 'media_key,type,url,preview_image_url,width,height',
    exclude: 'retweets,replies',
  });
  if (opts.sinceId) params.set('since_id', opts.sinceId);

  const url = `${env.X_API_BASE}/users/${userId}/tweets?${params.toString()}`;
  const res = await fetchWithTimeout(url, { timeoutMs: 15_000, headers: authHeaders() });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`X getUserTimeline ${userId} failed: ${res.status} ${body.slice(0, 300)}`);
  }
  const json = await res.json() as {
    data?: unknown[];
    includes?: { media?: unknown[] };
    meta?: { result_count?: number };
  };
  logger.info(
    { endpoint: 'users/tweets', cost: 0.005, type: 'read', userId, returned: json.data?.length ?? 0 },
    'x-api: call',
  );

  const tweets: XTweet[] = (json.data ?? []).flatMap((item) => {
    const result = xTweetSchema.safeParse(item);
    if (result.success) return [result.data];
    logger.warn({ errors: result.error.flatten() }, 'x: skipping malformed tweet');
    return [];
  });

  const media = new Map<string, XMedia>();
  for (const item of json.includes?.media ?? []) {
    const result = xMediaSchema.safeParse(item);
    if (result.success) media.set(result.data.media_key, result.data);
  }

  return { tweets, media };
}

/**
 * Fetch media binary (la imagen real para vision extraction).
 * No usa auth — las URLs de pbs.twimg.com son públicas.
 */
export async function fetchMediaBinary(url: string): Promise<Buffer> {
  const res = await fetchWithTimeout(url, { timeoutMs: 20_000 });
  if (!res.ok) throw new Error(`X media fetch failed: ${res.status} ${url}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}
