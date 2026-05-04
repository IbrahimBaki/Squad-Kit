import { z } from 'zod';
import type {
  PlannerRuntime,
  RunDraftInput,
  RunDraftOutput,
  RunScoutInput,
  RunScoutOutput,
} from './types.js';
import type { Usage } from '../types.js';
import { sdkEffortFromPlanner, thinkingConfigFromProviderSpecific } from './anthropic-options.js';
import { usageFromAgentSdkResult } from '../usage-map.js';
import type { PlannerEventBus } from '../events.js';

const BUILTIN_TOOL_DENY = [
  'Read',
  'Write',
  'Edit',
  'Bash',
  'Grep',
  'Glob',
  'NotebookEdit',
  'WebFetch',
  'WebSearch',
] as const;

export type DecodedStream =
  | { kind: 'text_delta'; text: string }
  | { kind: 'thinking_delta'; text: string }
  | { kind: 'content_block_start'; blockType: 'text' | 'thinking' | 'tool_use'; index: number }
  | { kind: 'content_block_stop'; index: number }
  | {
      kind: 'message_start';
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      };
    }
  | {
      kind: 'message_delta';
      usage?: {
        output_tokens?: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      };
    }
  | { kind: 'other' };

type ThinkingStreamState = {
  blockIndexCounter: number;
  inThinkingBlock: boolean;
  thinkingBlockIndex: number;
  thinkingBlockStartedAt: number;
  thinkingChars: number;
};

function initialThinkingState(): ThinkingStreamState {
  return {
    blockIndexCounter: 0,
    inThinkingBlock: false,
    thinkingBlockIndex: -1,
    thinkingBlockStartedAt: 0,
    thinkingChars: 0,
  };
}

export function decodeStreamEvent(ev: unknown): DecodedStream {
  if (!ev || typeof ev !== 'object') return { kind: 'other' };
  const o = ev as Record<string, unknown>;
  const t = o.type;

  if (t === 'message_start') {
    const msg = o.message as Record<string, unknown> | undefined;
    const u = (msg?.usage ?? o.usage) as Record<string, unknown> | undefined;
    if (!u || typeof u !== 'object') return { kind: 'message_start' };
    return {
      kind: 'message_start',
      usage: {
        input_tokens: num(u.input_tokens),
        output_tokens: num(u.output_tokens),
        cache_creation_input_tokens: num(u.cache_creation_input_tokens),
        cache_read_input_tokens: num(u.cache_read_input_tokens),
      },
    };
  }

  if (t === 'message_delta') {
    const u = o.usage as Record<string, unknown> | undefined;
    if (!u || typeof u !== 'object') return { kind: 'message_delta' };
    return {
      kind: 'message_delta',
      usage: {
        output_tokens: num(u.output_tokens),
        cache_creation_input_tokens: num(u.cache_creation_input_tokens),
        cache_read_input_tokens: num(u.cache_read_input_tokens),
      },
    };
  }

  if (t === 'content_block_start') {
    const idx = typeof o.index === 'number' ? o.index : 0;
    const cb = o.content_block as Record<string, unknown> | undefined;
    const bt = cb?.type;
    if (bt === 'thinking' || bt === 'text' || bt === 'tool_use')
      return { kind: 'content_block_start', blockType: bt, index: idx };
    return { kind: 'other' };
  }

  if (t === 'content_block_stop') {
    return { kind: 'content_block_stop', index: typeof o.index === 'number' ? o.index : 0 };
  }

  if (t === 'content_block_delta') {
    const d = o.delta as Record<string, unknown> | undefined;
    if (!d) return { kind: 'other' };
    const dt = d.type;
    if (dt === 'text_delta' && typeof d.text === 'string') {
      return { kind: 'text_delta', text: d.text };
    }
    if (dt === 'thinking_delta') {
      const th =
        typeof d.thinking === 'string' ? d.thinking : typeof d.text === 'string' ? d.text : '';
      if (th) return { kind: 'thinking_delta', text: th };
    }
  }

  return { kind: 'other' };
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && !Number.isNaN(v) ? v : undefined;
}

