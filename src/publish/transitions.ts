import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { botPosts } from '../db/schema.js';
import { logger } from '../lib/logger.js';

export class TransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransitionError';
  }
}

async function getPost(id: number) {
  const rows = await db.select().from(botPosts).where(eq(botPosts.id, id));
  if (!rows.length) throw new TransitionError(`bot_post ${id} not found`);
  return rows[0];
}

/** draft → approved */
export async function approveDraft(id: number): Promise<void> {
  const p = await getPost(id);
  if (p.status !== 'draft') {
    throw new TransitionError(`can only approve draft posts (got status=${p.status})`);
  }
  await db.update(botPosts).set({ status: 'approved' }).where(eq(botPosts.id, id));
  logger.info({ postId: id }, 'transition: draft → approved');
}

/** approved → scheduled (post-soft-launch-delay window) */
export async function schedulePost(id: number): Promise<void> {
  const p = await getPost(id);
  if (p.status !== 'approved') {
    throw new TransitionError(`can only schedule approved posts (got status=${p.status})`);
  }
  await db.update(botPosts).set({ status: 'scheduled' }).where(eq(botPosts.id, id));
  logger.info({ postId: id }, 'transition: approved → scheduled');
}

/** scheduled → published (tras X API exitoso) */
export async function markPublished(id: number, xPostId: string): Promise<void> {
  const p = await getPost(id);
  if (p.status !== 'scheduled') {
    throw new TransitionError(`can only mark scheduled posts as published (got status=${p.status})`);
  }
  await db
    .update(botPosts)
    .set({ status: 'published', xPostId, publishedAt: new Date() })
    .where(eq(botPosts.id, id));
  logger.info({ postId: id, xPostId }, 'transition: scheduled → published');
}

/** any non-published → killed */
export async function killPost(id: number): Promise<void> {
  const p = await getPost(id);
  if (p.status === 'published') {
    throw new TransitionError(`cannot kill an already published post (id=${id}, x_post_id=${p.xPostId})`);
  }
  await db.update(botPosts).set({ status: 'killed' }).where(eq(botPosts.id, id));
  logger.info({ postId: id, prevStatus: p.status }, 'transition: → killed');
}
