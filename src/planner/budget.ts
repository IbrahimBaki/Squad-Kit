import type { BudgetConfig, Usage } from './types.js';

export class Budget {
  private reads = 0;
  private bytes = 0;
  private readonly startedAt = Date.now();
  private totalUsage: Usage = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };

  private maxFileReadsAllowed: number;
  private maxContextBytesAllowed: number;
  private maxWallSeconds: number;

  constructor(public readonly cfg: BudgetConfig) {
    this.maxFileReadsAllowed = cfg.maxFileReads;
    this.maxContextBytesAllowed = cfg.maxContextBytes;
    this.maxWallSeconds = cfg.maxDurationSeconds;
  }

  /** Add another slice of the original config limits (used when the user chooses to continue a planner session). */
  extendSession(): void {
    this.maxFileReadsAllowed += this.cfg.maxFileReads;
    this.maxContextBytesAllowed += this.cfg.maxContextBytes;
    this.maxWallSeconds += this.cfg.maxDurationSeconds;
  }

  canRead(nextFileBytes: number): { ok: boolean; reason?: string } {
    if (this.reads >= this.maxFileReadsAllowed) {
      return { ok: false, reason: `max file reads (${this.maxFileReadsAllowed}) reached` };
    }
    if (this.bytes + nextFileBytes > this.maxContextBytesAllowed) {
      return { ok: false, reason: `context budget (${this.maxContextBytesAllowed} bytes) would be exceeded` };
    }
    return { ok: true };
  }

  /** Whether another tool invocation is allowed under the read-count budget (bytes checked per tool). */
  canExecuteTool(): { ok: boolean; reason?: string } {
    if (this.reads >= this.maxFileReadsAllowed) {
      return { ok: false, reason: `max file reads (${this.maxFileReadsAllowed}) reached` };
    }
    return { ok: true };
  }

  recordRead(bytes: number): void {
    this.reads += 1;
    this.bytes += bytes;
  }

  recordUsage(u: Usage): void {
    this.totalUsage.inputTokens += u.inputTokens;
    this.totalUsage.outputTokens += u.outputTokens;
    this.totalUsage.cacheCreationTokens = (this.totalUsage.cacheCreationTokens ?? 0) + (u.cacheCreationTokens ?? 0);
    this.totalUsage.cacheReadTokens = (this.totalUsage.cacheReadTokens ?? 0) + (u.cacheReadTokens ?? 0);
  }

  timedOut(): boolean {
    return (Date.now() - this.startedAt) / 1000 > this.maxWallSeconds;
  }

  caps(): { maxFileReads: number; maxContextBytes: number; maxDurationSeconds: number } {
    return {
      maxFileReads: this.maxFileReadsAllowed,
      maxContextBytes: this.maxContextBytesAllowed,
      maxDurationSeconds: this.maxWallSeconds,
    };
  }

  snapshot() {
    return {
      reads: this.reads,
      bytes: this.bytes,
      elapsedMs: Date.now() - this.startedAt,
      usage: { ...this.totalUsage },
    };
  }
}