function handleDecodedStreamEvent(
  decoded: DecodedStream,
  input: {
    bus: PlannerEventBus;
    runId: string;
    assistantTurns: number;
    onAssistantText?: (delta: string) => void;
    think: ThinkingStreamState;
    textSink?: { append: (s: string) => void };
  },
): void {
  const { bus, runId, onAssistantText, think } = input;
  const turnUse = input.assistantTurns + 1;

  if (decoded.kind === 'message_start' && decoded.usage) {
    const u = decoded.usage;
    const partial: Usage = {
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
    };
    bus.emit({ kind: 'usage', runId, turn: turnUse, usage: partial });
    return;
  }

  if (decoded.kind === 'message_delta' && decoded.usage) {
    const out = decoded.usage.output_tokens ?? 0;
    if (out > 0) {
      bus.emit({
        kind: 'usage',
        runId,
        turn: turnUse,
        usage: { inputTokens: 0, outputTokens: out },
      });
    }
    return;
  }

  if (decoded.kind === 'text_delta') {
    input.textSink?.append(decoded.text);
    onAssistantText?.(decoded.text);
    bus.emit({
      kind: 'assistant_text',
      runId,
      turn: input.assistantTurns,
      delta: decoded.text,
    });
    return;
  }

  if (decoded.kind === 'content_block_start') {
    if (decoded.blockType === 'thinking') {
      think.inThinkingBlock = true;
      think.thinkingBlockIndex = decoded.index;
      think.thinkingChars = 0;
      think.thinkingBlockStartedAt = Date.now();
      think.blockIndexCounter = Math.max(think.blockIndexCounter, decoded.index + 1);
      bus.emit({
        kind: 'thinking_block_started',
        runId,
        turn: input.assistantTurns,
        blockIndex: think.thinkingBlockIndex,
      });
    } else {
      think.inThinkingBlock = false;
    }
    return;
  }

  if (decoded.kind === 'thinking_delta') {
    if (!think.inThinkingBlock) {
      think.thinkingBlockIndex = think.blockIndexCounter++;
      think.thinkingChars = 0;
      think.thinkingBlockStartedAt = Date.now();
      think.inThinkingBlock = true;
      bus.emit({
        kind: 'thinking_block_started',
        runId,
        turn: input.assistantTurns,
        blockIndex: think.thinkingBlockIndex,
      });
    }
    think.thinkingChars += decoded.text.length;
    bus.emit({
      kind: 'thinking_delta',
      runId,
      turn: input.assistantTurns,
      blockIndex: think.thinkingBlockIndex,
      delta: decoded.text,
    });
    return;
  }

  if (decoded.kind === 'content_block_stop') {
    if (think.inThinkingBlock) {
      bus.emit({
        kind: 'thinking_block_stopped',
        runId,
        turn: input.assistantTurns,
        blockIndex: think.thinkingBlockIndex,
        durationMs: Date.now() - think.thinkingBlockStartedAt,
        chars: think.thinkingChars,
      });
      think.inThinkingBlock = false;
      think.thinkingBlockIndex = -1;
    }
  }
}

/**
 * Anthropic-only runtime using `@anthropic-ai/claude-agent-sdk` `query()` and in-process MCP tools.
 */
export class AgentSdkRuntime implements PlannerRuntime {
  readonly kind = 'agent-sdk' as const;
  readonly providerName = 'anthropic' as const;

  constructor(
    readonly modelId: string,
    private readonly apiKey: string,
  ) {}

