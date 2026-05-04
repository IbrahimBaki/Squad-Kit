import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { AgentSdkRuntime } from '../src/planner/runtimes/agent-sdk-runtime.js';
import { PlannerEventBus, type PlannerEvent } from '../src/planner/events.js';
import { Budget } from '../src/planner/budget.js';
import type { PlannerToolDefinition } from '../src/planner/runtimes/planner-tool-def.js';
import { ScoutOutputSchema } from '../src/planner/stages/scout-schema.js';

const queryMock = vi.hoisted(() => vi.fn());
const createSdkMcpServerMock = vi.hoisted(() =>
  vi.fn((opts: { name: string; version: string; tools: unknown[] }) => opts),
);
const toolMock = vi.hoisted(() =>
  vi.fn(
    (
      _name: string,
      _desc: string,
      _fields: unknown,
      exec: (args: unknown) => Promise<unknown>,
    ) => ({ exec }),
  ),
);

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => (queryMock as (...a: unknown[]) => void)(...args),
  createSdkMcpServer: (...args: unknown[]) => (createSdkMcpServerMock as (...a: unknown[]) => void)(...args),
  tool: (...args: unknown[]) => (toolMock as (...a: unknown[]) => void)(...args),
}));

function textDeltaEvent(text: string) {
  return {
    type: 'stream_event',
    event: { type: 'content_block_delta', delta: { type: 'text_delta', text } },
  };
}

const budgetCfg = {
  maxFileReads: 25,
  maxContextBytes: 500_000,
  maxDurationSeconds: 120,
};

function lastDraftQueryOptions() {
  const call = queryMock.mock.calls.find(
    (c) => (c[0] as { options?: { mcpServers?: Record<string, unknown> } }).options?.mcpServers?.['squad-kit-planner'],
  );
  expect(call).toBeDefined();
  return (call![0] as { options: Record<string, unknown> }).options;
}

function lastScoutQueryOptions() {
  const call = queryMock.mock.calls.find(
    (c) => (c[0] as { options?: { mcpServers?: Record<string, unknown> } }).options?.mcpServers?.['squad-kit-scout'],
  );
  expect(call).toBeDefined();
  return (call![0] as { options: Record<string, unknown> }).options;
}

