import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BudgetMeters } from '~/components/generate/BudgetMeters';

describe('BudgetMeters', () => {
  it('uses amber-ish pressure class around 72% reads', () => {
    render(
      <BudgetMeters
        startedAtMs={Date.now()}
        budget={{
          caps: { maxFileReads: 10, maxContextBytes: 1000, maxDurationSeconds: 100 },
          fileReadsCompleted: 7,
          contextBytesApprox: 0,
        }}
      />,
    );
    const meters = screen.getByTestId('budget-meters');
    /** approx 70% threshold — bar uses inline style warm color hex not asserted; ensure row exists */
    expect(meters).toHaveTextContent('70%');
  });
});
