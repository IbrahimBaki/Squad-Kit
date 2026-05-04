import type { LanguageModelV1 } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { ProviderName } from '../types.js';

export interface ResolvedModel {
  provider: ProviderName;
  model: LanguageModelV1;
  /** Model id used in plan headers and telemetry (same string passed in). */
  modelId: string;
}

export function resolveModel(provider: ProviderName, modelId: string, apiKey: string): ResolvedModel {
  switch (provider) {
    case 'anthropic':
      return { provider, model: createAnthropic({ apiKey })(modelId), modelId };
    case 'openai':
      return { provider, model: createOpenAI({ apiKey })(modelId), modelId };
    case 'google':
      return { provider, model: createGoogleGenerativeAI({ apiKey })(modelId), modelId };
  }
}