  async runDraft(input: RunDraftInput): Promise<RunDraftOutput> {
    const { query, createSdkMcpServer, tool } = await import('@anthropic-ai/claude-agent-sdk');

    const sdkTools = input.tools.map((t) =>
      tool(t.name, t.description, this.zodToFieldsObject(t.parameters), async (args) => {
        const r = await t.execute(args as never);
        if (typeof r === 'string') return { content: [{ type: 'text' as const, text: r }] };
        return { content: [{ type: 'text' as const, text: r.content }], isError: r.isError };
      }),
    );

    const mcpServer = createSdkMcpServer({
      name: 'squad-kit-planner',
      version: '1.0.0',
      tools: sdkTools,
    });

    const ps = input.providerSpecific;
    const thinking = thinkingConfigFromProviderSpecific(ps);
    const effort = ps?.effort !== undefined ? sdkEffortFromPlanner(ps.effort) : sdkEffortFromPlanner('medium');

    const ac = new AbortController();
    const onAbort = () => ac.abort();
    if (input.abort) {
      if (input.abort.aborted) ac.abort();
      else input.abort.addEventListener('abort', onAbort, { once: true });
    }

    const queryOptions = {
      model: this.modelId,
      tools: [] as string[],
      disallowedTools: [...BUILTIN_TOOL_DENY],
      mcpServers: { 'squad-kit-planner': mcpServer },
      systemPrompt: input.systemPrompt,
      maxTurns: input.maxSteps,
      includePartialMessages: true,
      persistSession: false,
      settingSources: [] as [],
      abortController: ac,
      env: { ...process.env, ANTHROPIC_API_KEY: this.apiKey },
      thinking,
      effort,
    };

    let text = '';
    let assistantTurns = 0;
    let finalUsage: Usage = { inputTokens: 0, outputTokens: 0 };
    let finishedNormally = false;
    let incompleteKind: RunDraftOutput['incompleteKind'];
    let userCancelled = false;
    const think = initialThinkingState();

    try {
      const q = query({
        prompt: input.userMessage,
        options: queryOptions,
      });

      for await (const message of q) {
        const m = message as { type?: string; subtype?: string; event?: unknown; result?: string; usage?: unknown };
        switch (m.type) {
          case 'stream_event': {
            handleDecodedStreamEvent(decodeStreamEvent(m.event), {
              bus: input.bus,
              runId: input.runId,
              assistantTurns,
              onAssistantText: input.onAssistantText,
              think,
              textSink: { append: (s) => (text += s) },
            });
            break;
          }
          case 'assistant': {
            think.blockIndexCounter = 0;
            think.inThinkingBlock = false;
            think.thinkingBlockIndex = -1;
            think.thinkingChars = 0;
            assistantTurns += 1;
            input.bus.emit({
              kind: 'turn_complete',
              runId: input.runId,
              turn: assistantTurns,
              stopReason: 'tool_use_or_text',
            });
            break;
          }
          case 'result': {
            if (typeof m.result === 'string' && m.result && !text) text = m.result;
            finalUsage = usageFromAgentSdkResult(
              m.usage as {
                input_tokens?: number | null;
                output_tokens?: number | null;
                cache_creation_input_tokens?: number | null;
                cache_read_input_tokens?: number | null;
              },
            );
            const sub = m.subtype;
            if (sub === 'success') {
              finishedNormally = true;
            } else if (sub === 'error_max_turns') {
              incompleteKind = 'max_iterations';
              finishedNormally = false;
            } else if (typeof sub === 'string' && sub.startsWith('error')) {
              finishedNormally = false;
            }
            break;
          }
          case 'system':
            break;
          default:
            break;
        }
      }
    } catch (e) {
      if (e instanceof Error && (e.name === 'AbortError' || ac.signal.aborted)) {
        userCancelled = true;
        input.bus.emit({ kind: 'cancelled', runId: input.runId });
      } else {
        throw e;
      }
    } finally {
      if (input.abort) input.abort.removeEventListener('abort', onAbort);
    }

    input.budget.recordUsage(finalUsage);
    input.onUsage?.(finalUsage);
    input.bus.emit({ kind: 'usage', runId: input.runId, turn: assistantTurns, usage: finalUsage });

    return {
      text,
      finishedNormally: userCancelled ? false : finishedNormally,
      iterations: assistantTurns,
      incompleteKind,
      finalUsage,
      userCancelled: userCancelled || undefined,
    };
  }

