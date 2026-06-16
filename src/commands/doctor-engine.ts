import fs from 'node:fs';
import path from 'node:path';
import { type SquadPaths } from '../core/paths.js';
import { loadConfig, type SquadConfig } from '../core/config.js';
import { loadSecrets, type SquadSecrets } from '../core/secrets.js';
import { ensureGitignore, SQUAD_TRASH_PATTERN } from '../core/gitignore.js';
import { modelFor } from '../core/planner-models.js';
import { clientFor, overlayTrackerEnv, type ClientResolutionError } from '../tracker/index.js';
import {
  probeJiraConnectivity,
  probeAzureConnectivity,
  probeGitHubConnectivity,
} from '../core/probes.js';
import { readLastRun } from '../core/last-run.js';
import { formatTokenK } from '../ui/planner-cache-summary.js';

export interface CheckResult {
  id: string;
  name: string;
  status: 'ok' | 'warn' | 'fail' | 'skip';
  detail?: string;
  fixHint?: string;
  fixable?: boolean;
}

export interface DoctorContext {
  config?: SquadConfig;
  configError?: Error;
  secrets?: SquadSecrets;
  secretsError?: Error;
  hasLegacyPromptsDir: boolean;
}

export async function gatherContext(paths: SquadPaths): Promise<DoctorContext> {
  const ctx: DoctorContext = { hasLegacyPromptsDir: false };
  try {
    ctx.config = loadConfig(paths.configFile);
  } catch (err) {
    ctx.configError = err as Error;
  }
  try {
    ctx.secrets = fs.existsSync(paths.secretsFile) ? loadSecrets(paths.secretsFile) : {};
  } catch (err) {
    ctx.secretsError = err as Error;
  }
  ctx.hasLegacyPromptsDir = fs.existsSync(paths.promptsDir);
  return ctx;
}

function gitignoreHasManagedBlock(repoRoot: string): boolean {
  const gitignore = path.join(repoRoot, '.gitignore');
  return fs.existsSync(gitignore) && fs.readFileSync(gitignore, 'utf8').includes('.squad/secrets.yaml');
}

function gitignoreHasTrashPattern(repoRoot: string): boolean {
  const gitignore = path.join(repoRoot, '.gitignore');
  return fs.existsSync(gitignore) && fs.readFileSync(gitignore, 'utf8').includes(SQUAD_TRASH_PATTERN);
}

async function checkDirStructure(paths: SquadPaths, _ctx: DoctorContext, fix: boolean): Promise<CheckResult> {
  const need = [paths.squadDir, paths.storiesDir, paths.plansDir].filter((p) => !fs.existsSync(p));
  if (need.length === 0) {
    return { id: 'dirs', name: '.squad/ directory structure', status: 'ok' };
  }
  if (fix) {
    for (const p of need) {
      fs.mkdirSync(p, { recursive: true });
    }
    return { id: 'dirs', name: '.squad/ directory structure', status: 'ok', detail: 'repaired' };
  }
  return {
    id: 'dirs',
    name: '.squad/ directory structure',
    status: 'warn',
    detail: `missing: ${need.map((p) => path.relative(paths.root, p)).join(', ')}`,
    fixable: true,
    fixHint: 'squad doctor --fix',
  };
}

async function checkConfigReadable(_paths: SquadPaths, ctx: DoctorContext): Promise<CheckResult> {
  if (ctx.configError) {
    return {
      id: 'config',
      name: '.squad/config.yaml readable',
      status: 'fail',
      detail: ctx.configError.message,
      fixHint: 'Fix or recreate .squad/config.yaml; see squad init',
    };
  }
  return { id: 'config', name: '.squad/config.yaml readable', status: 'ok' };
}

async function checkGitignore(paths: SquadPaths, _ctx: DoctorContext, fix: boolean): Promise<CheckResult> {
  if (gitignoreHasManagedBlock(paths.root)) {
    return { id: 'gitignore', name: '.gitignore managed block', status: 'ok' };
  }
  if (fix) {
    ensureGitignore(paths.root);
    return { id: 'gitignore', name: '.gitignore managed block', status: 'ok', detail: 'repaired' };
  }
  return {
    id: 'gitignore',
    name: '.gitignore managed block',
    status: 'warn',
    fixable: true,
    fixHint: 'squad doctor --fix',
  };
}

