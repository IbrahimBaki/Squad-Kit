import path from 'node:path';
import fs from 'node:fs';
import type { LanguageModelV1 } from 'ai';
import { APICallError } from 'ai';
import type {
  ChatTurn,
  PlannerRunStats,
  ProviderName,
  ProviderResponse,
  ToolCall,
  ToolResult,
  Usage,
} from './types.js';
import { Budget } from './budget.js';
import { PlannerUserCancelledError, buildPlannerTools, MAX_BYTES_PER_FULL_READ, looksBinary, readFileTool } from './tools/index.js';
import type { ReadFileResult } from './tools/read-file.js';
import {
  detectModelNotFound,
  detectRateLimit,
  modelNotFoundMessage,
  rateLimitMessage,
} from './provider-errors.js';
import { usageFromLanguageModelStep } from './usage-map.js';
import { turnsToCoreMessages } from './core-messages.js';
import { composeScoutedUserMessage } from './system-prompt.js';
import { DEFAULT_PLANNER_MAX_OUTPUT_TOKENS } from '../core/config.js';
import { newRunId } from '../core/runs.js';
import {
  DEFAULT_PLANNER_MAX_ITERATIONS,
  PLANNER_MARKDOWN_CONTINUATION_USER,
  type PlannerLimitDecision,
  type PlannerSessionLimitContext,
} from './session-limits.js';
import { PlannerEventBus } from './events.js';
import { runScout } from './stages/scout.js';
import { validatePlan, type ValidationIssue } from './validation.js';

/**
 * Upper bound on the auto-retry wait. Chosen to cover the common Anthropic Tier 1 /
 * OpenAI free-tier "wait 60-90s" asks; anything longer means the org is badly over
 * quota and retrying would only burn another request, so we skip and surface guidance.
 */
const MAX_RATE_LIMIT_RETRY_SEC = 90;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

async function sleepWithAbort(
  ms: number,
  sleepFn: (n: number) => Promise<void>,
  abort: AbortSignal | undefined,
): Promise<void> {
  if (!abort) {
    await sleepFn(ms);
    return;
  }
  if (abort.aborted) throw new DOMException('Aborted', 'AbortError');
  await Promise.race([
    sleepFn(ms),
    new Promise<never>((_, reject) => {
      abort.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }),
  ]);
}

export interface RunPlannerInput {
  root: string;
  /** Resolved model handle from `resolveModel`. */
  model: LanguageModelV1;
  /** Provider id for telemetry and rate-limit messages. */
  provider: ProviderName;
  /** Model id string for plan metadata (must match configured / pinned id). */
  modelId: string;
  systemPrompt: string;
  userPrompt: string;
  budget: Budget;
  onToolCall?: (tc: ToolCall, bytesLoaded: number, totalBytes: number) => void;
  onUsage?: (u: Usage) => void;
  onAssistantText?: (delta: string) => void;
  /** Invoked when the loop is about to sleep before retrying a 429. The arg is seconds. */
  onRateLimit?: (waitSec: number) => void;
  maxIterations?: number;
  /** When `false`, disables Anthropic prompt-cache markers. Default `true` when omitted. */
  cacheEnabled?: boolean;
  /** Test injection for `setTimeout`. Defaults to the real timer. */
  sleep?: (ms: number) => Promise<void>;
  /** Per provider request; default 16384 when omitted. */
  maxOutputTokens?: number;
  /**
   * When set, the planner asks before extending limits (extra provider calls = extra cost).
   * When omitted, legacy behaviour: read-budget hits nudge the model to finalise without tools;
   * other hard stops return immediately.
   */
  decideOnLimit?: (ctx: PlannerSessionLimitContext) => Promise<PlannerLimitDecision>;
  /** Optional event bus the caller has set up subscribers on. */
  events?: PlannerEventBus;
  /** Stable id for this run; surfaces in every event for correlation. */
  runId?: string;
  /** Optional cancel signal; loop checks between turns and inside long sleeps. */
  abort?: AbortSignal;
  stages?: {
    scout?: {
      enabled?: boolean;
      model?: LanguageModelV1;
      modelId?: string;
      maxFiles?: number;
      maxOutputTokens?: number;
    };
  };
  validation?: { enabled?: boolean; strict?: boolean };
  toolsEnabled?: { grep?: boolean; listDir?: boolean; rangedRead?: boolean };
  /** When the scout stage runs, this system prompt is composed by the caller (see `composeScoutSystemPrompt`). */
  scoutSystemPrompt?: string;
  /** Markdown assembled after scout; injected as a dedicated cached user turn (not appended to system prompt). */
  scoutedSection?: string;
}