describe('AgentSdkRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runDraft aggregates streamed text deltas and final usage', async () => {
    queryMock.mockImplementation(() =>
      (async function* () {
        yield textDeltaEvent('## ');
        yield textDeltaEvent('Done');
        yield { type: 'assistant' };
        yield {
          type: 'result',
          subtype: 'success',
          usage: { input_tokens: 100, output_tokens: 20 },
        };
      })(),
    );

    const bus = new PlannerEventBus();
    const events: PlannerEvent[] = [];
    bus.subscribe((e) => events.push(e));

    const rt = new AgentSdkRuntime('claude-opus-4-7', 'sk-secret');
    const toolExec = vi.fn(async () => 'noop');
    const tools: PlannerToolDefinition[] = [
      {
        name: 'read_file',
        description: 'x',
        parameters: z.object({ path: z.string() }),
        execute: toolExec,
      },
    ];

    const out = await rt.runDraft({
      systemPrompt: 'sys',
      userMessage: 'hi',
      tools,
      bus,
      runId: 'r1',
      budget: new Budget(budgetCfg),
      maxSteps: 8,
      maxOutputTokens: 4096,
      providerSpecific: { thinking: 'adaptive', effort: 'medium' },
    });

    expect(out.text).toBe('## Done');
    expect(out.finishedNormally).toBe(true);
    expect(out.finalUsage.inputTokens).toBe(100);
    expect(out.finalUsage.outputTokens).toBe(20);
    expect(events.filter((e) => e.kind === 'assistant_text').length).toBeGreaterThan(0);
    expect(events.some((e) => e.kind === 'usage')).toBe(true);
    expect(toolExec).not.toHaveBeenCalled();
  });

  it('runDraft invokes PlannerToolDefinition.execute when SDK tool hook runs', async () => {
    const toolExec = vi.fn(async () => ({ content: 'file-body', isError: false }));

    queryMock.mockImplementation(() => {
      const plannerEntry = [...createSdkMcpServerMock.mock.calls].find((c) => c[0].name === 'squad-kit-planner');
      const toolsWrapped = plannerEntry?.[0].tools as Array<{ exec: (a: unknown) => Promise<unknown> }>;
      return (async function* () {
        if (toolsWrapped?.[0]) {
          await toolsWrapped[0].exec({ path: 'notes.txt' });
        }
        yield { type: 'assistant' };
        yield { type: 'result', subtype: 'success', usage: { input_tokens: 5, output_tokens: 3 } };
      })();
    });

    const rt = new AgentSdkRuntime('claude-opus-4-7', 'sk-secret');
    const tools: PlannerToolDefinition[] = [
      {
        name: 'read_file',
        description: 'read',
        parameters: z.object({ path: z.string() }),
        execute: toolExec,
      },
    ];

    await rt.runDraft({
      systemPrompt: 's',
      userMessage: 'u',
      tools,
      bus: new PlannerEventBus(),
      runId: 'r1',
      budget: new Budget(budgetCfg),
      maxSteps: 8,
      maxOutputTokens: 4096,
      providerSpecific: { thinking: 'adaptive', effort: 'medium' },
    });

    expect(toolExec).toHaveBeenCalledWith({ path: 'notes.txt' });
  });

  it('runDraft surfaces cancellation via AbortError from iterator', async () => {
    queryMock.mockImplementation(() =>
      (async function* () {
        yield textDeltaEvent('partial');
        throw new DOMException('Aborted', 'AbortError');
      })(),
    );

    const bus = new PlannerEventBus();
    const events: PlannerEvent[] = [];
    bus.subscribe((e) => events.push(e));

    const rt = new AgentSdkRuntime('claude-opus-4-7', 'sk-secret');
    const out = await rt.runDraft({
      systemPrompt: 's',
      userMessage: 'u',
      tools: [],
      bus,
      runId: 'r1',
      budget: new Budget(budgetCfg),
      maxSteps: 8,
      maxOutputTokens: 4096,
    });

    expect(out.text.startsWith('partial')).toBe(true);
    expect(out.finishedNormally).toBe(false);
    expect(out.userCancelled).toBe(true);
    expect(events.some((e) => e.kind === 'cancelled')).toBe(true);
  });

  it('passes adaptive thinking through query options', async () => {
    queryMock.mockImplementation(() =>
      (async function* () {
        yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
      })(),
    );

    const rt = new AgentSdkRuntime('m', 'k');
    await rt.runDraft({
      systemPrompt: 's',
      userMessage: 'u',
      tools: [],
      bus: new PlannerEventBus(),
      runId: 'r1',
      budget: new Budget(budgetCfg),
      maxSteps: 2,
      maxOutputTokens: 256,
      providerSpecific: { thinking: 'adaptive', effort: 'high' },
    });

    const opts = lastDraftQueryOptions();
    expect(opts.thinking).toEqual({ type: 'adaptive' });
    expect(opts.effort).toBe('high');
  });

  it('maps thinking off to disabled SDK thinking', async () => {
    queryMock.mockImplementation(() =>
      (async function* () {
        yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
      })(),
    );

    const rt = new AgentSdkRuntime('m', 'k');
    await rt.runDraft({
      systemPrompt: 's',
      userMessage: 'u',
      tools: [],
      bus: new PlannerEventBus(),
      runId: 'r1',
      budget: new Budget(budgetCfg),
      maxSteps: 2,
      maxOutputTokens: 256,
      providerSpecific: { thinking: 'off', effort: 'medium' },
    });

    const opts = lastDraftQueryOptions();
    expect(opts.thinking).toEqual({ type: 'disabled' });
  });

  it('injects API key via query env without requiring a global env mutation', async () => {
    queryMock.mockImplementation(() =>
      (async function* () {
        yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
      })(),
    );

    const rt = new AgentSdkRuntime('m', 'sk-injected');
    await rt.runDraft({
      systemPrompt: 's',
      userMessage: 'u',
      tools: [],
      bus: new PlannerEventBus(),
      runId: 'r1',
      budget: new Budget(budgetCfg),
      maxSteps: 2,
      maxOutputTokens: 256,
    });

    const opts = lastDraftQueryOptions();
    expect((opts.env as NodeJS.ProcessEnv).ANTHROPIC_API_KEY).toBe('sk-injected');
  });

  it('suppresses built-in tools and locks down MCP session options', async () => {
    queryMock.mockImplementation(() =>
      (async function* () {
        yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
      })(),
    );

    const rt = new AgentSdkRuntime('m', 'k');
    await rt.runDraft({
      systemPrompt: 's',
      userMessage: 'u',
      tools: [],
      bus: new PlannerEventBus(),
      runId: 'r1',
      budget: new Budget(budgetCfg),
      maxSteps: 2,
      maxOutputTokens: 256,
    });

    const opts = lastDraftQueryOptions();
    expect(opts.tools).toEqual([]);
    expect(opts.disallowedTools).toContain('Read');
    expect(opts.persistSession).toBe(false);
    expect(opts.settingSources).toEqual([]);
  });

  it('sets max_iterations incompleteKind on error_max_turns result', async () => {
    queryMock.mockImplementation(() =>
      (async function* () {
        yield { type: 'result', subtype: 'error_max_turns', usage: { input_tokens: 2, output_tokens: 1 } };
      })(),
    );

    const rt = new AgentSdkRuntime('m', 'k');
    const out = await rt.runDraft({
      systemPrompt: 's',
      userMessage: 'u',
      tools: [],
      bus: new PlannerEventBus(),
      runId: 'r1',
      budget: new Budget(budgetCfg),
      maxSteps: 2,
      maxOutputTokens: 256,
    });
    expect(out.incompleteKind).toBe('max_iterations');
    expect(out.finishedNormally).toBe(false);
  });

  it('runScout returns parsed output when respond tool runs with valid args', async () => {
    queryMock.mockImplementation(() => {
      const scoutEntry = [...createSdkMcpServerMock.mock.calls].find((c) => c[0].name === 'squad-kit-scout');
      const scoutTools = scoutEntry?.[0].tools as Array<{ exec: (a: unknown) => Promise<unknown> }>;
      return (async function* () {
        if (scoutTools?.[0]) {
          await scoutTools[0].exec({
            selectedFiles: ['./a.md'],
            reasoning: 'need a',
            suggestedReadStrategy: 'read_full',
          });
        }
        yield { type: 'result', subtype: 'success', usage: { input_tokens: 30, output_tokens: 10 } };
      })();
    });

    const rt = new AgentSdkRuntime('m', 'k');
    const out = await rt.runScout({
      systemPrompt: 'sys',
      userMessage: 'pick files',
      schema: ScoutOutputSchema,
      bus: new PlannerEventBus(),
      runId: 'r-scout',
      maxOutputTokens: 1024,
      providerSpecific: { effort: 'minimal' },
    });

    expect(out).not.toBeNull();
    expect(out!.output.selectedFiles).toEqual(['./a.md']);
    expect(out!.usage.inputTokens).toBe(30);
    expect(out!.usage.outputTokens).toBe(10);
  });

  it('runScout returns null when tool args fail schema validation', async () => {
    queryMock.mockImplementation(() => {
      const scoutEntry = [...createSdkMcpServerMock.mock.calls].find((c) => c[0].name === 'squad-kit-scout');
      const scoutTools = scoutEntry?.[0].tools as Array<{ exec: (a: unknown) => Promise<unknown> }>;
      return (async function* () {
        if (scoutTools?.[0]) {
          await scoutTools[0].exec({
            selectedFiles: [],
            reasoning: 'x',
            suggestedReadStrategy: 'read_full',
          });
        }
        yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
      })();
    });

    const rt = new AgentSdkRuntime('m', 'k');
    const out = await rt.runScout({
      systemPrompt: 'sys',
      userMessage: 'pick files',
      schema: ScoutOutputSchema,
      bus: new PlannerEventBus(),
      runId: 'r-scout',
      maxOutputTokens: 1024,
    });
    expect(out).toBeNull();
  });

  it('runScout returns null when the response tool is never called', async () => {
    queryMock.mockImplementation(() =>
      (async function* () {
        yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
      })(),
    );

    const rt = new AgentSdkRuntime('m', 'k');
    const out = await rt.runScout({
      systemPrompt: 'sys',
      userMessage: 'pick files',
      schema: ScoutOutputSchema,
      bus: new PlannerEventBus(),
      runId: 'r-scout',
      maxOutputTokens: 1024,
    });
    expect(out).toBeNull();
  });

  it('runScout query options also disable persistence and empty tool list on scout server', async () => {
    queryMock.mockImplementation(() =>
      (async function* () {
        yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
      })(),
    );

    const rt = new AgentSdkRuntime('m', 'k');
    await rt.runScout({
      systemPrompt: 'sys',
      userMessage: 'u',
      schema: ScoutOutputSchema,
      bus: new PlannerEventBus(),
      runId: 'rid',
      maxOutputTokens: 256,
    });

    const opts = lastScoutQueryOptions();
    expect(opts.tools).toEqual([]);
    expect(opts.persistSession).toBe(false);
    expect(opts.settingSources).toEqual([]);
  });
});
