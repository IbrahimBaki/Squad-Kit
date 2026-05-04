import { describe, it, expect } from 'vitest';
import { decodeStreamEvent } from '../../../src/planner/runtimes/agent-sdk-runtime.js';

describe('decodeStreamEvent', () => {
  it('parses text_delta', () => {
    expect(
      decodeStreamEvent({
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'hi' },
      }),
    ).toEqual({ kind: 'text_delta', text: 'hi' });
  });

  it('parses thinking_delta', () => {
    expect(
      decodeStreamEvent({
        type: 'content_block_delta',
        delta: { type: 'thinking_delta', thinking: 'reason' },
      }),
    ).toEqual({ kind: 'thinking_delta', text: 'reason' });
  });

  it('parses message_start with usage', () => {
    const d = decodeStreamEvent({
      type: 'message_start',
      message: { usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 5 } },
    });
    expect(d.kind).toBe('message_start');
    if (d.kind === 'message_start') {
      expect(d.usage?.input_tokens).toBe(10);
      expect(d.usage?.output_tokens).toBe(2);
      expect(d.usage?.cache_read_input_tokens).toBe(5);
    }
  });

  it('parses message_delta with output_tokens only', () => {
    const d = decodeStreamEvent({
      type: 'message_delta',
      usage: { output_tokens: 3 },
    });
    expect(d.kind).toBe('message_delta');
    if (d.kind === 'message_delta') {
      expect(d.usage?.output_tokens).toBe(3);
    }
  });

  it('parses content_block_start for text, thinking, tool_use', () => {
    expect(
      decodeStreamEvent({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking' },
      }),
    ).toEqual({ kind: 'content_block_start', blockType: 'thinking', index: 0 });

    expect(
      decodeStreamEvent({
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'text' },
      }),
    ).toEqual({ kind: 'content_block_start', blockType: 'text', index: 1 });

    expect(
      decodeStreamEvent({
        type: 'content_block_start',
        index: 2,
        content_block: { type: 'tool_use' },
      }),
    ).toEqual({ kind: 'content_block_start', blockType: 'tool_use', index: 2 });
  });

  it('parses content_block_stop', () => {
    expect(decodeStreamEvent({ type: 'content_block_stop', index: 0 })).toEqual({
      kind: 'content_block_stop',
      index: 0,
    });
  });

  it('maps unrelated events to other', () => {
    expect(decodeStreamEvent({ type: 'ping' })).toEqual({ kind: 'other' });
    expect(decodeStreamEvent(null)).toEqual({ kind: 'other' });
  });
});
