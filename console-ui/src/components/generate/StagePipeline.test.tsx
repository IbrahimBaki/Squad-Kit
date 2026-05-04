import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StagePipeline } from '~/components/generate/StagePipeline';

describe('StagePipeline', () => {
  it('runs onJump when a node clicked', () => {
    const onJump = vi.fn();
    render(
      <StagePipeline
        onJump={onJump}
        stages={{
          scout: { phase: 'success' },
          draft: { phase: 'running' },
          validation: { phase: 'idle' },
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /scout stage/i }));
    expect(onJump).toHaveBeenCalledWith('scout');
  });
});