/** Why the loop stopped when `finishedNormally` is false (non-error, non-budget, non-timeout). */
export type PlannerIncompleteKind =
  | 'max_output_tokens'
  | 'max_iterations'
  | 'wall_clock'
  | 'budget_reads';

export interface RunPlannerOutput {
  planText: string;
  budgetExhausted: boolean;
  timedOut: boolean;
  finishedNormally: boolean;
  iterations: number;
  stats: PlannerRunStats;
  incompleteKind?: PlannerIncompleteKind;
  /** User declined to continue after a session limit was hit (only when `decideOnLimit` is set). */
  userCancelled?: boolean;
  scout?: { selected: string[]; reasoning: string; durationMs: number; tokensUsed: number };
  validation?: { issues: ValidationIssue[]; durationMs: number };
  stagesStats: { scout?: PlannerRunStats; draft: PlannerRunStats };
}

/** @internal Result of the draft-stage loop only (before scout/validation orchestration aggregates). */
export interface DraftStageOutput {
  planText: string;
  budgetExhausted: boolean;
  timedOut: boolean;
  finishedNormally: boolean;
  iterations: number;
  stats: PlannerRunStats;
  incompleteKind?: PlannerIncompleteKind;
  userCancelled?: boolean;
}

/** @alias RunPlannerOutput — result object including aggregated cache telemetry from Story 03. */
export type RunPlannerResult = RunPlannerOutput;

export type { PlannerLimitDecision, PlannerSessionLimitContext, PlannerSessionLimitKind } from './session-limits.js';

function buildPlannerRunStats(budget: Budget, turns: number, runStartedAt: number): PlannerRunStats {
  const u = budget.snapshot().usage;
  const cacheRead = u.cacheReadTokens ?? 0;
  const cacheCreate = u.cacheCreationTokens ?? 0;
  const inTok = u.inputTokens;
  const outTok = u.outputTokens;
  const totalInput = inTok + cacheRead;
  const cacheHitRatio = totalInput === 0 ? 0 : Math.round((cacheRead / totalInput) * 100) / 100;
  return {
    turns,
    inputTokens: inTok,
    outputTokens: outTok,
    cacheCreationTokens: cacheCreate,
    cacheReadTokens: cacheRead,
    cacheHitRatio,
    durationMs: Date.now() - runStartedAt,
  };
}

