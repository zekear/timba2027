import { describe, it, expect, vi, beforeEach } from 'vitest';
import { classifyTweet } from '../../../src/sources/polls/classifier.js';

vi.mock('../../../src/llm/index.js', () => ({
  llm: {
    classify: vi.fn(),
    extractFromImage: vi.fn(),
    generateText: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('classifyTweet', () => {
  it('returns parsed result for clean JSON output', async () => {
    const { llm } = await import('../../../src/llm/index.js');
    (llm.classify as any).mockResolvedValue('{"is_poll": true, "confidence": "alto", "reason": "Tabla con porcentajes claros"}');
    const result = await classifyTweet('Encuesta Opinaia: Milei 45, Kicillof 28');
    expect(result.is_poll).toBe(true);
    expect(result.confidence).toBe('alto');
  });

  it('uses extractFromImage when image is provided', async () => {
    const { llm } = await import('../../../src/llm/index.js');
    (llm.extractFromImage as any).mockResolvedValue('{"is_poll": false, "confidence": "alto", "reason": "Foto de almuerzo"}');
    const result = await classifyTweet('Hoy almorcé pizza', Buffer.from('fakeimg'));
    expect(result.is_poll).toBe(false);
    expect(llm.extractFromImage).toHaveBeenCalledTimes(1);
    expect(llm.classify).not.toHaveBeenCalled();
  });

  it('throws when LLM output has no JSON', async () => {
    const { llm } = await import('../../../src/llm/index.js');
    (llm.classify as any).mockResolvedValue('No tengo idea, lo siento.');
    await expect(classifyTweet('texto')).rejects.toThrow(/no json/i);
  });
});
