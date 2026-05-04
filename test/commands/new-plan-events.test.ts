import { describe, it, expect, vi, afterEach } from 'vitest';
import { Budget } from '../../src/planner/budget.js';
import {
  dispatchNewPlanApiPlannerEvent,
  type NewPlanApiUiDispatchContext,
} from '../../src/commands/new-plan-api-events.js';
import type { PlannerEvent } from '../../src/planner/events.js';

function captureStderrDuring(fn: () => void): string {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString());
    return true;
  });
  try {
    fn();
  } finally {
    spy.mockRestore();
  }
  return chunks.join('');
}

function makeCtx(override?: Partial<NewPlanApiUiDispatchContext>): NewPlanApiUiDispatchContext {
  const budget = new Budget({ maxFileReads: 25, maxContextBytes: 50_000, maxDurationSeconds: 180 });
  return {
    sessionSpinner: { current: null },
    stageLine: { scout: 'pending', draft: 'pending', validation: 'pending' },
    activePlannerStage: null,
    thinkingBlockChars: 0,
    thinkingState: { running: false, blockStartedAt: 0, totalChars: 0, totalDurationMs: 0 },
    thinkingSpinner: { current: null },
    thinkingTick: { id: null },
    budget,
    budgetCaps: null,
    startedAt: 10_000,
    interactive: true,
    stagesIntroPrinted: false,
    lastToolUi: null,
    streamedValidationIssues: { count: 0 },
    validationStreamCappedMsg: false,
    anthropicRuntimeChoice: 'agent-sdk',
    usageAcc: { inputTokens: 0, outputTokens: 0 },
    ...override,
  };
}

const runId = 'run-test';

function evRuntimeInfo(): PlannerEvent {
  return {
    kind: 'runtime_info',
    runId,
    provider: 'anthropic',
    model: 'claude-test',
    runtimeKind: 'agent-sdk',
    cacheEnabled: true,
    scoutEnabled: true,
    validationEnabled: true,
    budgetCaps: { maxFileReads: 25, maxContextBytes: 50_000, maxDurationSeconds: 180 },
    providerOptions: { anthropic: { effort: 'high', thinking: 'adaptive' } },
  };
}

describe('dispatchNewPlanApiPlannerEvent', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints runtime_info, stages divider, and stage pipeline', () => {
    const out = captureStderrDuring(() => {
      const ctx = makeCtx({ interactive: false });
      dispatchNewPlanApiPlannerEvent(ctx, evRuntimeInfo());
      dispatchNewPlanApiPlannerEvent(ctx, { kind: 'stage_started', runId, stage: 'scout' });
    });
    expect(out).toContain('runtime info');
    expect(out).toContain('stages');
    expect(out).toContain('→');
    expect(out).toContain('effort');
  });

  it('prints tool line with duration on tool_call_completed', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(25_000);
    const out = captureStderrDuring(() => {
      const ctx = makeCtx({ interactive: false, startedAt: 10_000 });
      const slog: string[] = [];
      ctx.sessionSpinner.current = {
        update() {},
        setPrefix() {},
        succeed(msg?: string) {
          slog.push(msg ?? '');
        },
        fail(msg?: string) {
          slog.push(`fail:${msg ?? ''}`);
        },
        stop() {},
      };
      dispatchNewPlanApiPlannerEvent(ctx, {
        kind: 'tool_call',
        runId,
        turn: 1,
        toolCall: { id: 't1', name: 'read_file', input: { path: 'foo.ts' } },
        bytesLoaded: 100,
        totalBytes: 200,
      });
      dispatchNewPlanApiPlannerEvent(ctx, {
        kind: 'tool_call_completed',
        runId,
        turn: 1,
        toolCallId: 't1',
        name: 'read_file',
        durationMs: 84,
        bytesLoaded: 100,
        totalBytes: 200,
        isError: false,
      });
      expect(slog.some((s) => s.includes('read foo.ts') && s.includes('tool 84ms'))).toBe(true);
    });
    expect(out).toMatch(/reads \d+\/25/);
    clock.mockRestore();
  });

  it('prints validation_issue lines when interactive', () => {
    const out = captureStderrDuring(() => {
      const ctx = makeCtx({ interactive: true });
      dispatchNewPlanApiPlannerEvent(ctx, {
        kind: 'validation_issue',
        runId,
        severity: 'warning',
        issueKind: 'missing_path',
        path: 'x.md',
        detail: 'noop',
      });
    });
    expect(out).toContain('[warning]');
    expect(out).toContain('missing_path');
  });

  it('streams thinking_block stopped line with formatted thought', () => {
    vi.spyOn(Date, 'now').mockReturnValue(100_000);
    const out = captureStderrDuring(() => {
      const ctx = makeCtx({ interactive: false });
      dispatchNewPlanApiPlannerEvent(ctx, {
        kind: 'thinking_block_started',
        runId,
        turn: 1,
        blockIndex: 0,
      });
      dispatchNewPlanApiPlannerEvent(ctx, {
        kind: 'thinking_delta',
        runId,
        turn: 1,
        blockIndex: 0,
        delta: 'hello',
      });
      dispatchNewPlanApiPlannerEvent(ctx, {
        kind: 'thinking_block_stopped',
        runId,
        turn: 1,
        blockIndex: 0,
        durationMs: 1200,
        chars: 5,
      });
    });
    expect(out).toContain('thought');
    expect(out).toContain('5 chars');
  });
});
