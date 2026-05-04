import { describe, it, expect } from 'vitest';
import { resolveRuntime } from '../src/planner/runtimes/index.js';
import { AgentSdkRuntime } from '../src/planner/runtimes/agent-sdk-runtime.js';
import { VercelRuntime } from '../src/planner/runtimes/vercel-runtime.js';

describe('resolveRuntime', () => {
  it('returns AgentSdkRuntime for anthropic + agent-sdk', () => {
    const rt = resolveRuntime({
      provider: 'anthropic',
      modelId: 'claude-opus-4-7',
      apiKey: 'sk-test',
      anthropicRuntime: 'agent-sdk',
    });
    expect(rt).toBeInstanceOf(AgentSdkRuntime);
    expect(rt.kind).toBe('agent-sdk');
    expect(rt.providerName).toBe('anthropic');
    expect(rt.modelId).toBe('claude-opus-4-7');
  });

  it('returns VercelRuntime for anthropic + vercel', () => {
    const rt = resolveRuntime({
      provider: 'anthropic',
      modelId: 'claude-opus-4-7',
      apiKey: 'sk-test',
      anthropicRuntime: 'vercel',
    });
    expect(rt).toBeInstanceOf(VercelRuntime);
    expect(rt.kind).toBe('vercel');
    expect(rt.providerName).toBe('anthropic');
  });

  it('returns VercelRuntime for openai regardless of anthropicRuntime flag', () => {
    const rt = resolveRuntime({
      provider: 'openai',
      modelId: 'gpt-4o',
      apiKey: 'sk-test',
      anthropicRuntime: 'agent-sdk',
    });
    expect(rt).toBeInstanceOf(VercelRuntime);
    expect(rt.kind).toBe('vercel');
    expect(rt.providerName).toBe('openai');
  });

  it('returns VercelRuntime for google regardless of anthropicRuntime flag', () => {
    const rt = resolveRuntime({
      provider: 'google',
      modelId: 'gemini-2.0-flash',
      apiKey: 'x',
      anthropicRuntime: 'agent-sdk',
    });
    expect(rt).toBeInstanceOf(VercelRuntime);
    expect(rt.kind).toBe('vercel');
    expect(rt.providerName).toBe('google');
  });

  it('defaults anthropic to agent-sdk when anthropicRuntime omitted', () => {
    const rt = resolveRuntime({
      provider: 'anthropic',
      modelId: 'm',
      apiKey: 'sk-test',
    });
    expect(rt).toBeInstanceOf(AgentSdkRuntime);
    expect(rt.kind).toBe('agent-sdk');
  });
});
