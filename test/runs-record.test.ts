import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendRun, listRuns, newRunId } from '../src/core/runs.js';
import { buildPaths } from '../src/core/paths.js';

describe('RunRecord.validation issuesByKind', () => {
  let tmp: string;
  let paths: ReturnType<typeof buildPaths>;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-runrec-'));
    paths = buildPaths(tmp);
    fs.mkdirSync(paths.squadDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('appendRun persists validation.issuesByKind', async () => {
    await appendRun(paths, {
      runId: newRunId(),
      provider: 'anthropic',
      model: 'x',
      feature: 'f',
      storyId: '1',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      success: true,
      partial: false,
      planFile: 'x.md',
      stats: {
        turns: 1,
        inputTokens: 1,
        outputTokens: 1,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        cacheHitRatio: 0,
        durationMs: 1,
      },
      cacheEnabled: true,
      durationMs: 10,
      validation: {
        enabled: true,
        issuesCount: 2,
        issuesByKind: { missing_path: 1, symbol_not_found: 1 },
      },
    });
    const rows = await listRuns(paths);
    expect(rows[0]?.validation?.issuesByKind).toEqual({ missing_path: 1, symbol_not_found: 1 });
  });

  it('loads legacy runs without issuesByKind', async () => {
    const runId = newRunId();
    const dir = path.join(paths.squadDir, 'runs');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `${runId}.json`),
      JSON.stringify({
        runId,
        provider: 'anthropic',
        model: 'x',
        feature: 'f',
        storyId: '1',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        success: true,
        partial: false,
        planFile: null,
        stats: {
          turns: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          cacheHitRatio: 0,
          durationMs: 0,
        },
        cacheEnabled: true,
        durationMs: 1,
        validation: { enabled: true, issuesCount: 0 },
        version: 1,
      }) + '\n',
      'utf8',
    );
    const rows = await listRuns(paths);
    expect(rows[0]?.validation?.issuesCount).toBe(0);
    expect(rows[0]?.validation?.issuesByKind).toBeUndefined();
  });
});
