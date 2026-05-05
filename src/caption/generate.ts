import { llm } from '../llm/index.js';
import { logger } from '../lib/logger.js';
import { captionPrompt, type CaptionContext } from './prompts.js';
import { collectNumbers, lintCaption } from './linter.js';
import { fallbackCaption } from './fallback.js';

export interface GenerateResult {
  caption: string;
  source: 'llm' | 'fallback';
  attempts: number;
  rawOutputs: string[];
  lintViolations: string[][];
}

const MAX_ATTEMPTS = 2;

export async function generateCaption(ctx: CaptionContext): Promise<GenerateResult> {
  const allowedNumbers = collectNumbers(ctx.data);
  const allowed = { numbers: allowedNumbers };
  const prompt = captionPrompt(ctx);

  const rawOutputs: string[] = [];
  const lintViolations: string[][] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let raw: string;
    try {
      raw = await llm.classify(prompt, { model: 'haiku' });
    } catch (err) {
      logger.warn({ err: (err as Error).message, attempt }, 'caption: llm error');
      continue;
    }
    rawOutputs.push(raw);
    const cleaned = raw.trim().replace(/^["']|["']$/g, '');
    const lint = lintCaption(cleaned, allowed);
    if (lint.ok) {
      return { caption: cleaned, source: 'llm', attempts: attempt, rawOutputs, lintViolations };
    }
    lintViolations.push(lint.violations);
    logger.warn({ attempt, violations: lint.violations }, 'caption: lint failed, retrying');
  }

  const fb = fallbackCaption(ctx.shape, ctx.data);
  return { caption: fb, source: 'fallback', attempts: MAX_ATTEMPTS, rawOutputs, lintViolations };
}