async function checkGitignoreTrashPattern(paths: SquadPaths, _ctx: DoctorContext, fix: boolean): Promise<CheckResult> {
  if (gitignoreHasTrashPattern(paths.root)) {
    return { id: 'gitignore-trash', name: '.gitignore includes .squad/.trash/', status: 'ok' };
  }
  if (fix) {
    ensureGitignore(paths.root);
    if (gitignoreHasTrashPattern(paths.root)) {
      return { id: 'gitignore-trash', name: '.gitignore includes .squad/.trash/', status: 'ok', detail: 'repaired' };
    }
  }
  return {
    id: 'gitignore-trash',
    name: '.gitignore includes .squad/.trash/',
    status: 'warn',
    fixable: true,
    fixHint: 'squad doctor --fix',
  };
}

async function checkSecretsPermissions(paths: SquadPaths, _ctx: DoctorContext, fix: boolean): Promise<CheckResult> {
  if (process.platform === 'win32') {
    return { id: 'secrets-perms', name: '.squad/secrets.yaml permissions', status: 'skip', detail: 'Windows' };
  }
  if (!fs.existsSync(paths.secretsFile)) {
    return { id: 'secrets-perms', name: '.squad/secrets.yaml permissions', status: 'ok', detail: 'not present' };
  }
  const mode = fs.statSync(paths.secretsFile).mode & 0o777;
  if (mode === 0o600) {
    return { id: 'secrets-perms', name: '.squad/secrets.yaml permissions', status: 'ok' };
  }
  if (fix) {
    fs.chmodSync(paths.secretsFile, 0o600);
    return { id: 'secrets-perms', name: '.squad/secrets.yaml permissions', status: 'ok', detail: 'repaired' };
  }
  return {
    id: 'secrets-perms',
    name: '.squad/secrets.yaml permissions',
    status: 'warn',
    detail: `mode ${mode.toString(8)} (expected 600)`,
    fixable: true,
    fixHint: 'squad doctor --fix',
  };
}

async function checkSecretsParseable(_paths: SquadPaths, ctx: DoctorContext): Promise<CheckResult> {
  if (ctx.secretsError) {
    return {
      id: 'secrets-yaml',
      name: '.squad/secrets.yaml parseable',
      status: 'fail',
      detail: ctx.secretsError.message,
    };
  }
  if (!fs.existsSync(_paths.secretsFile)) {
    return { id: 'secrets-yaml', name: '.squad/secrets.yaml parseable', status: 'ok', detail: 'not present' };
  }
  return { id: 'secrets-yaml', name: '.squad/secrets.yaml parseable', status: 'ok' };
}

async function checkLegacyPrompts(_paths: SquadPaths, ctx: DoctorContext): Promise<CheckResult> {
  if (ctx.hasLegacyPromptsDir) {
    return {
      id: 'legacy-prompts',
      name: 'legacy .squad/prompts/ directory',
      status: 'warn',
      detail: 'stale copy from pre-0.2 installs',
      fixHint: 'squad migrate',
    };
  }
  return { id: 'legacy-prompts', name: 'legacy .squad/prompts/ directory', status: 'ok' };
}

async function checkPlannerTierAwareness(
  _paths: SquadPaths,
  ctx: DoctorContext,
): Promise<CheckResult> {
  const id = 'planner-tier';
  const name = 'planner tier vs. model';
  if (!ctx.config || ctx.config.planner?.enabled !== true) {
    return { id, name, status: 'skip', detail: 'planner disabled' };
  }
  const provider = ctx.config.planner.provider;
  if (provider !== 'anthropic') {
    return { id, name, status: 'skip', detail: `not applicable for ${provider}` };
  }
  const planModel = modelFor(provider, 'plan', ctx.config.planner.modelOverride);
  if (!/opus/i.test(planModel)) {
    return { id, name, status: 'ok', detail: `${planModel} is comfortably under Tier 1` };
  }
  const cacheOn = ctx.config.planner?.cache?.enabled !== false;
  if (cacheOn) {
    return {
      id,
      name,
      status: 'warn',
      detail: 'Anthropic Tier 1 with Opus — tight but viable with prompt caching on',
      fixHint: [
        'Caching saves ~70% on billed input tokens. Keep `planner.cache.enabled: true` in config.',
        'If you still hit 429s on long runs, reduce `planner.budget.maxContextBytes` or use Haiku for plan phase.',
      ].join('\n'),
    };
  }
  return {
    id,
    name,
    status: 'warn',
    detail: `${planModel} on Anthropic Tier 1 (10k input tokens/min) is throttle-prone for plans over ~3 file reads`,
    fixHint:
      'Run `squad config set planner` and pick a Sonnet or Haiku id for planner.modelOverride.anthropic, ' +
      'or upgrade tier at https://console.anthropic.com/settings/limits. ' +
      'squad-kit will auto-retry a 429 once (waiting up to 90s), but repeated throttling means the plan model is simply too big for your quota.',
  };
}

