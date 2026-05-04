import * as ui from '../ui/index.js';
import { dim } from '../ui/theme.js';
import type { PlannerEvent } from '../planner/events.js';
import type { Budget } from '../planner/budget.js';
import type { SquadSpinner } from '../ui/spinner.js';
import type { StageLine } from '../ui/stage-pipeline.js';

export interface NewPlanApiUiDispatchContext {
  sessionSpinner: { current: SquadSpinner | null };
  stageLine: StageLine;
  /** Stage most recently started (used to restore the session spinner after thinking). */
  activePlannerStage: 'scout' | 'draft' | 'validation' | null;
  thinkingBlockChars: number;
  thinkingState: {
    running: boolean;
    blockStartedAt: number;
    /** Sum across thinking blocks in this session (summary). */
    totalChars: number;
    totalDurationMs: number;
  };
  thinkingSpinner: { current: SquadSpinner | null };
  thinkingTick: { id: ReturnType<typeof setInterval> | null };
  budget: Budget;
  budgetCaps: { maxFileReads: number; maxContextBytes: number; maxDurationSeconds: number } | null;
  startedAt: number;
  interactive: boolean;
  stagesIntroPrinted: boolean;
  lastToolUi: { label: string; bytesLoaded: number; totalBytes: number } | null;
  streamedValidationIssues: { count: number };
  validationStreamCappedMsg: boolean;
  anthropicRuntimeChoice?: string;
  /** Token totals from `usage` events when `budget.snapshot()` is still empty (Agent SDK stream). */
  usageAcc: { inputTokens: number; outputTokens: number };
}

function toolLabel(name: string, inp: Record<string, unknown>): string {
  if (name === 'read_file') {
    return `read ${String(inp.path ?? '<unknown>')}`;
  }
  if (name === 'grep') {
    return `grep ${String(inp.pattern ?? '?').slice(0, 48)}`;
  }
  if (name === 'list_dir') {
    return `list_dir ${String(inp.path ?? '?')}`;
  }
  return name;
}

function ensureStagesIntro(ctx: NewPlanApiUiDispatchContext): void {
  if (ctx.stagesIntroPrinted) return;
  ctx.stagesIntroPrinted = true;
  ui.divider('stages');
}

function budgetSnap(ctx: NewPlanApiUiDispatchContext) {
  const snap = ctx.budget.snapshot();
  const caps = ctx.budgetCaps ?? ctx.budget.caps();
  return {
    reads: snap.reads,
    readsCap: caps.maxFileReads,
    bytes: snap.bytes,
    bytesCap: caps.maxContextBytes,
    elapsedMs: Date.now() - ctx.startedAt,
    durationMsCap: caps.maxDurationSeconds * 1000,
  };
}

function printBudgetMeterLine(ctx: NewPlanApiUiDispatchContext): void {
  ui.line(`  ${dim(ui.formatBudgetMeter(budgetSnap(ctx)))}`);
}

function resumeSessionSpinner(ctx: NewPlanApiUiDispatchContext): void {
  const st = ctx.activePlannerStage;
  if (st === 'scout') ctx.sessionSpinner.current = ui.spinner('scouting…');
  else if (st === 'draft') ctx.sessionSpinner.current = ui.spinner('drafting…');
  else if (st === 'validation') ctx.sessionSpinner.current = ui.spinner('validating…');
  else ctx.sessionSpinner.current = ui.spinner('next tool…');
}

function clearThinkingTick(ctx: NewPlanApiUiDispatchContext): void {
  if (ctx.thinkingTick.id) {
    clearInterval(ctx.thinkingTick.id);
    ctx.thinkingTick.id = null;
  }
}

function applyUsagePrefix(ctx: NewPlanApiUiDispatchContext): void {
  if (!ctx.interactive || !ctx.sessionSpinner.current) return;
  const snap = ctx.budget.snapshot().usage;
  const useBudget = snap.inputTokens > 0 || snap.outputTokens > 0;
  const inTok = useBudget ? snap.inputTokens : ctx.usageAcc.inputTokens;
  const outTok = useBudget ? snap.outputTokens : ctx.usageAcc.outputTokens;
  const meter = ui.formatBudgetMeter(budgetSnap(ctx));
  ctx.sessionSpinner.current.setPrefix(`${inTok} in · ${outTok} out · ${meter}  `);
}

