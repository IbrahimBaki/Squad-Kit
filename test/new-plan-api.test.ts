import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { LanguageModelV1StreamPart } from '@ai-sdk/provider';
import { buildPaths, SQUAD_DIR } from '../src/core/paths.js';
import { DEFAULT_CONFIG, saveConfig } from '../src/core/config.js';
import { SquadExit } from '../src/core/cli-exit.js';
import { runNewPlan } from '../src/commands/new-plan.js';
import { MockLanguageModelV1, simulateReadableStream } from 'ai/test';
import { READ_FILE_TOOL_NAME } from '../src/planner/tools/index.js';

const { mockDoStream } = vi.hoisted(() => ({ mockDoStream: vi.fn() }));

vi.mock('../src/planner/providers/index.js', () => ({
  resolveModel: () => ({
    provider: 'anthropic' as const,
    modelId: 'claude-3-5-sonnet-latest',
    model: new MockLanguageModelV1({
      provider: 'anthropic.messages',
      modelId: 'claude-3-5-sonnet-latest',
      doStream: mockDoStream,
    }),
  }),
}));

function streamOk(chunks: LanguageModelV1StreamPart[]) {
  return {
    stream: simulateReadableStream({ chunks }),
    rawCall: { rawPrompt: [] as unknown[], rawSettings: {} },
  };
}

function tok(p: number, o: number) {
  return { promptTokens: p, completionTokens: o, totalTokens: p + o };
}

let tmp: string;
let prevCwd: string;
let prevKey: string | undefined;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-new-plan-api-'));
  prevCwd = process.cwd();
  process.chdir(tmp);
  prevKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  mockDoStream.mockReset();

  const squad = path.join(tmp, SQUAD_DIR);
  fs.mkdirSync(squad, { recursive: true });
  saveConfig(path.join(squad, 'config.yaml'), {
    ...DEFAULT_CONFIG,
    planner: {
      enabled: true,
      provider: 'anthropic',
      mode: 'auto',
      budget: {
        maxFileReads: 25,
        maxContextBytes: 50_000,
        maxDurationSeconds: 180,
      },
      stages: { scout: { enabled: false } },
      validation: { enabled: false },
    },
  });

  const paths = buildPaths(tmp);
  const intakeDir = path.join(paths.storiesDir, 'feat', 'sid');
  fs.mkdirSync(intakeDir, { recursive: true });
  fs.writeFileSync(path.join(intakeDir, 'intake.md'), '# Intake\nDo the thing.\n', 'utf8');
  fs.writeFileSync(path.join(tmp, 'only.txt'), 'x', 'utf8');
});

afterEach(() => {
  process.chdir(prevCwd);
  fs.rmSync(tmp, { recursive: true, force: true });
  if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = prevKey;
});

describe('runNewPlan API path', () => {
  it('writes plan file with metadata and assistant text', async () => {
    mockDoStream
      .mockResolvedValueOnce(
        streamOk([
          {
            type: 'tool-call',
            toolCallType: 'function',
            toolCallId: 'c1',
            toolName: READ_FILE_TOOL_NAME,
            args: JSON.stringify({ path: 'only.txt' }),
          },
          { type: 'finish', finishReason: 'tool-calls', usage: tok(5, 5) },
        ]),
      )
      .mockResolvedValueOnce(
        streamOk([
          { type: 'text-delta', textDelta: '# Story 01 — Done\n\nBody.\n' },
          { type: 'finish', finishReason: 'stop', usage: tok(10, 20) },
        ]),
      );

    const intake = path.join(tmp, '.squad/stories/feat/sid/intake.md');
    await runNewPlan(intake, { yes: true });

    const planDir = path.join(tmp, '.squad/plans/feat');
    const files = fs.readdirSync(planDir).filter((f) => f.endsWith('.md') && f !== '00-overview.md');
    expect(files.length).toBe(1);
    const content = fs.readFileSync(path.join(planDir, files[0]!), 'utf8');
    expect(content.startsWith('<!-- squad-kit:')).toBe(true);
    expect(content).toContain('# Story 01 — Done');
    expect(content).toContain('Body.');
  });

  it('writes a .partial.md plan and throws SquadExit(2) when the planner stops on max_tokens', async () => {
    mockDoStream.mockResolvedValueOnce(
      streamOk([
        { type: 'text-delta', textDelta: '# truncated\n' },
        { type: 'finish', finishReason: 'length', usage: tok(1, 1) },
      ]),
    );
    const intake = path.join(tmp, '.squad/stories/feat/sid/intake.md');
    await expect(runNewPlan(intake, { yes: true, api: true })).rejects.toSatisfy(
      (e: unknown) => e instanceof SquadExit && (e as SquadExit).exitCode === 2,
    );
    const planDir = path.join(tmp, '.squad/plans/feat');
    const partial = fs.readdirSync(planDir).find((f) => f.endsWith('.partial.md'));
    expect(partial).toBeTruthy();
    const raw = fs.readFileSync(path.join(planDir, partial!), 'utf8');
    expect(raw).toContain('squad-kit-plan-status: partial');
  });

  it('throws when API key is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.SQUAD_PLANNER_API_KEY;
    const intake = path.join(tmp, '.squad/stories/feat/sid/intake.md');
    await expect(runNewPlan(intake, { yes: true, api: true })).rejects.toThrow(/Missing ANTHROPIC_API_KEY/);
  });

  it('rejects --api and --copy together', async () => {
    const intake = path.join(tmp, '.squad/stories/feat/sid/intake.md');
    await expect(runNewPlan(intake, { yes: true, api: true, copy: true })).rejects.toThrow(
      /Pass either --api or --copy/,
    );
  });
});
