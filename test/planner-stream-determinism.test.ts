import { describe, it, expect } from 'vitest';
import type { LanguageModelV1StreamPart } from '@ai-sdk/provider';
import { resolveModel } from '../src/planner/providers/index.js';
import { runPlanner } from '../src/planner/loop.js';
import { Budget } from '../src/planner/budget.js';
import { MockLanguageModelV1, simulateReadableStream } from 'ai/test';

function streamOk(chunks: LanguageModelV1StreamPart[]) {
  return {
    stream: simulateReadableStream({ chunks }),
    rawCall: { rawPrompt: [] as unknown[], rawSettings: {} },
  };
}

function tok(p: number, o: number) {
  return { promptTokens: p, completionTokens: o, totalTokens: p + o };
}

const budgetCfg = {
  maxFileReads: 10,
  maxContextBytes: 100_000,
  maxDurationSeconds: 60,
};

describe('planner stream / model resolution', () => {
  it('resolveModel wires the requested Anthropic model id on the client', () => {
    const { model, modelId } = resolveModel('anthropic', 'claude-opus-4-7', 'sk-test');
    expect(modelId).toBe('claude-opus-4-7');
    expect(model.modelId).toBe('claude-opus-4-7');
  });

  it('runPlanner sends system + user messages with expected shape on first step', async () => {
    let seenPrompt: unknown;
    const model = new MockLanguageModelV1({
      provider: 'mock',
      modelId: 'mid',
      doStream: async (opts) => {
        seenPrompt = opts.prompt;
        return streamOk([{ type: 'finish', finishReason: 'stop', usage: tok(1, 1) }]);
      },
    });
    await runPlanner({
      root: '/tmp',
      model,
      provider: 'anthropic',
      modelId: 'mid',
      systemPrompt: 'SYS',
      userPrompt: 'USER',
      budget: new Budget(budgetCfg),
      cacheEnabled: true,
    });
    const msgs = seenPrompt as Array<{ role: string; content?: unknown }>;
    // CoreMessage `providerOptions` are consumed when building the language-model prompt; cache
    // markers on CoreMessages are covered in `anthropic-cache-control.test.ts`.
    expect(msgs[0]).toMatchObject({
      role: 'system',
      content: 'SYS',
    });
    expect(msgs[1]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'USER' }],
    });
  });
});
