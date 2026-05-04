import { APICallError, generateObject, NoObjectGeneratedError } from 'ai';
import { z } from 'zod';
import type { LanguageModelV1 } from 'ai';
import type { Budget } from '../budget.js';
import type { ProviderName } from '../types.js';
import { parseRetryAfterSec } from '../provider-errors.js';
import { usageFromLanguageModelStep } from '../usage-map.js';

export const ScoutOutputSchema = z.object({
  selectedFiles: z.array(z.string()).min(1).max(25),
  reasoning: z.string().min(1),
  suggestedReadStrategy: z.enum(['read_full', 'read_ranges', 'mixed']),
  readRanges: z
    .array(
      z.object({
        path: z.string(),
        offset: z.number().int().min(1),
        limit: z.number().int().min(1).max(400),
      }),
    )
    .optional(),
});

export type ScoutOutput = z.infer<typeof ScoutOutputSchema>;

export async function runScout(input: {
  model: LanguageModelV1;
  /** Provider name; used to attach provider-specific request options. */
  provider?: ProviderName;
  systemPrompt: string;
  userPrompt: string;
  budget: Budget;
  abort?: AbortSignal;
  maxTokens?: number;
}): Promise<{ output: ScoutOutput; usage: { inputTokens: number; outputTokens: number } } | null> {
  const maxTokens = input.maxTokens ?? 2048;
  // ai@4.x defaults `temperature: 0` and @ai-sdk/anthropic@1.x always passes it to the wire
  // unless extended thinking is on. Anthropic Opus 4.7+ rejects temperature entirely; enabling
  // thinking strips it via the adapter and gives the scout a small reasoning budget.
  const anthropicThinking =
    input.provider === 'anthropic'
      ? { anthropic: { thinking: { type: 'enabled' as const, budgetTokens: 1024 } } }
      : undefined;

  let attempt = 0;
  while (true) {
    try {
      const { object, usage, providerMetadata } = await generateObject({
        model: input.model,
        system: input.systemPrompt,
        prompt: input.userPrompt,
        schema: ScoutOutputSchema,
        maxTokens,
        abortSignal: input.abort,
        ...(anthropicThinking ? { providerOptions: anthropicThinking } : {}),
      });
      const u = usageFromLanguageModelStep(usage, providerMetadata);
      input.budget.recordUsage(u);
      return {
        output: object,
        usage: { inputTokens: u.inputTokens, outputTokens: u.outputTokens },
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