export async function checkPlannerCache(paths: SquadPaths, ctx: DoctorContext): Promise<CheckResult> {
  const id = 'planner-cache';
  const name = 'planner cache effectiveness';
  const config = ctx.config;
  const cacheCfg = config?.planner?.cache;

  if (config?.planner?.enabled !== true) {
    return { id, name, status: 'skip', detail: 'planner disabled — cache check not applicable' };
  }

  if (cacheCfg?.enabled === false) {
    return {
      id,
      name,
      status: 'warn',
      detail: 'prompt caching is disabled in .squad/config.yaml',
      fixHint: 'Cache saves ~70% on billed tokens. Re-enable with `squad config set planner`.',
    };
  }

  const lastRun = await readLastRun(paths);
  if (!lastRun) {
    return {
      id,
      name,
      status: 'skip',
      detail: 'no planner runs logged yet',
      fixHint: 'Run `squad new-plan --api` once, then re-run `squad doctor` to see cache telemetry.',
    };
  }

  const { stats } = lastRun;
  const hitPct = Math.round(stats.cacheHitRatio * 100);

  if (stats.cacheReadTokens === 0 && stats.turns > 1) {
    return {
      id,
      name,
      status: 'fail',
      detail: `caching configured but last run saw 0% hits across ${stats.turns} turns`,
      fixHint: [
        'Possible causes:',
        '  • Planner provider is not Anthropic and the prefix is below 1024 tokens (OpenAI / Google need larger prefixes).',
        '  • System prompt is mutating between turns — check recent changes.',
        "  • Using an older model that doesn't support caching.",
        `Provider: ${lastRun.provider}/${lastRun.model}. Run \`NODE_ENV=development squad new-plan --api\` to surface prefix-mismatch warnings.`,
      ].join('\n'),
    };
  }

  if (hitPct < 30 && stats.turns > 3) {
    return {
      id,
      name,
      status: 'warn',
      detail: `low cache hit rate: ${hitPct}% (last run, ${stats.turns} turns)`,
      fixHint: 'Expected ≥60% for Anthropic, ≥40% for OpenAI, ≥50% for Google after 3+ turns. Prefix may be unstable.',
    };
  }

  return {
    id,
    name,
    status: 'ok',
    detail: `caching active — last run ${hitPct}% hit (${formatTokenK(stats.cacheReadTokens)} read, ${lastRun.provider}/${lastRun.model})`,
  };
}

async function checkPlannerRuntimeInfo(_paths: SquadPaths, ctx: DoctorContext): Promise<CheckResult> {
  if (!ctx.config?.planner?.enabled) {
    return {
      id: 'planner-runtime-info',
      name: 'planner runtime (resolved)',
      status: 'skip',
      detail: 'planner disabled',
    };
  }
  const p = ctx.config.planner;
  const anth = p.provider === 'anthropic' ? (p.runtime?.anthropic ?? 'agent-sdk') : 'vercel (openai/google use Vercel AI SDK)';
  return {
    id: 'planner-runtime-info',
    name: 'planner runtime (resolved)',
    status: 'ok',
    detail: `${p.provider} → ${String(anth)}`,
  };
}

function anthropicPlanModelLooksPost47(modelId: string): boolean {
  return /opus[-_]4[-._]?7/i.test(modelId) || /claude-opus-4-7/i.test(modelId);
}

