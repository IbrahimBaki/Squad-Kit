import { describe, it, expect } from 'vitest';
import { resolveModel } from '../src/planner/providers/index.js';

describe('resolveModel', () => {
  it('returns a LanguageModelV1 with the requested provider and model id', () => {
    const { provider, modelId, model } = resolveModel('anthropic', 'claude-opus-4-7', 'sk-test');
    expect(provider).toBe('anthropic');
    expect(modelId).toBe('claude-opus-4-7');
    expect(model.modelId).toBe('claude-opus-4-7');
    expect(model.provider).toBe('anthropic.messages');
  });
});
