import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ActivityFeed } from '~/components/generate/ActivityFeed';

describe('ActivityFeed', () => {
  it('shows thinking expandable body', async () => {
    render(
      <ActivityFeed
        rows={[
          {
            type: 'thinking',
            id: '1',
            stage: 'draft',
            thinkingKey: '0-0',
            turn: 0,
            blockIndex: 0,
            text: 'secret reasoning',
            rowState: 'done',
            chars: 16,
            durationMs: 2000,
            summaryOnly: false,
          },
        ]}
      />,
    );
    const btn = screen.getByRole('button', { name: /Thinking/i });
    fireEvent.click(btn);
    expect(await screen.findByText('secret reasoning')).toBeTruthy();
  });
});
