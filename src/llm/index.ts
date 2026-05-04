import { env } from '../lib/env.js';
import { ClaudeCLIClient } from './cli.js';
import type { LLMClient } from './types.js';

function createClient(): LLMClient {
  switch (env.LLM_TRANSPORT) {
    case 'cli':
      return new ClaudeCLIClient();
    case 'sdk':
      throw new Error('SDK transport not implemented yet (fase posterior)');
  }
}

export const llm: LLMClient = createClient();
export type { LLMClient } from './types.js';