  async runScout<TSchema extends z.ZodType>(
    input: RunScoutInput<TSchema>,
  ): Promise<RunScoutOutput<z.infer<TSchema>> | null> {
    const { query, createSdkMcpServer, tool } = await import('@anthropic-ai/claude-agent-sdk');

    let scoutOutput: z.infer<TSchema> | null = null;
    const schemaFields = this.zodToFieldsObject(input.schema);

    const respondTool = tool(
      'respond_with_scout_result',
      'Respond with the scout selection by calling this tool exactly once. Do not call any other tool.',
      schemaFields,
      async (args) => {
        scoutOutput = args as z.infer<TSchema>;
        return { content: [{ type: 'text' as const, text: 'OK — scout result captured.' }] };
      },
    );

    const mcpServer = createSdkMcpServer({
      name: 'squad-kit-scout',
      version: '1.0.0',
      tools: [respondTool],
    });

    const ps = input.providerSpecific;
    const thinking = thinkingConfigFromProviderSpecific(ps);
    const effort = ps?.effort !== undefined ? sdkEffortFromPlanner(ps.effort) : sdkEffortFromPlanner('minimal');

    const queryOptions = {
      model: this.modelId,
      tools: [] as string[],
      disallowedTools: [...BUILTIN_TOOL_DENY],
      mcpServers: { 'squad-kit-scout': mcpServer },
      systemPrompt:
        input.systemPrompt +
        '\n\nIMPORTANT: respond by calling the `respond_with_scout_result` tool with the JSON object — do not write the JSON as text.',
      maxTurns: 2,
      includePartialMessages: true,
      persistSession: false,
      settingSources: [] as [],
      env: { ...process.env, ANTHROPIC_API_KEY: this.apiKey },
      thinking,
      effort,
    };

    let usage: Usage = { inputTokens: 0, outputTokens: 0 };
    let assistantTurns = 0;
    const think = initialThinkingState();

    const ac = new AbortController();
    const onAbort = () => ac.abort();
    if (input.abort) {
      if (input.abort.aborted) ac.abort();
      else input.abort.addEventListener('abort', onAbort, { once: true });
    }

    try {
      const q = query({
        prompt: input.userMessage,
        options: { ...queryOptions, abortController: ac },
      });
      for await (const message of q) {
        const m = message as { type?: string; usage?: unknown; subtype?: string; event?: unknown; result?: string };
        switch (m.type) {
          case 'stream_event':
            handleDecodedStreamEvent(decodeStreamEvent(m.event), {
              bus: input.bus,
              runId: input.runId,
              assistantTurns,
              think,
            });
            break;
          case 'assistant':
            think.blockIndexCounter = 0;
            think.inThinkingBlock = false;
            think.thinkingBlockIndex = -1;
            think.thinkingChars = 0;
            assistantTurns += 1;
            break;
          case 'result':
            usage = usageFromAgentSdkResult(
              m.usage as {
                input_tokens?: number | null;
                output_tokens?: number | null;
                cache_creation_input_tokens?: number | null;
                cache_read_input_tokens?: number | null;
              },
            );
            break;
          case 'system':
            break;
          default:
            break;
        }
      }
    } finally {
      if (input.abort) input.abort.removeEventListener('abort', onAbort);
    }

    if (!scoutOutput) return null;
    const parsed = input.schema.safeParse(scoutOutput);
    if (!parsed.success) return null;
    return { output: parsed.data as z.infer<TSchema>, usage };
  }

  private zodToFieldsObject(schema: z.ZodType): Record<string, z.ZodType> {
    if (schema instanceof z.ZodObject) {
      return schema.shape as Record<string, z.ZodType>;
    }
    return { payload: schema };
  }
}
