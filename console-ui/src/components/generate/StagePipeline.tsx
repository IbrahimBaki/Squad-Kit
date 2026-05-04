import { Fragment, type JSX } from 'react';
import { type StageKey, type StagesState } from '~/hooks/useGenerateRun';

function connectorDone(ph: StagesState[StageKey]['phase']) {
  return ph === 'success' || ph === 'failed' || ph === 'skipped';
}

export function StagePipeline({
  stages,
  onJump,
}: {
  stages: StagesState;
  onJump: (s: StageKey) => void;
}) {
  const order: StageKey[] = ['scout', 'draft', 'validation'];
  const label: Record<StageKey, string> = { scout: 'Scout', draft: 'Draft', validation: 'Validation' };

  const nodeClass = (ph: StagesState[StageKey]['phase']): string => {
    const base =
      'relative flex flex-1 items-center justify-center rounded-lg border px-2 py-3 text-[11px] font-semibold uppercase tracking-wide cursor-pointer overflow-hidden transition-colors focus-visible:ring-2';
    if (ph === 'running') return `${base} squad-node-running border-[var(--color-inflight)] text-[var(--color-text)]`;
    if (ph === 'success')
      return `${base} bg-[rgba(34,197,94,0.07)] border-[var(--color-ok-border)] text-[var(--color-ok)]`;
    if (ph === 'failed')
      return `${base} bg-[rgba(239,68,68,0.07)] border-[var(--color-fail-border)] text-[var(--color-fail)]`;
    if (ph === 'skipped')
      return `${base} squad-node-skipped border-[var(--color-border)] text-[var(--color-text-muted)]`;
    return `${base} border-[var(--color-border)] bg-[var(--gray-3)] text-[var(--color-text-muted)]`;
  };

  const lineClass = (a: StageKey, b: StageKey): string => {
    const d = connectorDone(stages[a].phase) && connectorDone(stages[b].phase);
    if (stages[b].phase === 'running') return 'flex-1 h-px bg-[var(--color-inflight)] opacity-70';
    if (d && stages[b].phase === 'success') return 'flex-1 h-px bg-[var(--color-ok)]';
    return 'flex-1 h-px bg-[var(--gray-6)]';
  };

  return (
    <div data-testid="stage-pipeline" className="mb-4 rounded-xl border border-[var(--color-border)] bg-[var(--gray-2)] p-3">
      <div className="flex items-center gap-1 md:gap-2">
        {order.map((k, ix) => {
          let conn: JSX.Element | null = null;
          if (ix < order.length - 1) {
            const n = order[ix + 1]!;
            conn = <div key={`conn-${k}`} role="presentation" className={lineClass(k, n)} />;
          }
          return (
            <Fragment key={k}>
              <button
                type="button"
                className={`${nodeClass(stages[k].phase)}`}
                aria-label={`${label[k]} stage`}
                onClick={() => onJump(k)}
              >
                {stages[k].phase === 'running' ? (
                  <span className="squad-stage-sweep squad-stage-sweep--reduce pointer-events-none absolute inset-0" />
                ) : null}
                <span className="relative z-[1]">{label[k]}</span>
              </button>
              {conn}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
