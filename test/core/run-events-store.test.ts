import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPaths } from '../../src/core/paths.js';
import {
  createRunEventsStore,
  openRunEventsReader,
  redactPlannerEventForDisk,
  rotateRunEvents,
} from '../../src/core/run-events-store.js';
import { RUN_HISTORY_RING_SIZE } from '../../src/core/run-retention.js';
import type { PlannerEvent } from '../../src/planner/events.js';

function sampleEvent(i: number): PlannerEvent {
  return {
    kind: 'turn_started',
    runId: 'r',
    turn: i,
  };
}

describe('run-events-store', () => {
  let tmp: string;
  let paths: ReturnType<typeof buildPaths>;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-rev-'));
    paths = buildPaths(tmp);
    fs.mkdirSync(paths.squadDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('redact clears thinking_delta text only', () => {
    const e: PlannerEvent = {
      kind: 'thinking_delta',
      runId: 'x',
      turn: 1,
      blockIndex: 0,
      delta: 'secret',
    };
    const r = redactPlannerEventForDisk(e);
    expect(r.kind).toBe('thinking_delta');
    if (r.kind === 'thinking_delta') {
      expect(r.delta).toBe('');
      expect(r.blockIndex).toBe(0);
      expect(r.turn).toBe(1);
    }
    const other: PlannerEvent = { kind: 'cancelled', runId: 'x' };
    expect(redactPlannerEventForDisk(other)).toEqual(other);
  });

  it('round-trip append + read preserves order (with redaction)', async () => {
    const runId = 'rt1';
    const store = createRunEventsStore(paths, runId);
    const events: PlannerEvent[] = [];
    for (let i = 0; i < 50; i++) {
      if (i === 7) {
        events.push({ kind: 'thinking_delta', runId, turn: 1, blockIndex: 0, delta: 'hidden' });
      } else {
        events.push(sampleEvent(i));
      }
    }
    for (const e of events) await store.append(e);
    await store.close();

    const reader = await openRunEventsReader(paths, runId);
    expect(reader).not.toBeNull();
    const back: PlannerEvent[] = [];
    for await (const e of reader!.iterate()) back.push(e);
    expect(back.length).toBe(50);
    for (let i = 0; i < 50; i++) {
      if (i === 7) {
        expect(back[i]?.kind).toBe('thinking_delta');
        const td = back[i] as Extract<PlannerEvent, { kind: 'thinking_delta' }>;
        expect(td.delta).toBe('');
      } else {
        expect(back[i]).toEqual(sampleEvent(i));
      }
    }
    expect(await reader!.count()).toBe(50);
  });

  it('gzip path: rotate compresses 6th run then reader round-trips', async () => {
    const dir = path.join(paths.squadDir, 'runs');
    fs.mkdirSync(dir, { recursive: true });
    const t0 = Date.now();
    for (let i = 0; i < 7; i++) {
      const runId = `gz-${i}`;
      fs.writeFileSync(path.join(dir, `${runId}.json`), JSON.stringify({ runId, version: 1 }) + '\n', 'utf8');
      const store = createRunEventsStore(paths, runId);
      await store.append(sampleEvent(i));
      await store.close();
      const p = path.join(dir, `${runId}.events.jsonl`);
      const age = t0 - (7 - i) * 60_000;
      fs.utimesSync(p, new Date(age), new Date(age));
    }
    await rotateRunEvents(paths);
    const sixth = 'gz-1';
    expect(fs.existsSync(path.join(dir, `${sixth}.events.jsonl`))).toBe(false);
    expect(fs.existsSync(path.join(dir, `${sixth}.events.jsonl.gz`))).toBe(true);

    const reader = await openRunEventsReader(paths, sixth);
    expect(reader).not.toBeNull();
    const evs: PlannerEvent[] = [];
    for await (const e of reader!.iterate()) evs.push(e);
    expect(evs).toEqual([sampleEvent(1)]);
  });

  it('pagination over 2500 lines', async () => {
    const runId = 'pg';
    const store = createRunEventsStore(paths, runId);
    for (let i = 0; i < 2500; i++) await store.append(sampleEvent(i));
    await store.close();
    const reader = await openRunEventsReader(paths, runId);
    expect(reader).not.toBeNull();
    const a: PlannerEvent[] = [];
    for await (const e of reader!.iterate({ fromIndex: 0, limit: 1000 })) a.push(e);
    const b: PlannerEvent[] = [];
    for await (const e of reader!.iterate({ fromIndex: 1000, limit: 1000 })) b.push(e);
    const c: PlannerEvent[] = [];
    for await (const e of reader!.iterate({ fromIndex: 2000, limit: 1000 })) c.push(e);
    expect(a.length).toBe(1000);
    expect(b.length).toBe(1000);
    expect(c.length).toBe(500);
    expect(a[0]).toEqual(sampleEvent(0));
    expect(b[0]).toEqual(sampleEvent(1000));
    expect(c[0]).toEqual(sampleEvent(2000));
  });

  it('rotation policy: 23 runs → 20 kept, 5 raw + 15 gz, oldest 3 gone', async () => {
    const dir = path.join(paths.squadDir, 'runs');
    fs.mkdirSync(dir, { recursive: true });
    const base = Date.now() - 1000 * 3600;
    for (let i = 0; i < 23; i++) {
      const runId = `rot-${i.toString().padStart(2, '0')}`;
      fs.writeFileSync(
        path.join(dir, `${runId}.json`),
        JSON.stringify({ runId, version: 1, storyId: runId }) + '\n',
        'utf8',
      );
      const p = path.join(dir, `${runId}.events.jsonl`);
      fs.writeFileSync(p, '{"kind":"turn_started","runId":"r","turn":1}\n', 'utf8');
      const ts = base + i * 10_000;
      fs.utimesSync(path.join(dir, `${runId}.json`), new Date(ts), new Date(ts));
      fs.utimesSync(p, new Date(ts), new Date(ts));
    }
    await rotateRunEvents(paths);
    const left = fs.readdirSync(dir);
    const jsonSummaries = left.filter((f) => f.endsWith('.json'));
    expect(jsonSummaries.length).toBe(RUN_HISTORY_RING_SIZE);
    const raw = left.filter((f) => /\.events\.jsonl$/u.test(f) && !f.endsWith('.gz'));
    const gz = left.filter((f) => f.endsWith('.events.jsonl.gz'));
    expect(raw.length).toBe(5);
    expect(gz.length).toBe(15);
    for (let i = 0; i < 3; i++) {
      expect(left.some((f) => f.startsWith(`rot-${i.toString().padStart(2, '0')}`))).toBe(false);
    }
  });

  it('crash recovery skips trailing partial JSON line', async () => {
    const runId = 'crash';
    const store = createRunEventsStore(paths, runId);
    for (let i = 0; i < 10; i++) await store.append(sampleEvent(i));
    await store.close();
    const p = path.join(paths.squadDir, 'runs', `${runId}.events.jsonl`);
    let buf = fs.readFileSync(p, 'utf8');
    buf = buf.slice(0, buf.length - 5);
    fs.writeFileSync(p, buf, 'utf8');
    const reader = await openRunEventsReader(paths, runId);
    const evs: PlannerEvent[] = [];
    for await (const e of reader!.iterate()) evs.push(e);
    expect(evs.length).toBe(9);
  });
});
