import type { PlannerRunStats } from '../planner/types.js';

export function formatTokenK(n: number): string {
  return `${(n / 1000).toFixed(1)}k`;
}

export function formatPlannerCacheLine(opts: {
  cacheEnabled: boolean;
  stats: PlannerRunStats;
  /** Anthropic Agent SDK does not surface cache token metrics. */
  plannerRuntimeKind?: 'vercel' | 'agent-sdk';
}): string {
  if (!opts.cacheEnabled) {
    return 'cache disabled';
  }
  if (opts.plannerRuntimeKind === 'agent-sdk') {
    return '(agent-sdk: not exposed)';
  }
  const { stats } = opts;
  if (stats.cacheReadTokens > 0) {
    const pct = Math.round(stats.cacheHitRatio * 100);
    const total = stats.inputTokens + stats.cacheReadTokens;
    const read = formatTokenK(stats.cacheReadTokens);
    const tot = formatTokenK(total);
    const written =
      stats.cacheCreationTokens > 0 ? ` · ${formatTokenK(stats.cacheCreationTokens)} written` : '';
    return `cache hit ${pct}% (${read} read / ${tot} total${written})`;
  }
  return 'cache miss 0% — run `squad doctor` to diagnose';
}
