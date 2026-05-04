import { readBundledPrompt } from '../utils/fs.js';

export function composeSystemPrompt(args: {
  projectRoots: string[];
  primaryLanguage: string;
  trackerType: string;
  repoMap: string;
}): string {
  const base = readBundledPrompt('generate-plan.md')
    .replace(/\{\{projectRoots\}\}/g, args.projectRoots.join(', '))
    .replace(/\{\{primaryLanguage\}\}/g, args.primaryLanguage)
    .replace(/\{\{trackerType\}\}/g, args.trackerType)
    .replace(
      /\{\{intakeContent\}\}/g,
      '_(The intake story is provided in the user message below. Do not ask for it.)_',
    );

  const apiPreamble = [
    '',
    '---',
    '',
    '## Direct-API mode notes',
    '',
    'You are being invoked by the squad-kit CLI, not by a human editor. The intake is already inlined below.',
    'The repository tree is provided. Tools: **`list_dir`** (one-level directory listing), **`grep`** (search), **`read_file`** (whole file up to 32 KB, or **`offset` + `limit`** for a line range — preferred when you know the region).',
    'You have a bounded context budget (tool calls, total bytes, wall-clock time). Prefer `grep` and ranged `read_file` over whole-file reads.',
    'When you have enough information, output the **complete plan markdown** as your final assistant message. No prose around it, no code fences wrapping the whole plan. The CLI will write your final message verbatim to disk.',
    '',
    '## Repository tree',
    '',
    '```',
    args.repoMap.trimEnd(),
    '```',
    '',
  ].join('\n');

  return base + apiPreamble;
}

export function composeScoutSystemPrompt(args: {
  projectRoots: string[];
  primaryLanguage: string;
  trackerType: string;
  repoMap: string;
  plansIndex?: string;
}): string {
  const plans =
    args.plansIndex?.trim() ||
    '(no prior plans yet)';
  const base = readBundledPrompt('scout.md')
    .replace(/\{\{projectRoots\}\}/g, args.projectRoots.join(', '))
    .replace(/\{\{primaryLanguage\}\}/g, args.primaryLanguage)
    .replace(/\{\{trackerType\}\}/g, args.trackerType)
    .replace(/\{\{repoMap\}\}/g, args.repoMap.trimEnd())
    .replace(/\{\{plansIndex\}\}/g, plans);
  return base;
}

/** Prefix matched in `turnsToCoreMessages` for Anthropic cache breakpoint on the scouted-context user turn. */
export const SCOUTED_USER_MESSAGE_CACHE_SENTINEL = 'I have already scouted the project';

/**
 * User-message-shaped block carrying scouted file previews. Separate from the static system prompt
 * so provider prompt caches stay stable across runs.
 */
export function composeScoutedUserMessage(args: { scoutedSection: string }): string {
  return [
    SCOUTED_USER_MESSAGE_CACHE_SENTINEL +
      ' for relevant files. Use this as your starting context; ' +
      'call `read_file`/`grep`/`list_dir` if you need to read more.',
    '',
    args.scoutedSection.trim(),
    '',
  ].join('\n');
}

export function composeUserPrompt(args: { intakeContent: string }): string {
  return [
    'Produce the implementation plan for the following intake.',
    '',
    '---',
    '',
    args.intakeContent.trimEnd(),
    '',
  ].join('\n');
}
