import { describe, expect, it } from 'vitest';
import {
  INITIAL_GENERATE_RUN_STATE,
  applyGenerateEvent,
  generateRunReducer,
  resetGenerateFeedSeqForReplay,
  type GenerateRunState,
} from '~/hooks/useGenerateRun';

describe('generateRunReducer', () => {
  it('parses runtime_info and primes budget caps', () => {
    let s: GenerateRunState = { ...INITIAL_GENERATE_RUN_STATE, phase: 'streaming', runId: 'r1' };
    s = generateRunReducer(s, {
      type: 'sse',
      event: {
        kind: 'runtime_info',
        provider: 'anthropic',
        model: 'opus',
        runtimeKind: 'agent-sdk',
        cacheEnabled: true,
        scoutEnabled: true,
        validationEnabled: true,
        budgetCaps: { maxFileReads: 10, maxContextBytes: 4096, maxDurationSeconds: 60 },
      },
    });
    expect(s.runtime?.model).toBe('opus');
    expect(s.budget.caps?.maxFileReads).toBe(10);
  });

  it('correlates tool_call_started → tool_call → tool_call_completed', () => {
    let s: GenerateRunState = { ...INITIAL_GENERATE_RUN_STATE, phase: 'streaming', runId: 'r', turn: 1 };
    const id = 't-1';
    s = generateRunReducer(s, {
      type: 'sse',
      event: {
        kind: 'tool_call_started',
        toolCallId: id,
        name: 'read_file',
        turn: 1,
        input: { path: 'a.ts' },
      },
    });
    expect(s.tools[0]?.kind).toBe('running');
    s = generateRunReducer(s, {
      type: 'sse',
      event: { kind: 'tool_call', toolCallId: id, turn: 1, toolCall: {}, bytesLoaded: 100, totalBytes: 200 },
    });
    s = generateRunReducer(s, {
      type: 'sse',
      event: {
        kind: 'tool_call_completed',
        toolCallId: id,
        turn: 1,
        name: 'read_file',
        durationMs: 400,
        bytesLoaded: 200,
        totalBytes: 200,
        isError: false,
      },
    });
    expect(s.tools[0]?.kind).toBe('success');
    expect(s.budget.fileReadsCompleted).toBe(1);
  });

  it('stores thinking_block lifecycle', () => {
    let s: GenerateRunState = { ...INITIAL_GENERATE_RUN_STATE, phase: 'streaming', runId: 'r', turn: 0 };
    s = generateRunReducer(s, {
      type: 'sse',
      event: { kind: 'thinking_block_started', turn: 0, blockIndex: 0 },
    });
    s = generateRunReducer(s, {
      type: 'sse',
      event: { kind: 'thinking_delta', turn: 0, blockIndex: 0, delta: 'hi' },
    });
    expect(s.thinking.blocks[0]?.text).toBe('hi');
    s = generateRunReducer(s, {
      type: 'sse',
      event: { kind: 'thinking_block_stopped', turn: 0, blockIndex: 0, durationMs: 1200, chars: 2 },
    });
    expect(s.thinking.blocks[0]?.summaryOnly).toBe(false);
  });

  it('replay thinking with empty deltas is summary-only', () => {
    let s: GenerateRunState = { ...INITIAL_GENERATE_RUN_STATE, phase: 'streaming' };
    s = generateRunReducer(s, {
      type: 'sse',
      event: { kind: 'thinking_block_started', turn: 0, blockIndex: 0 },
    });
    s = generateRunReducer(s, {
      type: 'sse',
      event: { kind: 'thinking_delta', turn: 0, blockIndex: 0, delta: '' },
    });
    s = generateRunReducer(s, {
      type: 'sse',
      event: { kind: 'thinking_block_stopped', turn: 0, blockIndex: 0, durationMs: 1, chars: 10 },
    });
    expect(s.thinking.blocks[0]?.summaryOnly).toBe(true);
  });

  it('keeps rate banner after partial done', () => {
    let s: GenerateRunState = { ...INITIAL_GENERATE_RUN_STATE, phase: 'streaming' };
    s = generateRunReducer(s, {
      type: 'sse',
      event: {
        kind: 'rate_limit',
        phase: 'aborted',
        provider: 'anthropic',
        retryAfterSec: 3,
        waitSec: 3,
        capSec: 90,
      },
    });
    expect(s.rateLimit?.phase).toBe('aborted');
    s = generateRunReducer(s, {
      type: 'sse',
      event: {
        kind: 'done',
        success: false,
        partial: true,
        planFile: null,
      },
    });
    expect(s.rateLimit?.phase).toBe('aborted');
    expect(s.phase).toBe('cancelled');
  });

  it('tracks usage ceilings', () => {
    let s: GenerateRunState = { ...INITIAL_GENERATE_RUN_STATE, phase: 'streaming' };
    s = generateRunReducer(s, {
      type: 'sse',
      event: {
        kind: 'usage',
        turn: 1,
        usage: { inputTokens: 4000, outputTokens: 4000 },
      },
    });
    expect(s.tokens.ceiling >= 8192).toBe(true);
  });

  it('applyGenerateEvent is pure when feed ids reset between calls', () => {
    const s: GenerateRunState = { ...INITIAL_GENERATE_RUN_STATE, phase: 'streaming', runId: 'rid' };
    const ev = { kind: 'usage', turn: 1, usage: { inputTokens: 10, outputTokens: 5 } };
    const t = 1700000010000;
    resetGenerateFeedSeqForReplay();
    const a = applyGenerateEvent(s, ev, t);
    resetGenerateFeedSeqForReplay();
    const b = applyGenerateEvent(s, ev, t);
    expect(a).toEqual(b);
  });
});
