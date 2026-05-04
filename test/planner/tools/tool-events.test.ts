import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as readFileMod from '../../../src/planner/tools/read-file.js';
import { buildPlannerToolDefinitions } from '../../../src/planner/tools/index.js';
import { Budget } from '../../../src/planner/budget.js';
import { PlannerEventBus } from '../../../src/planner/events.js';
import type { PlannerEvent } from '../../../src/planner/events.js';
import type { PlannerSessionLimitContext } from '../../../src/planner/session-limits.js';

const budgetCfg = { maxFileReads: 25, maxContextBytes: 500_000, maxDurationSeconds: 120 };

function dummyCtx(): PlannerSessionLimitContext {
  return {
    kind: 'file_or_context_reads',
    budgetSnapshot: new Budget(budgetCfg).snapshot(),
    iterations: 1,
    maxIterations: 8,
    maxOutputTokens: 4096,
  };
}

describe('tool_call_started / tool_call_completed', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('pairs started and completed with the same toolCallId on successful read_file', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-tool-'));
    try {
      fs.writeFileSync(path.join(root, 'a.txt'), 'hello', 'utf8');
      const bus = new PlannerEventBus();
      const evs: PlannerEvent[] = [];
      bus.subscribe((e) => evs.push(e));
      const defs = buildPlannerToolDefinitions({
        root,
        budget: new Budget(budgetCfg),
        getTurn: () => 1,
        runId: 'r1',
        bus,
        getLimitCtx: dummyCtx,
        extendSessionLimits: () => {},
        getAccumulatedText: () => '',
        setBudgetExhausted: () => {},
      });
      const read = defs.find((d) => d.name === 'read_file');
      if (!read) throw new Error('read_file missing');
      await read.execute({ path: 'a.txt' });

      const started = evs.filter((e): e is Extract<PlannerEvent, { kind: 'tool_call_started' }> => e.kind === 'tool_call_started');
      const completed = evs.filter((e): e is Extract<PlannerEvent, { kind: 'tool_call_completed' }> => e.kind === 'tool_call_completed');
      expect(started).toHaveLength(1);
      expect(completed).toHaveLength(1);
      const s0 = started[0]!;
      const c0 = completed[0]!;
      expect(s0.toolCallId).toBe(c0.toolCallId);
      expect(c0.isError).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('emits completed with isError and truncated errorSnippet when readFileTool throws', async () => {
    vi.spyOn(readFileMod, 'readFileTool').mockImplementation(() => {
      throw new Error(`disk failure ${'x'.repeat(300)}`);
    });

    const bus = new PlannerEventBus();
    const evs: PlannerEvent[] = [];
    bus.subscribe((e) => evs.push(e));
    const defs = buildPlannerToolDefinitions({
      root: os.tmpdir(),
      budget: new Budget(budgetCfg),
      getTurn: () => 1,
      runId: 'r1',
      bus,
      getLimitCtx: dummyCtx,
      extendSessionLimits: () => {},
      getAccumulatedText: () => '',
      setBudgetExhausted: () => {},
    });
    const read = defs.find((d) => d.name === 'read_file');
    if (!read) throw new Error('read_file missing');

    await expect(read.execute({ path: 'nope.txt' })).rejects.toThrow();

    const completed = evs.find((e): e is Extract<PlannerEvent, { kind: 'tool_call_completed' }> => e.kind === 'tool_call_completed');
    expect(completed).toBeDefined();
    expect(completed!.isError).toBe(true);
    expect((completed!.errorSnippet ?? '').length).toBeLessThanOrEqual(200);
  });
});
