import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  Outlet,
} from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RecentRunsDrawer } from '~/components/generate/RecentRunsDrawer';
import type { ApiRunRecord } from '~/api/types';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('~/api/client', () => ({
  api: apiMock,
  UnauthorizedError: class E extends Error {
    name = 'UnauthorizedError';
  },
}));

describe('RecentRunsDrawer', () => {
  beforeEach(() => apiMock.mockReset());

  function renderDrawer() {
    const rootRoute = createRootRoute({
      component: () => <Outlet />,
    });

    const index = createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: () => <RecentRunsDrawer />,
    });

    const runRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/runs/$runId',
      component: () => <span>replay</span>,
    });

    const history = createMemoryHistory({ initialEntries: ['/'] });
    const router = createRouter({
      routeTree: rootRoute.addChildren([index, runRoute]),
      history,
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return {
      router,
      ...render(
        <QueryClientProvider client={qc}>
          <RouterProvider router={router} />
        </QueryClientProvider>,
      ),
    };
  }

  it('lists twenty runs from /api/runs', async () => {
    const rows: ApiRunRecord[] = [];
    for (let i = 0; i < 25; i += 1) {
      rows.push({
        runId: `rid-${i}`,
        provider: 'anthropic',
        model: `m-${i}`,
        feature: 'demo',
        storyId: `s-${i}`,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        success: true,
        partial: false,
        planFile: 'x.md',
        durationMs: 1000 + i,
        version: 1,
      });
    }

    apiMock.mockResolvedValue(rows);
    const { router } = renderDrawer();

    const links = await screen.findAllByRole('link');
    expect(links).toHaveLength(20);

    fireEvent.click(links[0]!);

    await waitFor(() =>
      expect(router.state.location.pathname).toContain('/runs/'),
    );

    apiMock.mockReset();
  });
});