export function buildScoutedContextSection(
  root: string,
  budget: Budget,
  selectedFiles: string[],
  bus: PlannerEventBus,
  runId: string,
  readRanges?: Array<{ path: string; offset: number; limit: number }>,
): string {
  const normalizeRel = (p: string) => p.replace(/^\.\//, '');
  const rangeByPath = new Map<string, { offset: number; limit: number }>();
  for (const rr of readRanges ?? []) {
    rangeByPath.set(normalizeRel(rr.path), rr);
  }

  const ordered: string[] = [];
  const seenPath = new Set<string>();
  for (const f of selectedFiles) {
    const c = normalizeRel(f);
    if (!seenPath.has(c)) {
      seenPath.add(c);
      ordered.push(c);
    }
  }
  for (const p of rangeByPath.keys()) {
    if (!seenPath.has(p)) {
      seenPath.add(p);
      ordered.push(p);
    }
  }

  const blocks: string[] = ['\n## Scouted context (already loaded)\n'];

  for (const cleaned of ordered) {
    const rr = rangeByPath.get(cleaned);
    if (rr) {
      const result = readFileTool(root, budget, { path: cleaned, offset: rr.offset, limit: rr.limit });
      const hi = rr.offset + rr.limit - 1;
      if (result.isError) {
        blocks.push(
          `\n### \`${cleaned}\` (lines ${rr.offset}–${hi})\n\n_${result.content}_\n`,
        );
      } else {
        blocks.push(
          `\n### \`${cleaned}\` (lines ${rr.offset}–${hi})\n\n\`\`\`\n${result.content}\n\`\`\`\n`,
        );
      }
      continue;
    }

    const resolved = path.resolve(root, cleaned);
    const rc = path.relative(root, resolved);
    if (rc.startsWith('..') || path.isAbsolute(rc)) {
      bus.emit({
        kind: 'validation_issue',
        runId,
        severity: 'warning',
        issueKind: 'missing_path',
        path: cleaned,
        detail: 'Scout-selected path escapes the project root',
      });
      continue;
    }
    if (!fs.existsSync(resolved)) {
      bus.emit({
        kind: 'validation_issue',
        runId,
        severity: 'warning',
        issueKind: 'missing_path',
        path: cleaned,
        detail: 'Scout selected this path but it does not exist on disk',
      });
      continue;
    }
    const st = fs.statSync(resolved);
    if (!st.isFile()) continue;
    const n = Math.min(st.size, MAX_BYTES_PER_FULL_READ);
    const cap = budget.canRead(n);
    if (!cap.ok) {
      blocks.push(`\n### \`${cleaned}\`\n\n_(skipped: ${cap.reason})_\n`);
      continue;
    }
    let buf: Buffer;
    try {
      buf = fs.readFileSync(resolved);
    } catch {
      continue;
    }
    if (buf.length > MAX_BYTES_PER_FULL_READ) {
      const head = buf.subarray(0, MAX_BYTES_PER_FULL_READ);
      if (looksBinary(head)) {
        blocks.push(`\n### \`${cleaned}\`\n\n_(binary file skipped)_\n`);
        continue;
      }
      budget.recordRead(head.length);
      blocks.push(
        `\n### \`${cleaned}\` (truncated: first ${MAX_BYTES_PER_FULL_READ}-byte head; full size ${buf.length} bytes)\n\n\`\`\`\n${head.toString('utf8')}\n\`\`\`\n`,
      );
      continue;
    }
    if (looksBinary(buf)) {
      blocks.push(`\n### \`${cleaned}\`\n\n_(binary file skipped)_\n`);
      continue;
    }
    budget.recordRead(buf.length);
    blocks.push(`\n### \`${cleaned}\`\n\n\`\`\`\n${buf.toString('utf8')}\n\`\`\`\n`);
  }
  return blocks.join('');
}

function scoutStageStats(usage: { inputTokens: number; outputTokens: number }, durationMs: number): PlannerRunStats {
  return {
    turns: 0,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    cacheHitRatio: 0,
    durationMs,
  };
}

function readBudgetishError(result: ReadFileResult): boolean {
  return result.isError && (/budget/i.test(result.content) || /max file reads/i.test(result.content));
}

function extendAllSessionLimits(
  input: RunPlannerInput,
  maxIter: { current: number },
  maxOut: { current: number },
  baseMaxIter: number,
  baseMaxOut: number,
): void {
  input.budget.extendSession();
  maxIter.current += baseMaxIter;
  maxOut.current += baseMaxOut;
}

function recordUsageAndEmit(
  bus: PlannerEventBus,
  input: RunPlannerInput,
  runId: string,
  turn: number,
  usage: Usage,
): void {
  input.budget.recordUsage(usage);
  input.onUsage?.(usage);
  bus.emit({ kind: 'usage', runId, turn, usage });
  const u = input.budget.snapshot().usage;
  const cacheRead = u.cacheReadTokens ?? 0;
  const cacheCreate = u.cacheCreationTokens ?? 0;
  if (cacheRead > 0 || cacheCreate > 0) {
    const inTok = u.inputTokens;
    const totalInput = inTok + cacheRead;
    const cacheHitRatio = totalInput === 0 ? 0 : Math.round((cacheRead / totalInput) * 100) / 100;
    bus.emit({
      kind: 'cache_summary',
      runId,
      turn,
      cacheHitRatio,
      cacheReadTokens: cacheRead,
      cacheCreationTokens: cacheCreate,
    });
  }
}

function cancelledOutput(
  input: RunPlannerInput,
  bus: PlannerEventBus,
  runId: string,
  accumulatedText: string,
  budgetExhausted: boolean,
  iterations: number,
  runStartedAt: number,
): DraftStageOutput {
  bus.emit({ kind: 'cancelled', runId });
  return {
    planText: accumulatedText,
    budgetExhausted,
    timedOut: false,
    finishedNormally: false,
    iterations,
    stats: buildPlannerRunStats(input.budget, iterations, runStartedAt),
    userCancelled: true,
  };
}

function asToolInput(args: unknown): Record<string, unknown> {
  if (args && typeof args === 'object' && !Array.isArray(args)) return args as Record<string, unknown>;
  if (typeof args === 'string') {
    try {
      return JSON.parse(args) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

function normalizeToolExecutionResult(result: unknown): { content: string; isError: boolean } {
  if (typeof result === 'string') {
    try {
      const j = JSON.parse(result) as unknown;
      if (j && typeof j === 'object' && !Array.isArray(j) && 'content' in j) {
        const o = j as { content?: unknown; isError?: unknown };
        return {
          content: typeof o.content === 'string' ? o.content : JSON.stringify(o.content ?? ''),
          isError: o.isError === true,
        };
      }
    } catch {
      /* plain tool-result string */
    }
    return { content: result, isError: false };
  }
  if (result && typeof result === 'object' && !Array.isArray(result) && 'content' in result) {
    const o = result as { content?: unknown; isError?: unknown };
    return {
      content: typeof o.content === 'string' ? o.content : JSON.stringify(o.content ?? ''),
      isError: o.isError === true,
    };
  }
  return { content: typeof result === 'undefined' ? '' : JSON.stringify(result), isError: false };
}

function applyStepToTurns(
  turns: ChatTurn[],
  step: {
    text: string;
    toolCalls: Array<{ toolCallId: string; toolName: string; args: unknown }>;
    toolResults: Array<{ toolCallId: string; result: unknown }>;
  },
): void {
  const callsById = new Map<string, string>();
  const toolCalls: ToolCall[] = step.toolCalls.map((tc) => {
    callsById.set(tc.toolCallId, tc.toolName);
    return { id: tc.toolCallId, name: tc.toolName, input: asToolInput(tc.args) };
  });
  turns.push({
    role: 'assistant',
    ...(step.text ? { text: step.text } : {}),
    ...(toolCalls.length ? { toolCalls } : {}),
  });
  if (step.toolResults.length) {
    const toolResults: ToolResult[] = step.toolResults.map((tr) => {
      const norm = normalizeToolExecutionResult(tr.result);
      return {
        toolCallId: tr.toolCallId,
        name: callsById.get(tr.toolCallId) ?? 'read_file',
        content: norm.content,
        ...(norm.isError ? { isError: true as const } : {}),
      };
    });
    turns.push({ role: 'user', toolResults });
  }
}

function providerResponseFromApiError(
  provider: ProviderName,
  modelId: string,
  err: APICallError,
): ProviderResponse {
  const body = err.responseBody ?? '';
  const nf = detectModelNotFound(provider, modelId, err.statusCode ?? 0, body);
  if (nf) {
    return {
      stopReason: 'error',
      errorKind: 'model_not_found',
      rawError: modelNotFoundMessage(nf),
    };
  }
  const rl = detectRateLimit(provider, err.statusCode ?? 0, err.responseHeaders ?? {}, body);
  if (rl) {
    return {
      stopReason: 'error',
      errorKind: 'rate_limit',
      retryAfterSec: rl.retryAfterSec,
      rawError: `${provider} ${err.statusCode ?? 'error'}: ${body.slice(0, 500)}`,
    };
  }
  return {
    stopReason: 'error',
    rawError: `${provider} ${err.statusCode ?? 'error'}: ${body.slice(0, 500)}`,
  };
}

async function runDraftStage(input: RunPlannerInput): Promise<DraftStageOutput> {
  const runStartedAt = Date.now();
  const bus = input.events ?? new PlannerEventBus();
  const runId = input.runId ?? newRunId();
  const cacheEnabled = input.cacheEnabled ?? true;

  const baseMaxIter = input.maxIterations ?? DEFAULT_PLANNER_MAX_ITERATIONS;
  const maxIter = { current: baseMaxIter };
  const baseMaxOut = input.maxOutputTokens ?? DEFAULT_PLANNER_MAX_OUTPUT_TOKENS;
  const maxOut = { current: baseMaxOut };
  const turns: ChatTurn[] = [{ role: 'user', text: input.userPrompt }];
  if (input.scoutedSection?.trim()) {
    turns.push({ role: 'user', text: composeScoutedUserMessage({ scoutedSection: input.scoutedSection }) });
  }
  let accumulatedText = '';
  let iterations = 0;
  let budgetExhausted = false;
  let finishedNormally = false;
  const decide = input.decideOnLimit;
  const sleepFn = input.sleep ?? defaultSleep;

  const limitCtx = (kind: PlannerSessionLimitContext['kind']): PlannerSessionLimitContext => ({
    kind,
    budgetSnapshot: input.budget.snapshot(),
    iterations,
    maxIterations: maxIter.current,
    maxOutputTokens: maxOut.current,
  });

  for (;;) {
    if (input.abort?.aborted) {
      return cancelledOutput(input, bus, runId, accumulatedText, budgetExhausted, iterations, runStartedAt);
    }

    if (iterations >= maxIter.current) {
      if (decide) {
        const d = await decide(limitCtx('max_iterations'));
        if (d === 'cancel') {
          return {
            planText: accumulatedText,
            budgetExhausted,
            timedOut: false,
            finishedNormally: false,
            iterations,
            stats: buildPlannerRunStats(input.budget, iterations, runStartedAt),
            incompleteKind: 'max_iterations',
            userCancelled: true,
          };
        }
        extendAllSessionLimits(input, maxIter, maxOut, baseMaxIter, baseMaxOut);
        continue;
      }
      return {
        planText: accumulatedText,
        budgetExhausted,
        timedOut: false,
        finishedNormally: false,
        iterations,
        stats: buildPlannerRunStats(input.budget, iterations, runStartedAt),
        incompleteKind: 'max_iterations',
      };
    }

    iterations += 1;

    if (input.budget.timedOut()) {
      if (decide) {
        const d = await decide(limitCtx('wall_clock'));
        if (d === 'cancel') {
          return {
            planText: accumulatedText,
            budgetExhausted,
            timedOut: true,
            finishedNormally: false,
            iterations,
            stats: buildPlannerRunStats(input.budget, iterations, runStartedAt),
            incompleteKind: 'wall_clock',
            userCancelled: true,
          };
        }
        extendAllSessionLimits(input, maxIter, maxOut, baseMaxIter, baseMaxOut);
        iterations -= 1;
        continue;
      }
      return {
        planText: accumulatedText,
        budgetExhausted,
        timedOut: true,
        finishedNormally: false,
        iterations,
        stats: buildPlannerRunStats(input.budget, iterations, runStartedAt),
      };
    }

    if (iterations >= 2) {
      bus.emit({ kind: 'turn_started', runId, turn: iterations });
    }

    const tools = buildPlannerTools({
      root: input.root,
      budget: input.budget,
      enabled: {
        grep: input.toolsEnabled?.grep ?? true,
        listDir: input.toolsEnabled?.listDir ?? true,
        rangedRead: input.toolsEnabled?.rangedRead ?? true,
      },
      readHooks: {
        runId,
        turn: iterations,
        bus,
        onToolCall: input.onToolCall,
        decideOnLimit: input.decideOnLimit,
        getLimitCtx: () => limitCtx('file_or_context_reads'),
        extendSessionLimits: () => extendAllSessionLimits(input, maxIter, maxOut, baseMaxIter, baseMaxOut),
        getAccumulatedText: () => accumulatedText,
        setBudgetExhausted: (v) => {
          budgetExhausted = v;
        },
      },
    });

    const messages = turnsToCoreMessages(input.systemPrompt, turns, {
      cacheEnabled,
      provider: input.provider,
    });

    bus.emit({ kind: 'request_sent', runId, turn: iterations });

    let attempt = 0;
    let stepResult!: {
      text: string;
      finishReason: string;
      toolCalls: Array<{ toolCallId: string; toolName: string; args: unknown }>;
      toolResults: Array<{ toolCallId: string; result: unknown }>;
      usage: import('ai').LanguageModelUsage;
      providerMetadata: unknown;
    };
    let retrySkippedReason: 'retry_after_too_long' | undefined;
    let retriedRateLimit = false;

    const callStream = async (): Promise<void> => {
      const { streamText } = await import('ai');
      const stream = streamText({
        model: input.model,
        messages,
        tools,
        toolChoice: 'auto',
        maxSteps: 1,
        maxRetries: 0,
        maxTokens: maxOut.current,
        abortSignal: input.abort,
        // ai@4.x defaults `temperature: 0` (prepareCallSettings) and @ai-sdk/anthropic@1.x
        // always passes it to the wire unless extended thinking is on. Anthropic Opus 4.7+
        // rejects temperature entirely. Enabling thinking on Anthropic strips temperature
        // via the adapter and gives the planner reasoning budget for free.
        ...(input.provider === 'anthropic' && {
          providerOptions: {
            anthropic: { thinking: { type: 'enabled' as const, budgetTokens: 2048 } },
          },
        }),
        onChunk: ({ chunk }) => {
          if (chunk.type === 'text-delta') {
            accumulatedText += chunk.textDelta;
            input.onAssistantText?.(chunk.textDelta);
            bus.emit({ kind: 'assistant_text', runId, turn: iterations, delta: chunk.textDelta });
          }
        },
        onStepFinish: (step) => {
          const u = usageFromLanguageModelStep(step.usage, step.providerMetadata);
          recordUsageAndEmit(bus, input, runId, iterations, u);
        },
      });
      // `consumeStream()` swallows errors and never rejects; if `doStream` throws before any
      // `step-finish`, `stream.steps` never settles. Drain `fullStream` and rethrow error parts.
      for await (const part of stream.fullStream) {
        const p = part as { type?: string; error?: unknown };
        if (p.type === 'error') {
          throw p.error;
        }
      }
      const steps = await stream.steps;
      const last = steps[steps.length - 1];
      if (!last) throw new Error('planner: empty model step');
      stepResult = {
        text: last.text,
        finishReason: last.finishReason,
        toolCalls: last.toolCalls.flatMap((tc) =>
          tc
            ? [
                {
                  toolCallId: tc.toolCallId,
                  toolName: tc.toolName,
                  args: tc.args,
                },
              ]
            : [],
        ),
        toolResults: last.toolResults.flatMap((tr) =>
          tr ? [{ toolCallId: tr.toolCallId, result: tr.result }] : [],
        ),
        usage: last.usage,
        providerMetadata: last.providerMetadata,
      };
    };

    try {
      while (true) {
        try {
          await callStream();
          break;
        } catch (e) {
          if (PlannerUserCancelledError.is(e)) {
            return {
              planText: e.planText,
              budgetExhausted: false,
              timedOut: false,
              finishedNormally: false,
              iterations,
              stats: buildPlannerRunStats(input.budget, iterations, runStartedAt),
              incompleteKind: 'budget_reads',
              userCancelled: true,
            };
          }
          if (isAbortError(e)) {
            return cancelledOutput(input, bus, runId, accumulatedText, budgetExhausted, iterations, runStartedAt);
          }
          if (APICallError.isInstance(e)) {
            const synthetic = providerResponseFromApiError(input.provider, input.modelId, e);
            if (synthetic.errorKind === 'rate_limit') {
              const asked = synthetic.retryAfterSec;
              const emitRateLimit = (phase: 'retrying' | 'aborted', waitSec: number) => {
                bus.emit({
                  kind: 'rate_limit',
                  runId,
                  turn: iterations,
                  retryAfterSec: synthetic.retryAfterSec,
                  waitSec,
                  capSec: MAX_RATE_LIMIT_RETRY_SEC,
                  phase,
                  provider: input.provider,
                  rawBody: (synthetic.rawError ?? '').slice(0, 200),
                });
              };
              if (asked !== undefined && asked > MAX_RATE_LIMIT_RETRY_SEC) {
                emitRateLimit('aborted', asked);
                retrySkippedReason = 'retry_after_too_long';
                throw composePlannerError(input.provider, synthetic, false, retrySkippedReason);
              }
              if (attempt === 0) {
                const waitSec = Math.min(asked ?? 10, MAX_RATE_LIMIT_RETRY_SEC);
                emitRateLimit('retrying', waitSec);
                input.onRateLimit?.(waitSec);
                await sleepWithAbort(waitSec * 1000, sleepFn, input.abort);
                attempt += 1;
                retriedRateLimit = true;
                continue;
              }
              throw composePlannerError(input.provider, synthetic, true, retrySkippedReason);
            }
            throw composePlannerError(input.provider, synthetic, retriedRateLimit, retrySkippedReason);
          }
          throw e;
        }
      }
    } catch (e) {
      if (isAbortError(e)) {
        return cancelledOutput(input, bus, runId, accumulatedText, budgetExhausted, iterations, runStartedAt);
      }
      throw e;
    }

    const finishReason = stepResult.finishReason;
    const toolCallsLen = stepResult.toolCalls.length;

    if (finishReason === 'length' && toolCallsLen === 0) {
      bus.emit({ kind: 'turn_complete', runId, turn: iterations, stopReason: 'max_tokens' });
      if (decide) {
        const d = await decide(limitCtx('max_output_tokens'));
        if (d === 'cancel') {
          return {
            planText: accumulatedText,
            budgetExhausted,
            timedOut: false,
            finishedNormally: false,
            iterations,
            stats: buildPlannerRunStats(input.budget, iterations, runStartedAt),
            incompleteKind: 'max_output_tokens',
            userCancelled: true,
          };
        }
        extendAllSessionLimits(input, maxIter, maxOut, baseMaxIter, baseMaxOut);
        applyStepToTurns(turns, stepResult);
        turns.push({ role: 'user', text: PLANNER_MARKDOWN_CONTINUATION_USER });
        iterations -= 1;
        continue;
      }
      return {
        planText: accumulatedText,
        budgetExhausted,
        timedOut: false,
        finishedNormally: false,
        iterations,
        stats: buildPlannerRunStats(input.budget, iterations, runStartedAt),
        incompleteKind: 'max_output_tokens',
      };
    }

    if (finishReason === 'error' || finishReason === 'content-filter') {
      throw new Error(
        stepResult.text ||
          `planner: model reported ${finishReason}. Run \`squad doctor\` to diagnose, or retry \u2014 most 5xx errors are transient.`,
      );
    }

    if ((finishReason === 'stop' || finishReason === 'unknown') && toolCallsLen === 0) {
      bus.emit({ kind: 'turn_complete', runId, turn: iterations, stopReason: finishReason });
      finishedNormally = true;
      return {
        planText: accumulatedText,
        budgetExhausted,
        timedOut: false,
        finishedNormally,
        iterations,
        stats: buildPlannerRunStats(input.budget, iterations, runStartedAt),
      };
    }

    if (toolCallsLen === 0) {
      bus.emit({ kind: 'turn_complete', runId, turn: iterations, stopReason: finishReason });
      finishedNormally = true;
      return {
        planText: accumulatedText,
        budgetExhausted,
        timedOut: false,
        finishedNormally,
        iterations,
        stats: buildPlannerRunStats(input.budget, iterations, runStartedAt),
      };
    }

    applyStepToTurns(turns, stepResult);

    if (budgetExhausted) {
      turns.push({
        role: 'user',
        text:
          'Budget is exhausted. Finalise the plan with the information you already have. ' +
          'Do not call any more tools. Output the complete plan markdown now.',
      });
    }

    bus.emit({ kind: 'turn_complete', runId, turn: iterations, stopReason: finishReason });
  }
}

export async function runPlanner(input: RunPlannerInput): Promise<RunPlannerOutput> {
  const bus = input.events ?? new PlannerEventBus();
  const runId = input.runId ?? newRunId();
  const cacheEnabled = input.cacheEnabled ?? true;
  bus.emit({
    kind: 'started',
    runId,
    provider: input.provider,
    model: input.modelId,
    cacheEnabled,
  });

  const merged: RunPlannerInput = { ...input, events: bus, runId };
  const systemPrompt = input.systemPrompt;
  let scoutSummary: RunPlannerOutput['scout'];
  let scoutStats: PlannerRunStats | undefined;
  let scoutedSection: string | undefined;

  const scoutOn = input.stages?.scout?.enabled !== false;
  const scoutModel = input.stages?.scout?.model;
  const maxScoutFiles = input.stages?.scout?.maxFiles ?? 12;
  const scoutMaxOut = input.stages?.scout?.maxOutputTokens ?? 2048;
  const scoutModelIdStr = input.stages?.scout?.modelId ?? '';

  if (scoutOn && scoutModel) {
    if (!input.scoutSystemPrompt?.trim()) {
      throw new Error(
        'planner: scout enabled but `scoutSystemPrompt` was not provided. ' +
          'Compose it via composeScoutSystemPrompt() or set stages.scout.enabled = false.',
      );
    }
    const t0 = Date.now();
    bus.emit({ kind: 'stage_started', runId, stage: 'scout' });
    try {
      const scoutRes = await runScout({
        model: scoutModel,
        provider: input.provider,
        systemPrompt: input.scoutSystemPrompt,
        userPrompt: input.userPrompt,
        budget: input.budget,
        abort: input.abort,
        maxTokens: scoutMaxOut,
      });
      const durationMs = Date.now() - t0;
      if (scoutRes) {
        const files = scoutRes.output.selectedFiles.slice(0, maxScoutFiles);
        const tokensUsed = scoutRes.usage.inputTokens + scoutRes.usage.outputTokens;
        scoutSummary = {
          selected: files,
          reasoning: scoutRes.output.reasoning,
          durationMs,
          tokensUsed,
        };
        scoutStats = scoutStageStats(scoutRes.usage, durationMs);
        bus.emit({
          kind: 'scout_result',
          runId,
          selected: files,
          reasoning: scoutRes.output.reasoning,
        });
        scoutedSection = buildScoutedContextSection(
          input.root,
          input.budget,
          files,
          bus,
          runId,
          scoutRes.output.readRanges,
        );
        bus.emit({
          kind: 'stage_complete',
          runId,
          stage: 'scout',
          success: true,
          durationMs,
          tokensUsed,
        });
      } else {
        bus.emit({
          kind: 'stage_complete',
          runId,
          stage: 'scout',
          success: false,
          durationMs,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (APICallError.isInstance(err)) {
        const status = err.statusCode ?? 0;
        if (status === 401 || status === 403) {
          throw err;
        }
        if (
          detectModelNotFound(input.provider, scoutModelIdStr, status, err.responseBody ?? '')
        ) {
          throw err;
        }
      }
      bus.emit({
        kind: 'stage_complete',
        runId,
        stage: 'scout',
        success: false,
        durationMs: Date.now() - t0,
        errorMessage: msg.slice(0, 200),
      });
    }
  }

  const draftStarted = Date.now();
  bus.emit({ kind: 'stage_started', runId, stage: 'draft' });
  const draft = await runDraftStage({ ...merged, systemPrompt, scoutedSection });
  bus.emit({
    kind: 'stage_complete',
    runId,
    stage: 'draft',
    success: draft.finishedNormally && !draft.timedOut && !draft.userCancelled,
    durationMs: Date.now() - draftStarted,
  });

  const validationOn = input.validation?.enabled !== false;
  let issues: ValidationIssue[] = [];
  let validationDurationMs = 0;
  if (validationOn && draft.planText.trim()) {
    const v0 = Date.now();
    bus.emit({ kind: 'stage_started', runId, stage: 'validation' });
    issues = validatePlan({ root: input.root, planText: draft.planText });
    for (const iss of issues.slice(0, 100)) {
      bus.emit({
        kind: 'validation_issue',
        runId,
        severity: iss.severity,
        issueKind: iss.kind,
        path: iss.path,
        detail: iss.detail,
        excerpt: iss.excerpt,
      });
    }
    validationDurationMs = Date.now() - v0;
    bus.emit({
      kind: 'stage_complete',
      runId,
      stage: 'validation',
      success: true,
      durationMs: validationDurationMs,
    });
  }

  return {
    ...draft,
    stats: draft.stats,
    stagesStats: { scout: scoutStats, draft: draft.stats },
    scout: scoutSummary,
    validation: validationOn
      ? { issues, durationMs: validationDurationMs }
      : { issues: [], durationMs: 0 },
  };
}

export function relativisePath(root: string, p: string): string {
  return path.relative(root, p) || p;
}

function composePlannerError(
  providerName: ProviderName,
  response: ProviderResponse,
  retriedRateLimit: boolean,
  retrySkippedReason?: 'retry_after_too_long',
): Error {
  if (response.errorKind === 'rate_limit') {
    return new Error(
      rateLimitMessage({
        provider: providerName,
        retryAfterSec: response.retryAfterSec,
        rawBody: response.rawError ?? '',
        retryAlreadyAttempted: retriedRateLimit,
        retrySkippedReason,
        maxRetrySec: MAX_RATE_LIMIT_RETRY_SEC,
      }),
    );
  }
  if (response.errorKind === 'model_not_found') {
    return new Error(response.rawError ?? 'planner: model not found');
  }
  const base = response.rawError ?? 'planner: provider error';
  return new Error(`${base} Run \`squad doctor\` to diagnose, or retry \u2014 most 5xx errors are transient.`);
}