async function checkPlannerAnthropicRuntimeModelFit(_paths: SquadPaths, ctx: DoctorContext): Promise<CheckResult> {
  const id = 'planner-anthropic-runtime-model-fit';
  const name = 'Anthropic Opus 4.7+ vs Vercel runtime';
  if (!ctx.config?.planner?.enabled || ctx.config.planner.provider !== 'anthropic') {
    return { id, name, status: 'skip', detail: 'not applicable' };
  }
  const p = ctx.config.planner;
  if ((p.runtime?.anthropic ?? 'agent-sdk') !== 'vercel') {
    return { id, name, status: 'ok', detail: 'using Agent SDK or default' };
  }
  const planModel = modelFor('anthropic', 'plan', p.modelOverride);
  if (!anthropicPlanModelLooksPost47(planModel)) {
    return { id, name, status: 'ok', detail: `${planModel} is fine on the Vercel runtime` };
  }
  return {
    id,
    name,
    status: 'warn',
    detail: `Plan model ${planModel} needs the Agent SDK request shape; config uses Vercel runtime.`,
    fixHint:
      'Remove planner.runtime.anthropic: vercel (default is agent-sdk), or set planner.modelOverride.anthropic to a pre-4.7 id (e.g. claude-sonnet-4-5-20250929).',
  };
}

async function checkAgentSdkBinaryPresent(_paths: SquadPaths, ctx: DoctorContext): Promise<CheckResult> {
  const id = 'agent-sdk-binary-present';
  const name = 'Anthropic Agent SDK install';
  if (!ctx.config?.planner?.enabled || ctx.config.planner.provider !== 'anthropic') {
    return { id, name, status: 'skip', detail: 'not applicable' };
  }
  if ((ctx.config.planner.runtime?.anthropic ?? 'agent-sdk') === 'vercel') {
    return { id, name, status: 'skip', detail: 'vercel runtime selected' };
  }
  try {
    await import('@anthropic-ai/claude-agent-sdk');
    return { id, name, status: 'ok', detail: 'package resolves' };
  } catch (e) {
    return {
      id,
      name,
      status: 'warn',
      detail: (e as Error).message.slice(0, 160),
      fixHint: 'Run pnpm install / npm install in the squad-kit package so the Agent SDK (and its platform binary) is present.',
    };
  }
}

async function checkTrackerConfig(_paths: SquadPaths, ctx: DoctorContext): Promise<CheckResult> {
  if (!ctx.config) {
    return { id: 'tracker-config', name: 'tracker configuration', status: 'skip', detail: 'config unavailable' };
  }
  const t = ctx.config.tracker;
  if (t.type === 'none') {
    return { id: 'tracker-config', name: 'tracker configuration', status: 'skip', detail: 'none' };
  }
  if (t.type === 'jira' && !t.workspace?.trim()) {
    return {
      id: 'tracker-config',
      name: 'tracker configuration',
      status: 'fail',
      detail: 'Jira requires tracker.workspace (host)',
    };
  }
  if (t.type === 'azure' && (!t.workspace?.trim() || !t.project?.trim())) {
    return {
      id: 'tracker-config',
      name: 'tracker configuration',
      status: 'fail',
      detail: 'Azure DevOps requires tracker.workspace (organization) and tracker.project',
    };
  }
  if (t.type === 'github' && (!t.workspace?.trim() || !t.project?.trim())) {
    return {
      id: 'tracker-config',
      name: 'tracker configuration',
      status: 'fail',
      detail: 'GitHub requires tracker.workspace (owner) and tracker.project (repo)',
    };
  }
  return { id: 'tracker-config', name: 'tracker configuration', status: 'ok' };
}

function formatClientError(err: ClientResolutionError): string {
  return `${err.message} ${err.detail}`.trim();
}

async function checkTrackerCredential(_paths: SquadPaths, ctx: DoctorContext): Promise<CheckResult> {
  if (!ctx.config) {
    return { id: 'tracker-cred', name: 'tracker credential resolves', status: 'skip', detail: 'config unavailable' };
  }
  if (ctx.config.tracker.type === 'none') {
    return { id: 'tracker-cred', name: 'tracker credential resolves', status: 'skip', detail: 'none' };
  }
  const secrets = ctx.secrets ?? {};
  const overlay = overlayTrackerEnv(secrets);
  const { client, error } = clientFor(ctx.config, overlay);
  if (error) {
    return {
      id: 'tracker-cred',
      name: 'tracker credential resolves',
      status: 'fail',
      detail: formatClientError(error),
    };
  }
  if (!client) {
    return {
      id: 'tracker-cred',
      name: 'tracker credential resolves',
      status: 'fail',
      detail: 'no tracker client',
    };
  }
  return { id: 'tracker-cred', name: 'tracker credential resolves', status: 'ok' };
}

