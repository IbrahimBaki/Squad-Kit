import fs from 'node:fs';
import { loadConfig } from '../core/config.js';
import { buildPaths, requireSquadRoot } from '../core/paths.js';
import { loadSecrets } from '../core/secrets.js';
import { clientFor, overlayTrackerEnv } from '../tracker/index.js';
import { TrackerError, type CreateWorkItemResult, type WorkItemKind } from '../tracker/types.js';
import * as ui from '../ui/index.js';

const VALID_KINDS: WorkItemKind[] = ['Task', 'Bug', 'User Story'];

export interface PushWorkItemOptions {
  kind: string;
  title: string;
  description?: string;
  acceptance?: string;
  parent?: string;
  area?: string;
  iteration?: string;
  tags?: string;
  json?: boolean;
}

export async function runPushWorkItem(opts: PushWorkItemOptions): Promise<void> {
  const kind = opts.kind as WorkItemKind;
  if (!VALID_KINDS.includes(kind)) {
    throw new Error(
      `Invalid --kind "${opts.kind}". Must be one of: ${VALID_KINDS.map((k) => `"${k}"`).join(', ')}.`,
    );
  }

  if (!opts.title?.trim()) {
    throw new Error('--title is required and cannot be empty.');
  }

  const root = requireSquadRoot();
  const paths = buildPaths(root);
  const config = loadConfig(paths.configFile);

  const secretsFromFile = fs.existsSync(paths.secretsFile) ? loadSecrets(paths.secretsFile) : {};
  const secrets = overlayTrackerEnv(secretsFromFile);
  const resolution = clientFor(config, secrets);

  if (resolution.error) {
    throw new Error(`${resolution.error.message}\n${resolution.error.detail}`);
  }

  const client = resolution.client!;
  if (!client.createWorkItem) {
    throw new Error(
      `The configured tracker "${config.tracker.type}" does not support creating work items. ` +
        `Only Azure DevOps is supported. Run \`squad config set tracker\` to switch.`,
    );
  }

  const tags = opts.tags
    ? opts.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    : undefined;

  const spin = ui.spinner(`Creating ${kind} on Azure DevOps…`);
  let createResult: CreateWorkItemResult;
  try {
    createResult = await client.createWorkItem({
      kind,
      title: opts.title.trim(),
      description: opts.description?.trim() || undefined,
      acceptanceCriteria: opts.acceptance?.trim() || undefined,
      parentId: opts.parent?.trim() || undefined,
      areaPath: opts.area?.trim() || undefined,
      iterationPath: opts.iteration?.trim() || undefined,
      tags,
    });
  } catch (err) {
    spin.fail('Failed to create work item');
    if (err instanceof TrackerError && err.kind === 'auth') {
      throw new Error(
        `${err.message}\nRegenerate your Azure DevOps PAT with "Work Items (Read & Write)" scope, ` +
          `then run \`squad config set tracker\` to update it.`,
      );
    }
    throw err;
  }

  spin.succeed(`Created ${kind} #${createResult.id}`);

  if (opts.json) {
    process.stdout.write(JSON.stringify(createResult, null, 2) + '\n');
  } else {
    ui.kv('id', createResult.id, 6);
    ui.kv('kind', createResult.kind, 6);
    ui.kv('title', createResult.title, 6);
    ui.kv('url', createResult.url, 6);
  }
}
