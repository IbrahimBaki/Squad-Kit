import { Cpu, Loader2 } from 'lucide-react';
import { Badge } from '~/components/Badge';
import { Button } from '~/components/Button';
import { CacheHitRing } from '~/components/charts/CacheHitRing';
import { Spinner } from '~/components/Spinner';
import type { GenerateRunState } from '~/hooks/useGenerateRun';

function statusFromPhase(phase: GenerateRunState['phase']) {
  if (phase === 'idle') return { label: 'idle', tone: 'default' as const };
  if (phase === 'starting' || phase === 'streaming' || phase === 'cancelling')
    return { label: 'running', tone: 'info' as const };
  if (phase === 'done') return { label: 'succeeded', tone: 'success' as const };
  if (phase === 'cancelled') return { label: 'cancelled', tone: 'warning' as const };
  return { label: 'failed', tone: 'danger' as const };
}

function phaseSpinner(phase: GenerateRunState['phase']) {
  if (phase === 'cancelling') return <Loader2 className="h-4 w-4 animate-spin text-[var(--color-info)]" />;
  return null;
}

export function MetricsBar({
  state,
  elapsedSec,
  onCancel = () => {},
  cancelDisabled,
  frozen,
}: {
  state: GenerateRunState;
  elapsedSec: number;
  onCancel?: () => void;
  cancelDisabled?: boolean;
  /** Replay / read-only — no cancel, replay badge. */
  frozen?: boolean;
}) {
  const status = statusFromPhase(state.phase);
  const sum = state.tokens.sum;
  const ceil = Math.max(8000, sum * 1.15);
  const over = Math.max(0, sum - ceil);
  const inPct = ceil > 0 ? Math.min(100, Math.round((state.tokens.input / ceil) * 100)) : 0;
  const outPct = ceil > 0 ? Math.min(100, Math.round((state.tokens.output / ceil) * 100)) : 0;

  const showCancel =
    !frozen &&
    (state.phase === 'streaming' || state.phase === 'starting' || state.phase === 'cancelling');

  const multitabNote = state.multiTab.count > 0;

  const cacheRatio = state.cacheHitPct != null ? state.cacheHitPct / 100 : 0;

  return (
    <div
      data-testid="generate-metrics-bar"
      className="sticky z-[var(--z-sticky)] -mx-[1px] mb-4 border-y border-[var(--color-border)] bg-[var(--color-bg-elevated)]/95 px-3 py-2 backdrop-blur sm:px-4"
    >
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3">
        <div className="inline-flex items-center gap-2">
          {frozen ? (
            <Badge tone="info" title="Hydrated from saved events">
              replay
            </Badge>
          ) : null}
          {status.label === 'running' ? (
            phaseSpinner(state.phase) ?? <Spinner size="sm" aria-hidden />
          ) : null}
          <Badge tone={status.tone} dot={!frozen && status.label === 'running'}>
            {status.label === 'running' && state.phase === 'cancelling' ? 'cancelling' : status.label}
          </Badge>
        </div>

        <span className="text-xs tabular text-[var(--color-text-muted)]">{elapsedSec}s elapsed</span>
        <span className="hidden text-xs text-[var(--color-text-muted)] sm:inline">· turn {state.turn}</span>

        <div className="flex shrink-0 items-center gap-1 text-[11px] text-[var(--color-text-muted)]">
          <span className="max-w-[180px] truncate font-mono sm:max-w-[260px]" title={state.runtime?.model}>
            {state.runtime?.model ?? 'model…'}
          </span>
        </div>

        <div className="flex min-w-[180px] flex-1 basis-[260px] items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-0.5 flex justify-between text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
              <span>input</span>
              <span className="tabular text-[var(--color-inflight)]">{state.tokens.input}</span>
            </div>
            <div className="squad-inflight squad-inflight--reduce h-1.5 overflow-hidden rounded-full bg-[var(--gray-5)]">
              <div
                className="h-full rounded-full bg-[var(--color-inflight)] transition-[width] duration-300"
                style={{ width: `${inPct}%`, opacity: 0.92 }}
              />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-0.5 flex justify-between text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
              <span>output</span>
              <span className="tabular text-[var(--color-inflight)]">{state.tokens.output}</span>
            </div>
            <div className="squad-inflight squad-inflight--reduce h-1.5 overflow-hidden rounded-full bg-[var(--gray-5)]">
              <div
                className="h-full rounded-full bg-[var(--color-inflight)] transition-[width] duration-300"
                style={{ width: `${outPct}%`, opacity: 0.92 }}
              />
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div style={{ transform: 'scale(0.38)', transformOrigin: 'center' }} aria-hidden className="-m-14">
            {state.cacheHitPct != null ? (
              <CacheHitRing ratio={cacheRatio} />
            ) : (
              <div
                style={{ width: 140, height: 140 }}
                className="rounded-full border-2 border-dashed border-[var(--gray-6)] opacity-80"
              />
            )}
          </div>
          {multitabNote ? (
            <Badge tone="info" data-testid="multi-tab-badge" title="Other browser tabs streaming this same run">
              <Cpu size={12} aria-hidden className="-mt-px" />+{state.multiTab.count}
            </Badge>
          ) : null}
        </div>

        {over > 0 ? (
          <span className="text-[11px] text-[var(--color-warn)]">
            +{Math.round(over / 1000)}k tokens over plan meter
          </span>
        ) : null}

        {showCancel ? (
          <Button
            type="button"
            variant="danger"
            className="ml-auto"
            disabled={cancelDisabled}
            onClick={() => onCancel()}
          >
            Cancel run
          </Button>
        ) : null}
      </div>
    </div>
  );
}
