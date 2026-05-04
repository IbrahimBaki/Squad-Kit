import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { RateLimitRing } from '~/components/generate/RateLimitRing';

function renderRing() {
  const root = createRootRoute({ component: () => <Outlet /> });
  const index = createRoute({
    getParentRoute: () => root,
    path: '/rl',
    component: () => (
      <RateLimitRing
        rateLimit={{
          provider: 'anthropic',
          retryAfterSec: 5,
          capSec: 90,
          phase: 'aborted',
          receivedAtMs: Date.now(),
          rawBody: '429',
        }}
        onRerun={() => {}}
        onCancel={() => {}}
      />
    ),
  });

  const history = createMemoryHistory({ initialEntries: ['/rl'] });
  const router = createRouter({
    routeTree: root.addChildren([index]),
    history,
  });
  return render(<RouterProvider router={router} />);
}

describe('RateLimitRing', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => {
    vi.useRealTimers();
  });

  it('disables rerun while retry countdown > 0', async () => {
    vi.setSystemTime(new Date('2024-06-01T10:00:00.000Z'));
    renderRing();

    expect(await screen.findByTestId('rate-limit-rerun')).toBeDisabled();

    vi.advanceTimersByTime(6_500);

    await waitFor(() => expect(screen.getByTestId('rate-limit-rerun')).not.toBeDisabled());
    expect(screen.getByTestId('rate-limit-rerun')).toHaveTextContent('Rerun planner');
  });
});
