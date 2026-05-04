import type { CoreMessage } from 'ai';
import type { ChatTurn, ProviderName } from './types.js';
import { SCOUTED_USER_MESSAGE_CACHE_SENTINEL } from './system-prompt.js';

export function turnsToCoreMessages(
  systemPrompt: string,
  turns: ChatTurn[],
  opts: { cacheEnabled: boolean; provider: ProviderName },
): CoreMessage[] {
  const { cacheEnabled, provider } = opts;
  const messages: CoreMessage[] = [
    {
      role: 'system',
      content: systemPrompt,
      ...(cacheEnabled && provider === 'anthropic'
        ? { providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } }
        : {}),
    },
  ];

  let lastToolMessageIndex = -1;

  for (const t of turns) {
    if (t.role === 'user') {
      if (t.text !== undefined && t.text.length > 0) {
        const userMsg: CoreMessage = { role: 'user', content: t.text };
        if (
          cacheEnabled &&
          provider === 'anthropic' &&
          t.text.startsWith(SCOUTED_USER_MESSAGE_CACHE_SENTINEL)
        ) {
          (userMsg as CoreMessage & { providerOptions?: object }).providerOptions = {
            anthropic: { cacheControl: { type: 'ephemeral' } },
          };
        }
        messages.push(userMsg);
      }
      if (t.toolResults?.length) {
        const msg: CoreMessage = {
          role: 'tool',
          content: t.toolResults.map((tr) => ({
            type: 'tool-result' as const,
            toolCallId: tr.toolCallId,
            toolName: tr.name,
            result: tr.content,
            ...(tr.isError ? { isError: true as const } : {}),
          })),
        };
        lastToolMessageIndex = messages.push(msg) - 1;
      }
    } else {
      const parts: Array<
        | { type: 'text'; text: string }
        | { type: 'tool-call'; toolCallId: string; toolName: string; args: Record<string, unknown> }
      > = [];
      if (t.text) parts.push({ type: 'text', text: t.text });
      for (const tc of t.toolCalls ?? []) {
        parts.push({
          type: 'tool-call',
          toolCallId: tc.id,
          toolName: tc.name,
          args: tc.input,
        });
      }
      if (parts.length === 0) continue;
      if (parts.length === 1 && parts[0]!.type === 'text') {
        messages.push({ role: 'assistant', content: parts[0]!.text });
      } else {
        messages.push({ role: 'assistant', content: parts });
      }
    }
  }

  if (cacheEnabled && provider === 'anthropic' && lastToolMessageIndex >= 0) {
    const target = messages[lastToolMessageIndex]!;
    if (target.role === 'tool') {
      (target as typeof target & { providerOptions?: object }).providerOptions = {
        anthropic: { cacheControl: { type: 'ephemeral' } },
      };
    }
  }

  return messages;
}
