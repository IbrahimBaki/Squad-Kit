import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  AlertCircle,
  BadgeCheck,
  Brain,
  Loader2,
  Search,
  Wrench,
} from 'lucide-react';
import type { ActivityFeedRow, StageKey } from '~/hooks/useGenerateRun';

const ROW_H = 52;

export function ActivityFeed({
  rows,
  jumpStage,
  replayed,
}: {
  rows: ActivityFeedRow[];
  jumpStage?: StageKey | null;
  replayed?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [virtMode, setVirtMode] = useState(false);
  const big = rows.length > 100;
  const virtu = big && virtMode;
  const [scrollTop, setScrollTop] = useState(0);
  const maxH = 420;

  useEffect(() => {
    if (replayed || !jumpStage || !rootRef.current) return;
    const sel = `[data-stage-marker="${jumpStage}"],[data-feed-stage="${jumpStage}"]`;
    const hit = rootRef.current.querySelector(sel);
    hit?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [jumpStage, rows, replayed]);

  const layout = useMemo(() => {
    if (!virtu) return { top: 0, items: rows, bot: 0 };
    const totalH = rows.length * ROW_H;
    const viewportRows = Math.ceil(maxH / ROW_H) + 6;
    const start = Math.max(0, Math.floor(scrollTop / ROW_H) - 3);
    const end = Math.min(rows.length, start + viewportRows);
    return { top: start * ROW_H, items: rows.slice(start, end), bot: totalH - end * ROW_H };
  }, [virtu, rows, scrollTop]);

  const rendered = virtu ? layout.items : rows;

  const hasTool = rows.some((r) => r.type === 'tool');

  let inner: JSX.Element | JSX.Element[];

  if (rows.length === 0) {
    inner = (
      <p className="px-3 py-6 text-center text-sm text-[var(--color-text-muted)]">
        Planner did not emit timeline events yet.
      </p>
    );
  } else if (!virtu && !hasTool && rows.length > 0) {
    inner = (
      <>
        <p className="mb-4 px-2 text-[12px] text-[var(--color-text-muted)]">
          Planner did not need any file reads.
        </p>
        {rendered.map((r) => (
          <ActivityRow key={r.id} row={r} replayed={replayed} />
        ))}
      </>
    );
  } else {
    inner = rendered.map((r) => <ActivityRow key={r.id} row={r} replayed={replayed} />);
  }

  return (
    <div data-testid="activity-feed" className="flex min-h-[280px] flex-col rounded-xl border border-[var(--color-border)] bg-[var(--gray-2)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
          Activity
        </span>
        {big ? (
          <button
            type="button"
            data-testid="activity-toggle-virt"
            className="rounded-md border border-[var(--color-border)] px-2 py-1 text-[10px] text-[var(--color-text-muted)] hover:bg-[var(--gray-3)]"
            onClick={() => {
              setVirtMode((v) => !v);
              setScrollTop(0);
            }}
          >
            {virtMode ? 'Show recent · compact' : 'Show all · virtual scroll'}
          </button>
        ) : null}
      </div>
      <div
        ref={rootRef}
        className="squad-scrollbar flex-1 overflow-y-auto px-2 py-2"
        style={{ maxHeight: maxH }}
        onScroll={(ev) => {
          if (!virtu) return;
          setScrollTop((ev.target as HTMLDivElement).scrollTop);
        }}
      >
        <div style={{ paddingTop: layout.top, paddingBottom: layout.bot }}>{inner}</div>
      </div>
    </div>
  );
}

function ActivityRow({ row, replayed }: { row: ActivityFeedRow; replayed?: boolean }) {
  if (row.type === 'stage_marker')
    return (
      <div
        data-stage-marker={row.stage}
        data-testid={`feed-stage-${row.stage}`}
        className="my-3 border-t border-dashed border-[var(--gray-7)] pt-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)] squad-row-enter squad-row-enter--reduce"
      >
        ▶ {row.stage}
      </div>
    );

  const feedStage = row.type === 'scout_decision' ? 'scout' : row.stage;

  const shell = (n: ReactElement) => (
    <div key={row.id} data-feed-stage={feedStage}>
      {n}
    </div>
  );

  if (row.type === 'scout_decision')
    return shell(
      <div className="squad-row-enter squad-row-enter--reduce mb-2 flex gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--gray-3)] p-2 text-[13px]">
        <Search size={18} className="mt-0.5 shrink-0 text-[var(--color-accent)]" />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-[var(--color-text)]">Scout selection</div>
          <pre className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-[var(--color-text-muted)]">
            {row.reasoning || row.selected.join('\n')}
          </pre>
        </div>
      </div>,
    );

  if (row.type === 'validation_issue')
    return shell(
      <div className="squad-row-enter squad-row-enter--reduce mb-2 flex gap-3 rounded-lg border border-[var(--color-warn-border)] bg-[var(--color-warn-bg)] p-2">
        <AlertCircle size={18} className="mt-0.5 shrink-0 text-[var(--color-warn)]" />
        <div className="min-w-0 text-[13px]">
          <div className="font-medium text-[var(--color-text)]">{row.issue.issueKind}</div>
          {row.issue.path ? (
            <div className="font-mono text-[11px] text-[var(--color-text-muted)]">{row.issue.path}</div>
          ) : null}
          <p className="text-[var(--color-text-muted)]">{row.issue.detail}</p>
        </div>
      </div>,
    );

  if (row.type === 'tool') return shell(<ToolRow row={row} />);
  if (row.type === 'thinking') return shell(<ThinkingRow row={row} replayed={replayed} />);
  return null;
}

function ToolRow({ row }: { row: Extract<ActivityFeedRow, { type: 'tool' }> }) {
  const inflight = row.rowState === 'running';
  const err = row.rowState === 'error';
  const path = row.path ?? row.name;
  const body = `${path}${row.bytesLoaded != null ? ` · ${Math.round(row.bytesLoaded / 1024)} KB` : ''}`;
  const time = row.durationMs != null ? `${Math.round(row.durationMs / 1000)}s` : inflight ? '…' : '—';

  return (
    <div
      className={`squad-row-enter squad-row-enter--reduce mb-2 flex gap-3 rounded-lg border p-2 ${
        err
          ? 'border-[var(--color-fail-border)] bg-[var(--color-fail-bg)]'
          : inflight
            ? 'squad-row-inflight border-[var(--color-inflight)]/35 bg-[var(--gray-4)]'
            : 'border-[var(--color-border)] bg-[var(--gray-3)] opacity-[0.92]'
      }`}
    >
      {inflight ? (
        <Loader2 className="mt-1 h-[18px] w-[18px] shrink-0 animate-spin text-[var(--color-inflight)]" />
      ) : err ? (
        <AlertCircle size={18} className="mt-1 shrink-0 text-[var(--color-fail)]" />
      ) : (
        <BadgeCheck size={18} className="mt-1 shrink-0 text-[var(--color-ok)]" />
      )}
      <div className="min-w-0 flex-1 text-[13px]">
        <div className="flex flex-wrap gap-2 font-medium text-[var(--color-text)]">
          <Wrench size={14} className="text-[var(--color-text-muted)]" />
          {row.name} <span className="tabular text-[var(--color-text-muted)]">turn {row.turn}</span>
        </div>
        <div
          className={`truncate font-mono text-[11px] ${
            inflight ? 'text-[var(--color-inflight)]' : 'text-[var(--color-text-muted)]'
          }`}
        >
          {body}
        </div>
        {err && row.errorSnippet ? (
          <p className="mt-1 border-l-2 border-[var(--color-fail-border)] pl-2 text-[12px] text-[var(--color-fail)]">
            {row.errorSnippet}
          </p>
        ) : null}
      </div>
      <span className="tabular text-[11px] text-[var(--color-text-muted)]">{time}</span>
    </div>
  );
}

function ThinkingRow({ row, replayed }: { row: Extract<ActivityFeedRow, { type: 'thinking' }>; replayed?: boolean }) {
  const [open, setOpen] = useState(false);
  const summaryChip = `thought ${row.durationMs != null ? `${Math.round(row.durationMs / 1000)}s` : '…'}, ${
    row.chars ?? row.text.length
  } chars — expand`;

  const showBody = open;
  const redactedThinking = replayed && row.summaryOnly;

  return (
    <div data-testid="thinking-row" className="squad-row-enter squad-row-enter--reduce mb-2 rounded-lg border border-[var(--color-thinking)]/50 bg-[var(--gray-3)] p-2">
      <button
        type="button"
        className="flex w-full items-start gap-2 text-left text-[13px]"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Brain size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--color-thinking)' }} />
        <span className="flex flex-1 flex-col gap-1 text-[var(--color-thinking)]">
          Thinking
          <span className="inline-flex w-fit rounded border border-[var(--color-thinking)]/40 px-2 py-0.5 font-mono text-[10px] text-[var(--color-text-muted)]">
            {redactedThinking ? `${summaryChip} · summary only` : summaryChip}
          </span>
        </span>
      </button>
      {showBody ? (
        redactedThinking ? (
          <p className="mt-2 px-2 text-[12px] italic text-[var(--color-text-muted)]">
            Thinking text not persisted (block summary only).
          </p>
        ) : (
          <pre className="mt-2 max-h-52 overflow-auto rounded bg-[var(--gray-2)] p-2 font-mono text-[11px] text-[var(--color-text-muted)]">
            {row.text.length ? row.text : row.summaryOnly ? '(summary only replay)' : '(streaming…)'}
          </pre>
        )
      ) : null}
    </div>
  );
}
