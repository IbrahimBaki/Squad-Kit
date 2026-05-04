import type { AnthropicProviderSpecific } from './types.js';
import type { PlannerConfig } from '../types.js';

export function extractAnthropicProviderSpecific(
  cfg: PlannerConfig,
  phase: 'scout' | 'draft',
  cliOverrides?: { effort?: string; thinking?: 'off' },
): AnthropicProviderSpecific {
  const opts = cfg.providerOptions?.anthropic;
  const phaseEffort = opts?.effortByPhase?.[phase];
  const baseEffort = opts?.effort ?? 'medium';
  const effort =
    (cliOverrides?.effort as AnthropicProviderSpecific['effort'] | undefined) ?? phaseEffort ?? baseEffort;
  return {
    thinking: cliOverrides?.thinking === 'off' ? 'off' : opts?.thinking ?? 'adaptive',
    thinkingBudget: opts?.thinkingBudget,
    effort,
  };
}

export function sdkEffortFromPlanner(
  effort: AnthropicProviderSpecific['effort'] | undefined,
): 'low' | 'medium' | 'high' | 'xhigh' | 'max' {
  if (effort === 'minimal') return 'low';
  if (effort === 'high') return 'high';
  return 'medium';
}

export function thinkingConfigFromProviderSpecific(
  ps: AnthropicProviderSpecific | undefined,
):
  | { type: 'adaptive' }
  | { type: 'enabled'; budgetTokens?: number }
  | { type: 'disabled' }
  | undefined {
  if (!ps || ps.thinking === 'off') {
    return { type: 'disabled' };
  }
  if (ps.thinking === 'disabled') {
    return { type: 'disabled' };
  }
  if (ps.thinking === 'enabled') {
    return { type: 'enabled', budgetTokens: ps.thinkingBudget ?? 2048 };
  }
  return { type: ps.thinking ?? 'adaptive' };
}
