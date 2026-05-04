import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Badge } from '~/components/Badge';
import { api } from '~/api/client';
import type { ApiRunRecord } from '~/api/types';

export function RecentRunsDrawer() {
  const q = useQuery({
    queryKey: ['runs', 'recent'],
    queryFn: () => api<ApiRunRecord[]>('/api/runs'),
    staleTime: 5000,
  });

  const list = [...(q.data ?? [])].slice(0, 20);

  return (
    <aside data-testid="recent-runs-drawer" className="sticky top-20 hidden shrink-0 self-start lg:block lg:w-72 xl:w-[20rem]">
      <div className="max-h-[calc(100vh-140px)] overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--gray-2)] p-2">
        <h2 className="px-2 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
          Recent runs
        </h2>
        {!q.data && q.isFetching ? (
          <p className="px-2 text-[12px] text-[var(--color-text-muted)]">Loading…</p>
        ) : null}
        {q.error ? (
          <p className="px-2 text-[12px] text-[var(--color-fail)]">Could not load runs.</p>
        ) : null}
        <ul className="space-y-1">
          {list.map((r) => (
            <li key={r.runId}>
              <Link
                to={'/runs/$runId'}
                params={{ runId: r.runId }}
                search={{ tab: 'plan' }}
                className="block rounded-lg px-2 py-2 text-[12px] hover:bg-[var(--gray-3)]"
                data-run-id={r.runId}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-mono text-[11px] text-[var(--color-text)]">{r.feature}/{r.storyId}</span>
                  <Badge
                    tone={
                      r.success ?
                        'success'
                      : r.partial ?
                        'warning'
                      : 'danger'}
                    className="shrink-0"
                  >
                    {r.partial ? 'partial' : r.success ? 'ok' : 'fail'}
                  </Badge>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[10px] text-[var(--color-text-muted)]">
                  <span className="tabular">{new Date(r.startedAt).toLocaleString()}</span>
                  <span className="tabular">{Math.round(r.durationMs / 1000)}s</span>
                </div>
                <span className="mt-1 inline-block truncate font-mono text-[10px] text-[var(--color-text-muted)]">
                  {r.model}
                  {r.planFile ? ` · ${r.planFile}` : ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
