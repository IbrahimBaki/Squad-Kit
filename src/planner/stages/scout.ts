import { APICallError, NoObjectGeneratedError } from 'ai';
import type { Budget } from '../budget.js';
import { parseRetryAfterSec } from '../provider-errors.js';
import { ScoutOutputSchema, type ScoutOutput } from './scout-schema.js';
import type { PlannerEventBus } from '../events.js';
import type { PlannerRuntime } from '../runtimes/types.js';
import type { AnthropicProviderSpecific } from '../runtimes/types.js';

export { ScoutOutputSchema, type ScoutOutput } from './scout-schema.js';

export async function runScout(input: {
  runtime: PlannerRuntime;
  systemPrompt: string;
  userPrompt: string;
  budget: Budget;
  bus: PlannerEventBus;
  runId: string;
  abort?: AbortSignal;
  maxTokens?: number;
  providerSpecific?: AnthropicProviderSpecific;
}): Promise<{ output: ScoutOutput; usage: { inputTokens: number; outputTokens: number } } | null> {
  const maxTokens = input.maxTokens ?? 2048;
  let attempt = 0;
  while (true) {
    try {
      const result = await input.runtime.runScout({
        systemPrompt: input.systemPrompt,
        userMessage: input.userPrompt,
        schema: ScoutOutputSchema,
        bus: input.bus,
        runId: input.runId,
        abort: input.abort,
        maxOutputTokens: maxTokens,
        providerSpecific: input.providerSpecific,
      });
      if (!result) return null;
      input.budget.recordUsage(result.usage);
      return {
        output: result.output,
        usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
      };
    } catch (e) {
      if (NoObjectGeneratedError.isInstance(e)) {
        return null;
      }
      if (APICallError.isInstance(e) && attempt === 0) {
        const status = e.statusCode ?? 0;
        if (status === 429) {
          const ra = parseRetryAfterSec(e.responseHeaders ?? {});
          if (ra !== undefined && ra <= 90) {
            await new Promise((r) => setTimeout(r, ra * 1000));
            attempt += 1;
            continue;
          }
        }
      }
      throw e;
    }
  }
}
