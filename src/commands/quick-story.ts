import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../core/config.js';
import { buildPaths, slugify, requireSquadRoot } from '../core/paths.js';
import { buildIntakeTemplateVars, ensureFeatureOverview } from '../core/story-intake-helpers.js';
import { readBundledPrompt, writeFileSafe } from '../utils/fs.js';
import { render } from '../core/template.js';
import * as ui from '../ui/index.js';

export interface QuickStoryOptions {
  feature: string;
  title?: string;
  json?: boolean;
}

export async function runQuickStory(opts: QuickStoryOptions): Promise<void> {
  const root = requireSquadRoot();
  const paths = buildPaths(root);
  const config = loadConfig(paths.configFile);

  const featureSlug = slugify(opts.feature);
  if (!featureSlug) {
    throw new Error('A feature slug is required (e.g. "stats-filter").');
  }

  // Quick id = "q-" + feature slug. Append -2, -3, ... on collision.
  let storyFolderName = `q-${featureSlug}`;
  const featureStoriesDir = path.join(paths.storiesDir, featureSlug);
  let n = 1;
  while (fs.existsSync(path.join(featureStoriesDir, storyFolderName))) {
    n += 1;
    storyFolderName = `q-${featureSlug}-${n}`;
  }

  const storyDir = path.join(featureStoriesDir, storyFolderName);
  const attachmentsDir = path.join(storyDir, 'attachments');
  fs.mkdirSync(attachmentsDir, { recursive: true });

  const vars = buildIntakeTemplateVars({
    config,
    featureSlug,
    storyFolderName,
    trackerId: undefined,
    title: opts.title,
    fetchedIssue: undefined,
  });

  const template = readBundledPrompt('intake.md');
  const intakePath = path.join(storyDir, 'intake.md');

  const banner =
    '> **Local quick story (not linked to any tracker).**  \n' +
    '> Created via `squad quick-story`. Use `/squad-log` after implementing to document it on the tracker.\n\n---\n\n';

  writeFileSafe(intakePath, banner + render(template, vars), false);

  ensureFeatureOverview(path.join(paths.plansDir, featureSlug), featureSlug);

  const relIntake = path.relative(root, intakePath);
  if (opts.json) {
    process.stdout.write(
      JSON.stringify({ featureSlug, storyFolderName, intakePath: relIntake }, null, 2) + '\n',
    );
  } else {
    ui.success('Created quick story');
    ui.kv('feature', featureSlug, 10);
    ui.kv('id', storyFolderName, 10);
    ui.kv('intake', relIntake, 10);
  }
}