async function checkTrackerConnectivity(paths: SquadPaths, ctx: DoctorContext): Promise<CheckResult> {
  if (!ctx.config || ctx.config.tracker.type === 'none') {
    return { id: 'tracker-live', name: 'tracker connectivity', status: 'skip', detail: 'none' };
  }
  const secrets = ctx.secrets ?? {};
  const overlay = overlayTrackerEnv(secrets);
  const { client, error } = clientFor(ctx.config, overlay);
  if (error || !client) {
    return { id: 'tracker-live', name: 'tracker connectivity', status: 'skip', detail: 'no credential' };
  }
  if (client.name === 'jira') {
    const r = await probeJiraConnectivity(secrets, ctx.config);
    if (r.ok) return { id: 'tracker-live', name: 'tracker connectivity', status: 'ok', detail: 'Jira REST' };
    return {
      id: 'tracker-live',
      name: 'tracker connectivity',
      status: 'fail',
      detail: r.status !== undefined ? `HTTP ${r.status}` : r.detail ?? 'request failed',
    };
  }
  if (client.name === 'azure') {
    const r = await probeAzureConnectivity(secrets, ctx.config);
    if (r.ok) return { id: 'tracker-live', name: 'tracker connectivity', status: 'ok', detail: 'Azure DevOps' };
    return {
      id: 'tracker-live',
      name: 'tracker connectivity',
      status: 'fail',
      detail: r.status !== undefined ? `HTTP ${r.status}` : r.detail ?? 'request failed',
    };
  }
  if (client.name === 'github') {
    const r = await probeGitHubConnectivity(secrets, ctx.config);
    if (r.ok) return { id: 'tracker-live', name: 'tracker connectivity', status: 'ok', detail: 'GitHub REST' };
    return {
      id: 'tracker-live',
      name: 'tracker connectivity',
      status: 'fail',
      detail: r.status !== undefined ? `HTTP ${r.status}` : r.detail ?? 'request failed',
    };
  }
  return {
    id: 'tracker-live',
    name: 'tracker connectivity',
    status: 'skip',
    detail: 'unsupported client',
  };
}

async function guardCheck(checkName: string, fn: () => Promise<CheckResult>): Promise<CheckResult> {
  try {
    return await fn();
  } catch (err) {
    return {
      id: 'unexpected',
      name: checkName,
      status: 'fail',
      detail: (err as Error).message,
    };
  }
}

export async function runAllChecks(paths: SquadPaths, ctx: DoctorContext, fix: boolean): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];
  const add = async (label: string, fn: () => Promise<CheckResult>) => {
    checks.push(await guardCheck(label, fn));
  };
  await add('.squad/ directory structure', () => checkDirStructure(paths, ctx, fix));
  await add('.squad/config.yaml readable', () => checkConfigReadable(paths, ctx));
  await add('.gitignore managed block', () => checkGitignore(paths, ctx, fix));
  await add('.gitignore includes .squad/.trash/', () => checkGitignoreTrashPattern(paths, ctx, fix));
  await add('.squad/secrets.yaml permissions', () => checkSecretsPermissions(paths, ctx, fix));
  await add('.squad/secrets.yaml parseable', () => checkSecretsParseable(paths, ctx));
  await add('legacy .squad/prompts/ directory', () => checkLegacyPrompts(paths, ctx));
  await add('planner tier vs. model', () => checkPlannerTierAwareness(paths, ctx));
  await add('planner cache effectiveness', () => checkPlannerCache(paths, ctx));
  await add('planner runtime (resolved)', () => checkPlannerRuntimeInfo(paths, ctx));
  await add('Anthropic Opus 4.7+ vs Vercel runtime', () => checkPlannerAnthropicRuntimeModelFit(paths, ctx));
  await add('Anthropic Agent SDK install', () => checkAgentSdkBinaryPresent(paths, ctx));
  await add('tracker configuration', () => checkTrackerConfig(paths, ctx));
  await add('tracker credential resolves', () => checkTrackerCredential(paths, ctx));
  await add('tracker connectivity', () => checkTrackerConnectivity(paths, ctx));
  return checks;
}

export function summarise(checks: CheckResult[]): { ok: number; warn: number; fail: number; skip: number } {
  return {
    ok: checks.filter((c) => c.status === 'ok').length,
    warn: checks.filter((c) => c.status === 'warn').length,
    fail: checks.filter((c) => c.status === 'fail').length,
    skip: checks.filter((c) => c.status === 'skip').length,
  };
}
