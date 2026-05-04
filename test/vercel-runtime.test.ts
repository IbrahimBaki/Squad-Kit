import { describe, it, expect } from 'vitest';
import os from 'node:os';
import type { LanguageModelV1StreamPart } from '@ai-sdk/provider';
import { MockLanguageModelV1, simulateReadableStream } from 'ai/test';
import { VercelRuntime } from '../src/planner/runtimes/vercel-runtime.js';
import { PlannerEventBus } from '../src/planner/events.js';
import { Budget } from '../src/planner/budget.js';

const budgetCfg = {
  maxFileReads: 25,
  maxContextBytes: 500_000,
  maxDurationSeconds: 120,
};

function streamOk(chunks: LanguageModelV1StreamPart[]) {
  return {
    stream: simulateReadableStream({ chunks }),
    rawCall: { rawPrompt: [] as unknown[], rawSettings: {} },
  };
}

describe('VercelRuntime.runDraft', () => {
  it('streams assistant text and finishes normally on stop', async () => {
    const model = new MockLanguageModelV1({
      provider: 'mock',
      modelId: 'm',
      doStream: async () =>
        streamOk([
          { type: 'text-delta', textDelta: '# Plan\n' },
          {
            type: 'finish',
            finishReason: 'stop',
            usage: { promptTokens: 10, completionTokens: 5 },
          },
        ]),
    });
    const rt = new VercelRuntime('anthropic', 'm', model, true);
    const out = await rt.runDraft({
      systemPrompt: 'sys',
      userMessage: 'user',
      tools: [],
      bus: new PlannerEventBus(),
      runId: 'r1',
      budget: new Budget(budgetCfg),
      maxSteps: 8,
      maxOutputTokens: 4096,
      vercelLoop: {
        model: rt.languageModel,
        provider: 'anthropic',
        modelId: 'm',
        root: os.tmpdir(),
        userPrompt: 'user',
        cacheEnabled: true,
      },
    });
    expect(out.text).toContain('# Plan');
    expect(out.finishedNormally).toBe(true);
    expect(out.finalUsage.inputTokens).toBe(10);
    expect(out.finalUsage.outputTokens).toBe(5);
  });
});
