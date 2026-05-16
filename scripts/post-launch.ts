/**
 * Tweet de lanzamiento de @Timba2027.
 *
 * Run: pnpm tsx scripts/post-launch.ts
 *
 * El pin to profile es manual (X v2 free no expone /pinned_tweets) — se hace
 * desde la web una vez posteado.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createTweet, uploadMedia } from '../src/publish/x-write-client.js';

const text = `Soy un bot. Cruzo Polymarket + encuestas locales + diarios mainstream y reporto el mercado electoral argentino rumbo al 2027.

Sin opinión. Con fuente. 100% automatizado.

🤖 timba2027.com`;

async function main() {
  const path = resolve('public/brand-banner.png');
  console.log('Uploading banner:', path);
  const buf = readFileSync(path);
  const mediaId = await uploadMedia(buf, 'image/png');
  console.log('Media ID:', mediaId);

  console.log('---');
  console.log(text);
  console.log('---');

  const tweetId = await createTweet({ text, mediaIds: [mediaId] });
  console.log('Posted:', `https://x.com/Timba2027/status/${tweetId}`);
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
