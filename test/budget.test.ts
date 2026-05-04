import { describe, it, expect, vi, afterEach } from 'vitest';
import { Budget } from '../src/planner/budget.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Budget', () => {
  it('canRead is false when maxFileReads reached', () => {
    const b = new Budget({
      maxFileReads: 1,
      maxContextBytes: 100_000,
      maxDurationSeconds: 60,
    });
    expect(b.canRead(10)).toEqual({ ok: true });
    b.recordRead(10);
    expect(b.canRead(10)).toEqual({ ok: false, reason: 'max file reads (1) reached' });
  });

  it('canRead is false when maxContextBytes would be exceeded', () => {
    const b = new Budget({
      maxFileReads: 10,
      maxContextBytes: 100,
      maxDurationSeconds: 60,
    });
    expect(b.canRead(50)).toEqual({ ok: true });
    b.recordRead(50);
    expect(b.canRead(51)).toEqual({
      ok: false,
      reason: 'context budget (100 bytes) would be exceeded',
    });
  });

  it('recordRead increments reads and bytes', () => {
    const b = new Budget({
      maxFileReads: 10,
      maxContextBytes: 1000,
      maxDurationSeconds: 60,
    });
    b.recordRead(100);
    b.recordRead(50);
    const s = b.snapshot();
    expect(s.reads).toBe(2);
    expect(s.bytes).toBe(150);
  });

  it('timedOut reflects maxDurationSeconds', () => {
    const start = 1_000_000;
    const spy = vi.spyOn(Date, 'now');
    spy.mockReturnValue(start);
    const b = new Budget({
      maxFileReads: 10,
      maxContextBytes: 1000,
      maxDurationSeconds: 2,
    });
    spy.mockReturnValue(start + 2_500);
    expect(b.timedOut()).toBe(true);
  });

  it('canExecuteTool gates on read count without tool-name split', () => {
    const b = new Budget({
      maxFileReads: 1,
      maxContextBytes: 100_000,
      maxDurationSeconds: 60,
    });
    expect(b.canExecuteTool().ok).toBe(true);
    b.recordRead(100);
    expect(b.canExecuteTool().ok).toBe(false);
  });

  it('extendSession adds another slice of read and byte limits', () => {
    const b = new Budget({
      maxFileReads: 1,
      maxContextBytes: 100,
      maxDurationSeconds: 60,
    });
    b.recordRead(100);
    expect(b.canRead(1).ok).toBe(false);
    b.extendSession();
    expect(b.canRead(1).ok).toBe(true);
  });

  it('recordUsage accepts extended usage with cache token fields', () => {
    const b = new Budget({
      maxFileReads: 10,
      maxContextBytes: 1000,
      maxDurationSeconds: 60,
    });
    expect(() =>
      b.recordUsage({ inputTokens: 1, outputTokens: 1, cacheReadTokens: 100 }),
    ).not.toThrow();
    const s = b.snapshot();
    expect(s.usage.inputTokens).toBe(1);
    expect(s.usage.outputTokens).toBe(1);
  });
});
