import { describe, it, expect } from 'vitest';
import { usageFromLanguageModelStep } from '../src/planner/usage-map.js';
import type { LanguageModelUsage } from 'ai';

describe('usageFromLanguageModelStep (Anthropic cache fields)', () => {
  it('maps cacheCreationInputTokens and cacheReadInputTokens from provider metadata', () => {
    const usage: LanguageModelUsage = {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    };
    const meta = {
      anthropic: {
        cacheCreationInputTokens: 2000,
        cacheReadInputTokens: 800,
      },
    };
    expect(usageFromLanguageModelStep(usage, meta)).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheCreationTokens: 2000,
      cacheReadTokens: 800,
    });
  });

  it('treats missing cache fields as zero', () => {
    const usage: LanguageModelUsage = {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    };
    expect(usageFromLanguageModelStep(usage, undefined)).toEqual({
      inputTokens: 10,
      outputTokens: 5,
    });
  });
});
