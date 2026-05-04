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

function streamEventTextDelta(ev: unknown): string {
  if (!ev || typeof ev !== 'object') return '';
  const o = ev as Record<string, unknown>;
  if (o.type === 'content_block_delta') {
    const d = o.delta as Record<string, unknown> | undefined;
    if (d && d.type === 'text_delta' && typeof d.text === 'string') return d.text;
  }
  return '';
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

    try {
      const q = query({
        prompt: input.userMessage,
        options: queryOptions,
      });

      for await (const message of q) {
        const m = message as { type?: string; subtype?: string; event?: unknown; result?: string; usage?: unknown };
        switch (m.type) {
          case 'stream_event': {
            const delta = streamEventTextDelta(m.event);
            if (delta) {
              text += delta;
              input.onAssistantText?.(delta);
              input.bus.emit({ kind: 'assistant_text', runId: input.runId, turn: assistantTurns, delta });
            }
            break;
          }
          case 'assistant': {
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
      persistSession: false,
      settingSources: [] as [],
      env: { ...process.env, ANTHROPIC_API_KEY: this.apiKey },
      thinking,
      effort,
    };

    let usage: Usage = { inputTokens: 0, outputTokens: 0 };

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
        const m = message as { type?: string; usage?: unknown };
        if (m.type === 'result') {
          usage = usageFromAgentSdkResult(
            m.usage as {
              input_tokens?: number | null;
              output_tokens?: number | null;
            },
          );
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
