import { describe, it, expect } from 'vitest';
import { formatBudgetMeter } from '../../src/ui/budget-meter.js';

function stripAnsi(s: string): string {
  return s.replace(/\x1B\[[0-9;]*m/g, '');
}

describe('formatBudgetMeter', () => {
  it('uses neutral styling below 70% on every segment', () => {
    const plain = stripAnsi(
      formatBudgetMeter({
        reads: 10,
        readsCap: 25,
        bytes: 20_000,
        bytesCap: 50_000,
        elapsedMs: 50_000,
        durationMsCap: 180_000,
      }),
    );
    expect(plain).toBe('reads 10/25 · ctx 20/49 KB · time 50/180s');
  });

  it('uses ≥70% ratios on reads and wall clock (amber/red may be no-ops when colors are off)', () => {
    const plain = stripAnsi(
      formatBudgetMeter({
        reads: 18,
        readsCap: 25,
        bytes: 700_000,
        bytesCap: 1_000_000,
        elapsedMs: 126_000,
        durationMsCap: 180_000,
      }),
    );
    expect(plain).toContain('reads 18/25');
    expect(plain).toContain('ctx 684/977 KB');
    expect(plain).toContain('time 126/180s');
  });

  it('uses ≥90% read ratio', () => {
    const plain = stripAnsi(
      formatBudgetMeter({
        reads: 24,
        readsCap: 25,
        bytes: 0,
        bytesCap: 1_000_000,
        elapsedMs: 1,
        durationMsCap: 180_000,
      }),
    );
    expect(plain).toContain('reads 24/25');
  });

  it('formats elapsed seconds against cap', () => {
    const plain = stripAnsi(
      formatBudgetMeter({
        reads: 0,
        readsCap: 25,
        bytes: 0,
        bytesCap: 50_000,
        elapsedMs: 142_000,
        durationMsCap: 180_000,
      }),
    );
    expect(plain).toContain('time 142/180s');
  });
});
