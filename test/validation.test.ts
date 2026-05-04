import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validatePlan } from '../src/planner/validation.js';

describe('validatePlan', () => {
  it('reports missing path in backticks', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-val-'));
    try {
      const issues = validatePlan({
        root,
        planText: 'See `src/nope/not-there.ts` for details.\n',
      });
      expect(issues.some((i) => i.kind === 'missing_path')).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('accepts zero issues for prose-only plan', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-val-'));
    try {
      const issues = validatePlan({ root, planText: '# Title\n\nNo code paths here.\n' });
      expect(issues.filter((i) => i.kind === 'missing_path')).toHaveLength(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('flags line range past EOF when path exists', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-val-'));
    try {
      fs.mkdirSync(path.join(root, 'src'), { recursive: true });
      fs.writeFileSync(path.join(root, 'src/short.ts'), 'one\ntwo\n', 'utf8');
      const issues = validatePlan({
        root,
        planText: 'Read `src/short.ts` around ~lines 1–99.\n',
      });
      expect(issues.some((i) => i.kind === 'line_range_too_large')).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('flags single-line citation past EOF', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-val-sl'));
    try {
      fs.mkdirSync(path.join(root, 'src'), { recursive: true });
      const lines = Array.from({ length: 100 }, () => 'x').join('\n');
      fs.writeFileSync(path.join(root, 'src/short.ts'), lines, 'utf8');
      const issues = validatePlan({
        root,
        planText: 'Bug in `src/short.ts` line 1000 near logic.\n',
      });
      const lr = issues.filter((i) => i.kind === 'line_range_too_large');
      expect(lr.length).toBeGreaterThan(0);
      expect(lr[0]?.detail).toContain('1000');
      expect(lr[0]?.detail).toContain('100 lines');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('suggests path for missing citation when basename exists elsewhere', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-val-p'));
    try {
      fs.mkdirSync(path.join(root, 'src/auth'), { recursive: true });
      fs.writeFileSync(path.join(root, 'src/auth/main.ts'), 'export {}\n', 'utf8');
      const issues = validatePlan({
        root,
        planText: 'Touch `src/auth/index.ts`.\n',
      });
      const mp = issues.filter((i) => i.kind === 'missing_path');
      expect(mp.length).toBe(1);
      expect(mp[0]?.detail).toMatch(/did you mean/i);
      expect(mp[0]?.detail).toContain('src/auth/main.ts');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('suggests symbol when typo vs definition', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-val-sym'));
    try {
      fs.mkdirSync(path.join(root, 'src'), { recursive: true });
      fs.writeFileSync(
        path.join(root, 'src/h.ts'),
        'export function handleRequest() { return 1; }\n',
        'utf8',
      );
      const issues = validatePlan({
        root,
        planText: '`handelRequest` in `src/h.ts`.\n',
      });
      const sn = issues.filter((i) => i.kind === 'symbol_not_found');
      expect(sn.length).toBe(1);
      expect(sn[0]?.detail).toMatch(/did you mean/i);
      expect(sn[0]?.detail).toContain('handleRequest');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('dedupes heading + backtick claims for same path', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-val-dd'));
    try {
      const issues = validatePlan({
        root,
        planText: '**File:** `src/nope.ts` **\n\nAlso see `src/nope.ts` for more.\n',
      });
      expect(issues.filter((i) => i.kind === 'missing_path' && i.path === 'src/nope.ts')).toHaveLength(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('reads each cited file once per validatePlan call', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-val-cache'));
    try {
      fs.mkdirSync(path.join(root, 'src'), { recursive: true });
      fs.writeFileSync(path.join(root, 'src/a.ts'), 'one\ntwo\nthree\n', 'utf8');
      const spy = vi.spyOn(fs, 'readFileSync');
      validatePlan({
        root,
        planText:
          '`src/a.ts` lines 1–2\n`src/a.ts` line 3\nCalls `someSym` in `src/a.ts`.\n',
      });
      const hits = spy.mock.calls.filter((c) => {
        const p = String(c[0]).replace(/\\/g, '/');
        return p.endsWith('src/a.ts');
      });
      expect(hits.length).toBe(1);
      spy.mockRestore();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
