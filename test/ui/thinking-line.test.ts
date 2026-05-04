import { describe, it, expect } from 'vitest';
import { formatThinkingLine } from '../../src/ui/thinking-line.js';

function stripAnsi(s: string): string {
  return s.replace(/\x1B\[[0-9;]*m/g, '');
}

describe('formatThinkingLine', () => {
  it('uses thinking… while running', () => {
    const line = stripAnsi(formatThinkingLine({ running: true, durationMs: 12_400, chars: 1240 }));
    expect(line).toBe('thinking… 12s · 1240 chars');
  });

  it('uses thought when stopped', () => {
    const line = stripAnsi(formatThinkingLine({ running: false, durationMs: 18_200, chars: 2480 }));
    expect(line).toBe('thought 18s · 2480 chars');
  });
});
