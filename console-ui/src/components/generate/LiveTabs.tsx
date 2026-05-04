import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
import ReactMarkdown from 'react-markdown';
import type { GenerateRunState } from '~/hooks/useGenerateRun';

export function SvgMiniSparkline({ values, accent }: { values: readonly number[]; accent: string }) {
  const w = 260;
  const h = 64;
  if (values.length === 0) return <svg width={w} height={h} />;
  const vmin = Math.min(...values);
  const vmax = Math.max(...values);
  const span = vmax - vmin || 1;
  const pts = values.map((y, i) => {
    const x = values.length <= 1 ? w / 2 : (i / (values.length - 1)) * (w - 8) + 4;
    const ny = ((y - vmin) / span) * (h - 12) + 6;
    return `${x},${h - ny}`;
  });
  const points = pts.join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="max-w-full" aria-hidden>
      <polyline fill="none" stroke={accent} strokeWidth="2" points={points} />
    </svg>
  );
}

function PlanTab({ markdown, replayed }: { markdown: string; replayed?: boolean }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [pinnedBottom, setPinnedBottom] = useState(!replayed);

  useEffect(() => {
    if (replayed) return;
    const el = bodyRef.current;
    if (!el) return;
    const onScroll = () => {
      setPinnedBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [replayed]);

  useEffect(() => {
    if (replayed) return;
    const rid = requestAnimationFrame(() => {
      const el = bodyRef.current;
      if (!el || !pinnedBottom) return;
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(rid);
  }, [markdown, pinnedBottom, replayed]);

  return (
    <div className="relative flex min-h-[240px] flex-col overflow-hidden rounded border border-[var(--color-border)] bg-[var(--gray-3)] md:min-h-[280px]">
      {!replayed && !pinnedBottom ? (
        <button
          type="button"
          className="absolute bottom-3 right-3 z-[1] rounded-full bg-[var(--gray-12)] px-3 py-1 text-[11px] font-medium text-[var(--gray-1)] shadow-md"
          onClick={() => {
            setPinnedBottom(true);
            const el = bodyRef.current;
            if (el) el.scrollTop = el.scrollHeight;
          }}
        >
          ↓ jump to live
        </button>
      ) : null}
      <div
        ref={bodyRef}
        className="squad-scrollbar max-h-[460px] min-h-[200px] flex-1 overflow-y-auto px-4 py-3 prose-docs"
      >
        {markdown ? <ReactMarkdown>{markdown}</ReactMarkdown> : <span className="text-[var(--color-text-muted)]">Waiting…</span>}
      </div>
    </div>
  );
}

function IssuesTab({ validation }: { validation: GenerateRunState['validation'] }) {
  if (validation.length === 0)
    return <p className="text-sm text-[var(--color-text-muted)]">No validation issues flagged.</p>;

  const dotTone = {
    warning: 'bg-[var(--color-warn)]',
    error: 'bg-[var(--color-fail)]',
  } as const;

  return (
    <ul className="max-h-[420px] space-y-2 overflow-y-auto">
      {validation.map((v) => (
        <li
          key={v.id}
          className="flex gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--gray-3)] p-2 text-[13px]"
        >
          <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${dotTone[v.severity]}`} />
          <div className="min-w-0">
            <span className="chip mr-2 text-[10px]">{v.issueKind}</span>
            {v.path ? <div className="font-mono text-[11px] text-[var(--color-text-muted)]">{v.path}</div> : null}
            <p className="text-[var(--color-text-muted)]">{v.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function TelemetryTab({ state }: { state: GenerateRunState }) {
  const tokPts = state.tokens.perTurn.map((u) => u.sum);
  const cachePts = state.cacheHitPctPerTurn;

  const rows =
    state.runtime ?
      ([
        ['provider', state.runtime.provider],
        ['model', state.runtime.model],
        ['runtimeKind', state.runtime.runtimeKind],
        ['cache enabled', state.runtime.cacheEnabled ? 'yes' : 'no'],
        ['scout', state.runtime.scoutEnabled ? 'on' : 'off'],
        ['validation', state.runtime.validationEnabled ? 'on' : 'off'],
      ] satisfies [string, string][])
    : [];

  return (
    <div className="grid max-h-[480px] gap-4 overflow-y-auto">
      <div>
        <h3 className="mb-1 text-[12px] font-semibold uppercase text-[var(--color-text-muted)]">Tokens / turn</h3>
        <SvgMiniSparkline values={tokPts} accent="var(--color-inflight)" />
      </div>
      <div>
        <h3 className="mb-1 text-[12px] font-semibold uppercase text-[var(--color-text-muted)]">
          Cache hit % per update
        </h3>
        <SvgMiniSparkline values={cachePts} accent="var(--color-ok)" />
      </div>
      <div className="overflow-x-auto rounded border border-[var(--color-border)]">
        <table className="w-full border-collapse text-left text-[13px]">
          <thead>
            <tr className="bg-[var(--gray-2)] text-[var(--color-text-muted)]">
              <th className="p-2">Key</th>
              <th className="p-2">Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k} className="border-t border-[var(--color-border)]">
                <td className="p-2 font-mono text-[11px]">{k}</td>
                <td className="p-2 font-mono text-[11px]">{String(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StableTabs({
  tabs,
  initialTabId,
}: {
  tabs: { id: string; label: ReactElement | string; panel: ReactElement }[];
  /** First tab matching this id becomes selected (defaults to plan). */
  initialTabId?: string;
}) {
  const baseId = useId();
  const initialIdxRaw = initialTabId ? tabs.findIndex((t) => t.id === initialTabId) : 0;
  const initialIdx = initialIdxRaw >= 0 ? initialIdxRaw : 0;
  const [i, setI] = useState(initialIdx);

  return (
    <div data-testid="live-tabs-root">
      <div role="tablist" aria-orientation="horizontal" className="flex gap-4 border-b border-[var(--color-border)]">
        {tabs.map((t, j) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`${baseId}-tab-${t.id}`}
            aria-selected={j === i}
            aria-controls={`${baseId}-panel-${t.id}`}
            tabIndex={j === i ? 0 : -1}
            className={
              j === i
                ? 'relative -mb-px border-b-2 border-[var(--color-text)] px-1 py-2 text-[13px] font-medium text-[var(--color-text)]'
                : 'relative -mb-px border-b-2 border-transparent px-1 py-2 text-[13px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
            }
            onClick={() => setI(j)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t, j) => (
        <div
          key={t.id}
          id={`${baseId}-panel-${t.id}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${t.id}`}
          hidden={j !== i}
          className="pt-4"
        >
          {t.panel}
        </div>
      ))}
    </div>
  );
}

export function LiveTabs({
  state,
  replayed,
  initialTab,
  hideIssuesTab,
}: {
  state: GenerateRunState;
  replayed?: boolean;
  initialTab?: 'plan' | 'issues' | 'telemetry';
  hideIssuesTab?: boolean;
}) {
  const vCount = state.validation.length;
  const tabDefs = [
    { id: 'plan', label: 'Plan', panel: <PlanTab markdown={state.assistantMd} replayed={replayed} /> },
    {
      id: 'issues',
      label: (
        <span className="inline-flex items-center gap-2">
          Issues{vCount ? <span aria-label={`Issues count ${vCount}`}>{vCount}</span> : null}
        </span>
      ),
      panel: <IssuesTab validation={state.validation} />,
    },
    { id: 'telemetry', label: 'Telemetry', panel: <TelemetryTab state={state} /> },
  ] as const;
  const tabs = hideIssuesTab ? tabDefs.filter((t) => t.id !== 'issues') : [...tabDefs];
  const resolvedInitial =
    hideIssuesTab && initialTab === 'issues' ?
      'plan'
    : (initialTab ?? 'plan');

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--gray-2)] p-3">
      <StableTabs tabs={tabs} initialTabId={resolvedInitial} />
    </div>
  );
}
