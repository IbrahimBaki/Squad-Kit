import { useEffect, useState } from 'react';
import type { BudgetState } from '~/hooks/useGenerateRun';

function meterColor(pct: number) {
  if (pct >= 90) return 'var(--color-fail)';
  if (pct >= 70) return 'var(--color-pressure)';
  return 'var(--gray-10)';
}

export function BudgetMeters({
  budget,
  startedAtMs,
  replayWallSec,
}: {
  budget: BudgetState;
  startedAtMs: number | null;
  /** Replay mode: freeze wall-clock meter at completed duration (seconds). */
  replayWallSec?: number | null;
}) {
  const [, pulse] = useState(0);
  useEffect(() => {
    if (replayWallSec != null) return;
    if (startedAtMs == null) return;
    const id = window.setInterval(() => pulse((n) => n + 1), 900);
    return () => window.clearInterval(id);
  }, [startedAtMs, replayWallSec]);
  const caps = budget.caps;
  if (!caps)
    return (
      <p data-testid="budget-meters-placeholder" className="mb-4 text-xs text-[var(--color-text-muted)]">
        Budget caps arrive with runtime telemetry…
      </p>
    );

  const elapsedSec =
    replayWallSec != null
      ? Math.max(0, replayWallSec)
      : startedAtMs != null
        ? Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000))
        : 0;
  const readsPct = caps.maxFileReads > 0 ? (budget.fileReadsCompleted / caps.maxFileReads) * 100 : 0;
  const ctxPct = caps.maxContextBytes > 0 ? (budget.contextBytesApprox / caps.maxContextBytes) * 100 : 0;
  const wallPct = caps.maxDurationSeconds > 0 ? (elapsedSec / caps.maxDurationSeconds) * 100 : 0;

  return (
    <div data-testid="budget-meters" className="mb-4 grid gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--gray-2)] p-3 text-xs">
      <Row
        label="File reads"
        barPct={Math.min(100, readsPct)}
        title={`${budget.fileReadsCompleted} / ${caps.maxFileReads}`}
      />
      <Row
        label="Context (approx)"
        barPct={Math.min(100, ctxPct)}
        title={`${Math.round(budget.contextBytesApprox / 1024)} KB / ${Math.round(caps.maxContextBytes / 1024)} KB cap`}
      />
      <Row label="Wall clock" barPct={Math.min(100, wallPct)} title={`${elapsedSec}s / ${caps.maxDurationSeconds}s`} />
    </div>
  );
}

function Row({ label, barPct, title }: { label: string; barPct: number; title: string }) {
  return (
    <div title={title}>
      <div className="mb-0.5 flex justify-between text-[var(--color-text-muted)]">
        <span>{label}</span>
        <span className="tabular">{Math.round(barPct)}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--gray-5)]">
        <div
          className="h-full rounded-full transition-[width] duration-300"
          style={{ width: `${barPct}%`, background: meterColor(barPct) }}
        />
      </div>
    </div>
  );
}
