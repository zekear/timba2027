import { db } from '../../db/client.js';
import { polls } from '../../db/schema.js';
import { logger } from '../../lib/logger.js';
import { mightBePoll } from './filter.js';
import { classifyTweet } from './classifier.js';
import { extractPollFromImage } from './extractor.js';
import { fetchMediaBinary, type XMedia, type XTweet } from './x-client.js';

export interface ProcessTweetResult {
  status:
    | 'inserted'
    | 'skipped_filter'
    | 'skipped_classifier'
    | 'skipped_no_image'
    | 'skipped_extractor_failed'
    | 'skipped_sanity'
    | 'skipped_duplicate';
  reason?: string;
  pollId?: number;
}

interface ProcessOpts {
  pollsterDbId: number;
  tweet: XTweet;
  attachedMedia: XMedia[];
}

export async function processTweet(opts: ProcessOpts): Promise<ProcessTweetResult> {
  const { pollsterDbId, tweet, attachedMedia } = opts;
  const hasImage = attachedMedia.some((m) => m.type === 'photo' && m.url);

  // 1. Filtro grueso (cheap, sin LLM)
  if (!mightBePoll(tweet.text, { hasMedia: hasImage })) {
    return { status: 'skipped_filter' };
  }

  // 2. Sin imagen no podemos extraer estructura confiable — descartamos
  const photo = attachedMedia.find((m) => m.type === 'photo' && m.url);
  if (!photo?.url) {
    return { status: 'skipped_no_image' };
  }

  // 3. Fetch image binary
  let imageBuf: Buffer;
  try {
    imageBuf = await fetchMediaBinary(photo.url);
  } catch (err) {
    return { status: 'skipped_no_image', reason: `media fetch failed: ${(err as Error).message}` };
  }

  // 4. Classifier (Haiku, vision-aware)
  let classifierResult;
  try {
    classifierResult = await classifyTweet(tweet.text, imageBuf);
  } catch (err) {
    logger.warn({ tweetId: tweet.id, err: (err as Error).message }, 'polls: classifier failed');
    return { status: 'skipped_classifier', reason: 'classifier_error' };
  }

  if (!classifierResult.is_poll) {
    return { status: 'skipped_classifier', reason: classifierResult.reason };
  }

  // 5. Extractor (Sonnet vision — caro)
  let extracted;
  try {
    extracted = await extractPollFromImage(imageBuf);
  } catch (err) {
    logger.warn({ tweetId: tweet.id, err: (err as Error).message }, 'polls: extractor failed');
    return { status: 'skipped_extractor_failed', reason: (err as Error).message };
  }

  // 6. Sanity checks: suma <=105% (margen para indecisos), sample > 200 si está
  const sumPct = extracted.results.reduce((s, r) => s + r.pct, 0);
  if (sumPct > 105) {
    logger.warn({ tweetId: tweet.id, sumPct }, 'polls: sanity failed (sum > 105)');
    return { status: 'skipped_sanity', reason: `sum_pct=${sumPct}` };
  }
  if (extracted.sample_size != null && extracted.sample_size < 200) {
    logger.warn({ tweetId: tweet.id, sampleSize: extracted.sample_size }, 'polls: sanity failed (sample too small)');
    return { status: 'skipped_sanity', reason: `sample_size=${extracted.sample_size}` };
  }

  // 7. Confidence final desde classifier
  const confidence = classifierResult.confidence;

  // 8. Insert con upsert por source_tweet_id (idempotencia)
  try {
    const inserted = await db
      .insert(polls)
      .values({
        pollsterId: pollsterDbId,
        sourceUrl: `https://x.com/i/status/${tweet.id}`,
        sourceTweetId: tweet.id,
        fechaCampo: extracted.fecha_campo ? new Date(extracted.fecha_campo) : null,
        sampleSize: extracted.sample_size,
        metodologia: extracted.metodologia,
        results: extracted.results,
        confidence,
        status: 'pending_review', // siempre review en fase 2
        rawClassifierOutput: JSON.stringify(classifierResult),
        rawExtractorOutput: JSON.stringify(extracted),
      })
      .onConflictDoNothing({ target: polls.sourceTweetId })
      .returning({ id: polls.id });

    if (inserted.length === 0) {
      return { status: 'skipped_duplicate' };
    }
    return { status: 'inserted', pollId: inserted[0].id };
  } catch (err) {
    logger.error({ tweetId: tweet.id, err: (err as Error).message }, 'polls: insert failed');
    throw err;
  }
}
