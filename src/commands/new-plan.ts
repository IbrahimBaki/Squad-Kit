import fs from 'node:fs';
import path from 'node:path';
import { confirm, select } from '@inquirer/prompts';
import * as ui from '../ui/index.js';
import { buildPaths, requireSquadRoot, type SquadPaths } from '../core/paths.js';
import { loadConfig, type SquadConfig } from '../core/config.js';
import { readFile } from '../utils/fs.js';
import { copyToClipboard } from '../utils/clipboard.js';
import { findStoryByIntake, listStories, type StoryRecord } from '../core/stories.js';
import { buildCopyPlanPromptMarkdown } from '../core/copy-plan-prompt.js';

export interface NewPlanOptions {
  /** Default true; `--no-clipboard` sets false (copy-paste mode only). */
  clipboard?: boolean;
  /** `--copy` — force copy-paste mode. */
  copy?: boolean;
  feature?: string;
  all?: boolean;
  yes?: boolean;
  /** Kept so we can show a helpful error when used. */
  api?: boolean;
}

function decideMode(opts: NewPlanOptions): 'copy' {
  if (opts.api) {
    throw new Error(
      'squad new-plan --api is not available in this fork.\n' +
        'Use /squad-plan-generate inside Claude Code instead — it runs the same planning logic\n' +
        'using your Claude Code login, with no API key required.',
    );
  }
  return 'copy';
}

export async function runNewPlan(intakePath: string | undefined, opts: NewPlanOptions): Promise<void> {
  decideMode(opts);
  const root = requireSquadRoot();
  const paths = buildPaths(root);
  const config = loadConfig(paths.configFile);

  const interactive = !opts.yes && Boolean(process.stdin.isTTY);
  const stories = listStories(paths, { feature: opts.feature });

  const story = intakePath
    ? resolveFromPath(intakePath, stories, root)
    : await pickStory(stories, { all: !!opts.all, interactive, feature: opts.feature });

  if (!story) return;

  if (story.planFile) {
    const proceed = await confirmOverwrite(story, interactive, !!opts.yes);
    if (!proceed) return;
  }

  await emitCopyPrompt(story, paths, config, opts.clipboard !== false);
}

function resolveFromPath(intakePath: string, stories: StoryRecord[], root: string): StoryRecord {
  const resolved = path.resolve(intakePath.trim());
  if (!fs.existsSync(resolved)) {
    throw new Error(
      `Intake not found: ${resolved}. Run \`squad list\` to see intakes, or \`squad new-story\` to create one first.`,
    );
  }
  const hit = findStoryByIntake(stories, resolved);
  if (hit) return hit;
  throw new Error(
    `Intake at ${resolved} is not under ${relativeStoriesDir(root)}. ` +
      `Run \`squad new-story\` to create a story, then pass a path like \`squad new-plan .squad/stories/<feature>/<id>/intake.md\`.`,
  );
}

function relativeStoriesDir(root: string): string {
  return path.relative(root, path.join(root, '.squad', 'stories'));
}

async function pickStory(
  stories: StoryRecord[],
  opts: { all: boolean; interactive: boolean; feature?: string },
): Promise<StoryRecord | undefined> {
  const candidates = opts.all ? stories : stories.filter((s) => !s.planFile);

  if (candidates.length === 0) {
    if (stories.length === 0) {
      ui.info('No intakes to plan. Run `squad new-story` to create one first.');
      return undefined;
    }
    const filterNote = opts.feature ? ` in feature "${opts.feature}"` : '';
    ui.info(`All ${stories.length} intakes${filterNote} already have plans.`);
    ui.blank();
    ui.info('Options:');
    ui.info('  squad new-plan --all             pick any intake (replaces existing plan)');
    ui.info('  squad new-plan <intake-path>     regenerate a specific plan');
    ui.info('  squad new-story <feature>        start a new story');
    return undefined;
  }

  if (!opts.interactive) {
    throw new Error(
      'No intake path provided and not running interactively. Run `squad new-plan` with a path to intake.md, or `squad new-plan` in a TTY to pick, or add `--yes` with an explicit path in CI.',
    );
  }

  const pick = await select({
    message: 'Pick a story to plan:',
    pageSize: Math.min(10, candidates.length),
    choices: candidates.map((s) => ({
      name: formatLabel(s),
      value: s.intakePath,
    })),
  });

  return candidates.find((s) => path.resolve(s.intakePath) === path.resolve(pick));
}

