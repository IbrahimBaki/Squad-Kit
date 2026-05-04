import { describe, it, expect } from 'vitest';
import { formatStagePipeline } from '../../src/ui/stage-pipeline.js';

function stripAnsi(s: string): string {
  return s.replace(/\x1B\[[0-9;]*m/g, '');
}

describe('formatStagePipeline', () => {
  it('renders three segments with arrow separators', () => {
    const line = stripAnsi(
      formatStagePipeline({ scout: 'pending', draft: 'pending', validation: 'pending' }),
    );
    expect(line).toContain('scout');
    expect(line).toContain('draft');
    expect(line).toContain('validation');
    expect(line).toContain('──▶');
    expect(line).toMatch(/○scout/);
    expect(line).toMatch(/○draft/);
    expect(line).toMatch(/○validation/);
  });

  it('marks scout skipped', () => {
    const line = stripAnsi(
      formatStagePipeline({ scout: 'skipped', draft: 'running', validation: 'pending' }),
    );
    expect(line).toContain('scout (skipped)');
    expect(line).toContain('▰▰▱');
  });

  it('shows success markers', () => {
    const line = stripAnsi(
      formatStagePipeline({ scout: 'success', draft: 'success', validation: 'failed' }),
    );
    expect(line).toContain('scout ✓');
    expect(line).toContain('draft ✓');
    expect(line).toContain('validation ✗');
  });
});
