/**
 * Smoke test del publisher OAuth 1.0a contra X API v2.
 *
 * Run (texto solo):       pnpm tsx scripts/test-x-publish.ts
 * Run (con imagen brand): pnpm tsx scripts/test-x-publish.ts --with-image
 *
 * IMPORTANTE: postea de verdad. Si no querés un tweet de prueba en producción
 * borrá el tweet manual desde la cuenta una vez confirmado.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createTweet, uploadMedia } from '../src/publish/x-write-client.js';

const withImage = process.argv.includes('--with-image');
const text = `🧪 smoke test ${new Date().toISOString().slice(0, 19)}`;

async function main() {
  const mediaIds: string[] = [];
  if (withImage) {
    const path = resolve('storage/cards/brand-logo.png');
    console.log('Uploading', path);
    const buf = readFileSync(path);
    const id = await uploadMedia(buf, 'image/png');
    console.log('Media ID:', id);
    mediaIds.push(id);
  }

  console.log('Creating tweet:', text);
  const tweetId = await createTweet({ text, mediaIds });
  console.log('Tweet posted:', `https://x.com/i/web/status/${tweetId}`);
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
