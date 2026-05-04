import { describe, it, expect } from 'vitest';
import type { ChatTurn } from '../src/planner/types.js';
import { turnsToCoreMessages } from '../src/planner/core-messages.js';
import { composeScoutedUserMessage } from '../src/planner/system-prompt.js';

describe('Anthropic cache markers via CoreMessage providerOptions', () => {
  it('adds cacheControl to system and last tool message when cacheEnabled', () => {
    const turns: ChatTurn[] = [
      { role: 'user', text: 'u' },
      {
        role: 'assistant',
        toolCalls: [{ id: 'c1', name: 'read_file', input: { path: 'a.ts' } }],
      },
      {
        role: 'user',
        toolResults: [{ toolCallId: 'c1', name: 'read_file', content: 'ok', isError: false }],
      },
    ];
    const msgs = turnsToCoreMessages('system text', turns, { cacheEnabled: true, provider: 'anthropic' });
    const sys = msgs[0]!;
    expect(sys.role).toBe('system');
    expect(sys).toMatchObject({
      providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
    });
    const toolMsg = msgs.filter((m) => m.role === 'tool').pop()!;
    expect(toolMsg).toMatchObject({
      role: 'tool',
      providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
    });
  });

  it('omits cache markers when cacheEnabled is false', () => {
    const turns: ChatTurn[] = [
      { role: 'user', text: 'u' },
      {
        role: 'assistant',
        toolCalls: [{ id: 'c1', name: 'read_file', input: { path: 'a.ts' } }],
      },
      {
        role: 'user',
        toolResults: [{ toolCallId: 'c1', name: 'read_file', content: 'x', isError: false }],
      },
    ];
    const msgs = turnsToCoreMessages('system text', turns, { cacheEnabled: false, provider: 'anthropic' });
    for (const m of msgs) {
      expect(m).not.toHaveProperty('providerOptions');
    }
  });

  it('does not attach Anthropic cache markers for non-anthropic providers', () => {
    const msgs = turnsToCoreMessages('s', [{ role: 'user', text: 'u' }], {
      cacheEnabled: true,
      provider: 'openai',
    });
    expect(msgs[0]!.role).toBe('system');
    expect(msgs[0]!).not.toHaveProperty('providerOptions');
  });

  it('adds cache marker on scouted-context user message when cacheEnabled', () => {
    const scoutedSection = '\n## Scouted context (already loaded)\n\npreview\n';
    const turns: ChatTurn[] = [
      { role: 'user', text: 'user intake' },
      { role: 'user', text: composeScoutedUserMessage({ scoutedSection }) },
    ];
    const msgs = turnsToCoreMessages('system text', turns, { cacheEnabled: true, provider: 'anthropic' });
    const scoped = msgs.filter(
      (m) =>
        m.role === 'user' &&
        'providerOptions' in m &&
        Boolean(
          (m as { providerOptions?: { anthropic?: { cacheControl?: { type?: string } } } }).providerOptions?.anthropic
            ?.cacheControl,
        ),
    );
    expect(scoped.length).toBeGreaterThanOrEqual(1);
  });
});
