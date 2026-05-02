import type { ToolCall, Usage, PlannerRunStats, ProviderName } from './types.js';

export type PlannerEvent =
  | { kind: 'started'; runId: string; provider: string; model: string; cacheEnabled: boolean }
  | { kind: 'turn_started'; runId: string; turn: number }
  | { kind: 'request_sent'; runId: string; turn: number }
  | { kind: 'usage'; runId: string; turn: number; usage: Usage }
  | {
      kind: 'cache_summary';
      runId: string;
      turn: number;
      cacheHitRatio: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
    }
  | { kind: 'tool_call'; runId: string; turn: number; toolCall: ToolCall; bytesLoaded: number; totalBytes: number }
  | { kind: 'assistant_text'; runId: string; turn: number; delta: string }
  | {
      kind: 'rate_limit';
      runId: string;
      turn: number;
      /** Seconds the provider asked us to wait. Source-of-truth countdown. */
      retryAfterSec: number | undefined;
      /** Seconds we will actually sleep before retrying. Equals min(retryAfterSec, cap). */
      waitSec: number;
      /** Our retry cap. Lets the UI explain "we'll retry up to <cap>s". */
      capSec: number;
      /** 'retrying' = the loop is sleeping then retrying. 'aborted' = retryAfterSec > capSec, the loop will throw next. */
      phase: 'retrying' | 'aborted';
      provider: ProviderName;
      /** Same `Raw provider response` snippet as in the CLI message, capped at 200 chars. */
      rawBody?: string;
    }
  | { kind: 'turn_complete'; runId: string; turn: number; stopReason: string }
  | {
      kind: 'done';
      runId: string;
      success: boolean;
      planFile: string | null;
      partial: boolean;
      stats: PlannerRunStats;
      durationMs: number;
    }
  | { kind: 'error'; runId: string; message: string }
  | { kind: 'cancelled'; runId: string };

export type PlannerEventListener = (e: PlannerEvent) => void;

export class PlannerEventBus {
  private listeners = new Set<PlannerEventListener>();
  emit(e: PlannerEvent): void {
    for (const fn of this.listeners) {
      try {
        fn(e);
      } catch {
        /* listener errors must not break the loop */
      }
    }
  }
  subscribe(fn: PlannerEventListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
