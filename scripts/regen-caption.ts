/**
 * Re-genera la caption de un bot_post existente con el prompt actual.
 * Mantiene el source_snapshot, card_path, etc — solo cambia caption + llm_metadata.
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

  await db
    .update(botPosts)
    .set({
      caption: captionWithUrl,
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
