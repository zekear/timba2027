import { describe, it, expect } from 'vitest';
import { policyForMode, type PublishMode } from '../../src/publish/modes.js';

describe('policyForMode', () => {
  it('shadow mode disables publication entirely', () => {
    const p = policyForMode('shadow');
    expect(p.canPublish(new Date())).toBe(false);
    expect(p.dailyCap).toBe(6);
  });

  it('soft mode allows publication only between 9 and 22 ARG', () => {
    const p = policyForMode('soft');
    const t10am = new Date('2026-05-04T10:00:00-03:00');
    const t1am = new Date('2026-05-04T01:00:00-03:00');
    const t11pm = new Date('2026-05-04T23:00:00-03:00');
    expect(p.canPublish(t10am)).toBe(true);
    expect(p.canPublish(t1am)).toBe(false);
    expect(p.canPublish(t11pm)).toBe(false);
    expect(p.dailyCap).toBe(3);
  });

  it('full mode allows publication 24/7 (excepto quiet hours del orchestrator)', () => {
    const p = policyForMode('full');
    expect(p.canPublish(new Date('2026-05-04T15:00:00-03:00'))).toBe(true);
    expect(p.dailyCap).toBe(6);
  });
});
