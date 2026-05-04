import type { ProviderName } from '../types.js';
import type { PlannerRuntime } from './types.js';
import { VercelRuntime } from './vercel-runtime.js';
import { AgentSdkRuntime } from './agent-sdk-runtime.js';

export * from './types.js';
export { VercelRuntime } from './vercel-runtime.js';
export { AgentSdkRuntime } from './agent-sdk-runtime.js';
export { extractAnthropicProviderSpecific, sdkEffortFromPlanner, thinkingConfigFromProviderSpecific } from './anthropic-options.js';

export interface ResolveRuntimeInput {
  provider: ProviderName;
  modelId: string;
  apiKey: string;
  anthropicRuntime?: 'agent-sdk' | 'vercel';
}

export function resolveRuntime(input: ResolveRuntimeInput): PlannerRuntime {
  if (input.provider === 'anthropic') {
    const choice = input.anthropicRuntime ?? 'agent-sdk';
    if (choice === 'agent-sdk') return new AgentSdkRuntime(input.modelId, input.apiKey);
    return new VercelRuntime('anthropic', input.modelId, input.apiKey);
  }
  return new VercelRuntime(input.provider, input.modelId, input.apiKey);
}
