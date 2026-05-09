/**
 * Re-genera caption + card de un bot_post draft con el código actual.
 * No toca source_snapshot — el dato source se preserva, solo cambian
 * la caption (LLM) y la imagen (render con tokens/layout actuales).
 *
 * Run: pnpm tsx scripts/regen-caption.ts <postId>
 * Run en VPS:
 *   ssh timba2027 "cd /home/timba/timba && set -a && . ./.env && set +a && \
 *     node_modules/.bin/tsx scripts/regen-caption.ts 17"
 */
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { botPosts } from '../src/db/schema.js';
import { generateCaption } from '../src/caption/generate.js';
import { renderToPng } from '../src/render/compose.js';
import { marketMoveCard } from '../src/render/cards/market-move.js';
import { hotNewsCard } from '../src/render/cards/hot-news.js';
import { env } from '../src/lib/env.js';
import { marketMoveEventSchema, hotNewsEventSchema } from '../src/trigger/types.js';

function nowStr(): string {
  return (
    new Date().toLocaleTimeString('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Argentina/Buenos_Aires',
    }) + ' GMT-3'
  );
}

const postId = Number(process.argv[2]);
if (!Number.isInteger(postId)) {
  console.error('Uso: pnpm tsx scripts/regen-caption.ts <postId>');
  process.exit(1);
}

async function main() {
  const [post] = await db.select().from(botPosts).where(eq(botPosts.id, postId));
  if (!post) {
    console.error(`Post ${postId} no encontrado.`);
    process.exit(1);
  }
  if (post.status !== 'draft') {
    console.error(`Post ${postId} status es '${post.status}' — solo regenero drafts.`);
    process.exit(1);
  }

  console.log('Caption anterior:');
  console.log('---');
  console.log(post.caption);
  console.log('---');

  const data = post.sourceSnapshot as Record<string, unknown>;
  const cap = await generateCaption({ shape: post.shape, data });

  // Para hot_news preservamos el link al final (es independiente del LLM)
  const captionWithUrl =
    post.shape === 'hot_news' && (data.url as string | undefined)
      ? `${cap.caption.trimEnd()}\n\n${data.url as string}`
      : cap.caption;

  console.log('Caption nueva:');
  console.log('---');
  console.log(captionWithUrl);
  console.log('---');

  // Re-renderizar la card con los tokens/layout actuales
  let cardPath = post.cardPath;
  const handle = env.BOT_HANDLE;
  if (post.shape === 'market_move') {
    const event = marketMoveEventSchema.parse((data as { event: unknown }).event);
    const card = marketMoveCard({ event, timestamp: nowStr(), handle });
    const filename = `event-${post.eventId}-market-move`;
    const { relPath } = await renderToPng(card, filename);
    cardPath = relPath;
    console.log('Card re-renderizada:', relPath);
  } else if (post.shape === 'hot_news') {
    const ev = hotNewsEventSchema.parse(data);
    const card = hotNewsCard({
      source: ev.source,
      headline: ev.headline,
      candidatesMentioned: ev.candidatesMentioned,
      correlatedMove: ev.correlatedMove,
      timestamp: nowStr(),
      handle,
    });
    const filename = `event-${post.eventId}-hot-news`;
    const { relPath } = await renderToPng(card, filename);
    cardPath = relPath;
    console.log('Card re-renderizada:', relPath);
  }

  await db
    .update(botPosts)
    .set({
      caption: captionWithUrl,
      cardPath,
      llmMetadata: {
        source: cap.source,
        attempts: cap.attempts,
        lintViolations: cap.lintViolations,
        rawOutputs: cap.rawOutputs,
        regenerated_at: new Date().toISOString(),
      },
    })
    .where(eq(botPosts.id, postId));

  console.log(`Post ${postId} actualizado.`);
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
