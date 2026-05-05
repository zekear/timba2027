import { describe, it, expect } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { Ribbon } from '../../src/render/components/Ribbon.js';
import { Footer } from '../../src/render/components/Footer.js';
import { frame, renderToPng } from '../../src/render/compose.js';

describe('renderToPng', () => {
  it('produces a non-empty PNG file from a minimal card', async () => {
    const card = frame([
      Ribbon('TEST RENDER'),
      {
        type: 'div',
        props: {
          style: { flex: 1, padding: 48, fontSize: 64, fontFamily: 'PlayfairDisplay' },
          children: 'Smoke test',
        },
      },
      Footer('00:00 GMT-3', 'TEST', '@politica'),
    ]);

    const { absPath, relPath } = await renderToPng(card, 'test-smoke');
    expect(existsSync(absPath)).toBe(true);
    expect(statSync(absPath).size).toBeGreaterThan(1000);
    expect(relPath).toBe('storage/cards/test-smoke.png');
  }, 30_000);
});