/** Apply a planner bus event to the `new-plan --api` terminal UI (interactive or not). */
export function dispatchNewPlanApiPlannerEvent(ctx: NewPlanApiUiDispatchContext, e: PlannerEvent): void {
  switch (e.kind) {
    case 'runtime_info': {
      ctx.budgetCaps = e.budgetCaps;
      if (!e.scoutEnabled) {
        ctx.stageLine.scout = 'skipped';
      }
      if (!e.validationEnabled) {
        ctx.stageLine.validation = 'skipped';
      }
      ui.divider('runtime info');
      ui.kv('provider', e.provider);
      ui.kv('model', e.model);
      ui.kv(
        'runtime',
        `${e.runtimeKind}${e.provider === 'anthropic' && ctx.anthropicRuntimeChoice ? ` (${ctx.anthropicRuntimeChoice})` : ''}`,
      );
      ui.kv('cache', e.cacheEnabled ? 'enabled' : 'disabled');
      ui.kv('scout', e.scoutEnabled ? 'enabled' : 'disabled');
      ui.kv('validation', e.validationEnabled ? 'enabled' : 'disabled');
      const caps = e.budgetCaps;
      ui.kv(
        'budget caps',
        `${caps.maxFileReads} reads · ${(caps.maxContextBytes / 1024).toFixed(0)} KB · ${caps.maxDurationSeconds}s`,
      );
      const anth = e.providerOptions?.anthropic;
      if (e.provider === 'anthropic' && anth) {
        if (anth.effortByPhase?.scout || anth.effortByPhase?.draft) {
          const s = anth.effortByPhase.scout ? `scout ${anth.effortByPhase.scout}` : '';
          const d = anth.effortByPhase.draft ? `draft ${anth.effortByPhase.draft}` : '';
          ui.kv('effort', [s, d].filter(Boolean).join(' · ') || (anth.effort ?? '—'));
        } else if (anth.effort) {
          ui.kv('effort', anth.effort);
        }
        if (anth.thinking && anth.thinking !== 'off') {
          ui.kv('thinking', anth.thinking);
        }
      }
      ensureStagesIntro(ctx);
      ui.printStagePipeline(ctx.stageLine);
      break;
    }
    case 'stage_started': {
      ctx.activePlannerStage = e.stage;
      ensureStagesIntro(ctx);
      ctx.stageLine[e.stage] = 'running';
      ui.printStagePipeline(ctx.stageLine);
      printBudgetMeterLine(ctx);
      ctx.sessionSpinner.current?.stop();
      if (e.stage === 'scout') ctx.sessionSpinner.current = ui.spinner('scouting…');
      else if (e.stage === 'draft') ctx.sessionSpinner.current = ui.spinner('drafting…');
      else if (e.stage === 'validation') ctx.sessionSpinner.current = ui.spinner('validating…');
      applyUsagePrefix(ctx);
      break;
    }
    case 'stage_complete': {
      const st = e.stage;
      ctx.stageLine[st] = e.success ? 'success' : 'failed';
      if (!e.success && e.errorMessage && st === 'scout') {
        ctx.sessionSpinner.current?.stop();
        ui.warning(`scout stage failed: ${e.errorMessage}`);
      }
      ensureStagesIntro(ctx);
      ui.printStagePipeline(ctx.stageLine);
      break;
    }
    case 'tool_call_started':
      break;
    case 'tool_call': {
      const name = e.toolCall.name;
      const inp = e.toolCall.input as Record<string, unknown>;
      ctx.lastToolUi = {
        label: toolLabel(name, inp),
        bytesLoaded: e.bytesLoaded,
        totalBytes: e.totalBytes,
      };
      break;
    }
    case 'tool_call_completed': {
      const pending = ctx.lastToolUi;
      ctx.lastToolUi = null;
      const label = pending?.label ?? toolLabel(e.name, {});
      const bytesLoaded = pending?.bytesLoaded ?? e.bytesLoaded;
      const totalBytes = pending?.totalBytes ?? e.totalBytes;
      const caps = ctx.budgetCaps ?? ctx.budget.caps();
      const kb = `(${(bytesLoaded / 1024).toFixed(1)} KB · ${(totalBytes / 1024).toFixed(1)} KB / ${(caps.maxContextBytes / 1024).toFixed(0)} KB) · tool ${e.durationMs}ms`;
      if (e.isError) {
        ctx.sessionSpinner.current?.fail(
          `${label}  ${kb}${e.errorSnippet ? ` — ${e.errorSnippet}` : ''}`,
        );
      } else {
        ctx.sessionSpinner.current?.succeed(`${label}  ${kb}`);
      }
      ctx.sessionSpinner.current = ui.spinner('next tool…');
      applyUsagePrefix(ctx);
      printBudgetMeterLine(ctx);
      break;
    }
    case 'thinking_block_started': {
      clearThinkingTick(ctx);
      ctx.thinkingState.running = true;
      ctx.thinkingBlockChars = 0;
      ctx.thinkingState.blockStartedAt = Date.now();
      ctx.sessionSpinner.current?.stop();
      ctx.thinkingSpinner.current = ui.spinner('thinking…');
      ctx.thinkingTick.id = setInterval(() => {
        if (!ctx.thinkingSpinner.current) return;
        ctx.thinkingSpinner.current.update(
          ui.formatThinkingLine({
            running: true,
            durationMs: Date.now() - ctx.thinkingState.blockStartedAt,
            chars: ctx.thinkingBlockChars,
          }),
        );
      }, 500);
      break;
    }
    case 'thinking_delta': {
      ctx.thinkingBlockChars += e.delta.length;
      break;
    }
    case 'thinking_block_stopped': {
      clearThinkingTick(ctx);
      ctx.thinkingState.running = false;
      ctx.thinkingSpinner.current?.succeed(
        ui.formatThinkingLine({ running: false, durationMs: e.durationMs, chars: e.chars }),
      );
      ctx.thinkingSpinner.current = null;
      ctx.thinkingState.totalChars += e.chars;
      ctx.thinkingState.totalDurationMs += e.durationMs;
      resumeSessionSpinner(ctx);
      applyUsagePrefix(ctx);
      break;
    }
    case 'usage': {
      ctx.usageAcc.inputTokens += e.usage.inputTokens;
      ctx.usageAcc.outputTokens += e.usage.outputTokens;
      applyUsagePrefix(ctx);
      break;
    }
    case 'validation_issue': {
      if (!ctx.interactive) break;
      ctx.streamedValidationIssues.count += 1;
      const n = ctx.streamedValidationIssues.count;
      if (n <= 50) {
        const pathPart = e.path ? ` ${e.path}` : '';
        const line = `[${e.severity}] ${e.issueKind}${pathPart} — ${e.detail}`;
        if (e.severity === 'error') ui.failure(line);
        else ui.warning(line);
      } else if (!ctx.validationStreamCappedMsg) {
        ctx.validationStreamCappedMsg = true;
        ui.info(`  … +${n - 50} more issues, see summary`);
      }
      break;
    }
    case 'assistant_text': {
      if (ctx.thinkingState.running) return;
      ctx.sessionSpinner.current?.succeed('planner thinking complete (this chunk)');
      ctx.sessionSpinner.current = ui.spinner('thinking…');
      applyUsagePrefix(ctx);
      break;
    }
    case 'rate_limit': {
      if (e.phase === 'retrying') {
        ctx.sessionSpinner.current?.stop();
        ui.warning(`${e.provider} rate limit hit — retrying in ${e.waitSec}s`);
        ctx.sessionSpinner.current = ui.spinner('waiting for rate limit to reset…');
      }
      break;
    }
    case 'scout_result': {
      ctx.activePlannerStage = 'draft';
      const preview = e.selected.slice(0, 4).join(', ');
      const more = e.selected.length > 4 ? '…' : '';
      ctx.sessionSpinner.current?.succeed(`scout picked ${e.selected.length} files: ${preview}${more}`);
      ctx.sessionSpinner.current = ui.spinner('drafting…');
      applyUsagePrefix(ctx);
      break;
    }
    case 'cancelled': {
      clearThinkingTick(ctx);
      ctx.thinkingState.running = false;
      ctx.thinkingSpinner.current?.fail('cancelled');
      ctx.thinkingSpinner.current = null;
      break;
    }
    default:
      break;
  }
}
