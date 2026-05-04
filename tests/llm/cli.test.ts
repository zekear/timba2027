import { describe, it, expect } from 'vitest';
import { ClaudeCLIClient } from '../../src/llm/cli.js';

describe('ClaudeCLIClient', () => {
  it('classify returns trimmed string output', async () => {
    const client = new ClaudeCLIClient();
    const result = await client.classify(
      'Respondé únicamente con la palabra "ok" (sin comillas, sin nada más).',
    );
    expect(result.toLowerCase()).toContain('ok');
  }, 60_000);

  it('generateText returns non-empty string', async () => {
    const client = new ClaudeCLIClient();
    const result = await client.generateText('Decí "hola" en una sola palabra.');
    expect(result.length).toBeGreaterThan(0);
  }, 60_000);
});