function formatLabel(s: StoryRecord): string {
  const head = `${s.feature} / ${s.id}`;
  const tail = s.titleHint ? `  ${ui.theme.dim(`— "${s.titleHint}"`)}` : '';
  const plannedTag = s.planFile ? `  ${ui.theme.warn('(planned)')}` : '';
  return head + tail + plannedTag;
}

async function confirmOverwrite(story: StoryRecord, interactive: boolean, yes: boolean): Promise<boolean> {
  ui.warning(`A plan already exists for this intake:`);
  ui.kv('plan', `.squad/plans/${story.feature}/${story.planFile}`);
  ui.info('Regenerating will replace it when your planner writes the new version.');
  if (yes) return true;
  if (!interactive) {
    throw new Error(
      `Plan already exists (.squad/plans/${story.feature}/${story.planFile}). ` +
        `Run \`squad new-plan\` with \`--yes\` to overwrite non-interactively, or in a TTY to confirm in the prompt.`,
    );
  }
  const go = await confirm({ message: 'Proceed and regenerate?', default: false });
  return go;
}

async function emitCopyPrompt(
  story: StoryRecord,
  paths: SquadPaths,
  config: SquadConfig,
  clipboard: boolean,
): Promise<void> {
  const intakeContent = readFile(story.intakePath);
  const composed = buildCopyPlanPromptMarkdown(config, intakeContent);

  const promptFile = path.join(paths.squadDir, '.last-copy-prompt.md');
  fs.writeFileSync(promptFile, composed, 'utf8');
  const relPromptFile = path.relative(paths.root, promptFile);

  const bytes = Buffer.byteLength(composed, 'utf8');
  const estTokens = Math.round(bytes / 4);
  const clipResult = clipboard
    ? await copyToClipboard(composed)
    : { ok: false as const, reason: 'clipboard disabled (--no-clipboard)' };

  ui.blank();
  ui.divider('planner prompt ready');
  ui.kv('mode', 'copy-paste', 10);
  ui.kv('story', `${story.feature} / ${story.id}`, 10);
  ui.kv('prompt', relPromptFile, 10);
  ui.kv('size', `${formatKB(bytes)} · ~${formatCount(estTokens)} tokens (est)`, 10);
  if (clipResult.ok) {
    ui.kv('clipboard', `✓ copied via ${clipResult.tool}`, 10);
  } else {
    ui.kv('clipboard', `! ${clipResult.reason}`, 10);
  }

  printModelBanner(config);

  ui.blank();
  ui.step('Next:');
  ui.info('1) Open your agent chat (Cursor / Claude Code / Copilot / Gemini).');
  ui.info('2) Switch to a strong plan model (Opus 4.x / GPT-5.3 Codex thinking / Gemini deep-think).');
  if (clipResult.ok) {
    ui.info('3) Paste from clipboard and let the agent work. It will read files and write the plan itself.');
  } else {
    ui.info(`3) Open ${relPromptFile}, paste its contents into the agent chat, and let it work.`);
  }
  ui.info(
    `4) The agent writes the plan to .squad/plans/${story.feature}/<nn>-story-${story.id}.md. Review it, then open a fresh chat to implement (attach only the plan file).`,
  );
}

function formatKB(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}

function printModelBanner(config: SquadConfig): void {
  if (!ui.isInteractive()) return;
  ui.blank();
  ui.divider('paste into your agent');
  ui.info('Recommendation: switch to a strong planning model before pasting.');
  ui.info('Tip: Use /squad-plan-generate inside Claude Code to generate the plan directly (no API key needed).');
  const agents = config.agents ?? [];
  const hint = (name: string, msg: string) => {
    if (agents.includes(name)) ui.kv(name, msg, 14);
  };
  hint('cursor', 'model picker → Claude Opus 4.x or GPT-5.3 Codex (thinking)');
  hint('claude-code', '/squad-plan-generate <intake-path>  (or /model claude-opus-4-x for copy-paste)');
  hint('copilot', 'chat model picker → the strongest available reasoning model');
  hint('gemini', '/model gemini-deep-think (or the latest strongest)');
  if (agents.length === 0) {
    ui.info('  (any agent) pick the strongest planning model you have access to.');
  }
  ui.divider();
  ui.blank();
}
