import type { LanguageModelUsage } from 'ai';
import type { Usage } from './types.js';

export function usageFromLanguageModelStep(
  usage: LanguageModelUsage,
  providerMetadata: unknown,
): Usage {
  const out: Usage = {
    inputTokens: usage.promptTokens,
    outputTokens: usage.completionTokens,
  };
  const meta = providerMetadata as
    | {
        anthropic?: {
          cacheCreationInputTokens?: number | null;
          cacheReadInputTokens?: number | null;
        };
      }
    | undefined;
  const a = meta?.anthropic;
  if (a) {
    out.cacheCreationTokens = a.cacheCreationInputTokens ?? 0;
    out.cacheReadTokens = a.cacheReadInputTokens ?? 0;
  }
  return out;
}
