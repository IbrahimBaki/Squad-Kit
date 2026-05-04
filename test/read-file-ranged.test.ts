import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFileTool } from '../src/planner/tools/index.js';
import { Budget } from '../src/planner/budget.js';

const budgetCfg = {
  maxFileReads: 25,
  maxContextBytes: 500_000,
  maxDurationSeconds: 120,
};

describe('readFileTool ranged', () => {
  it('returns numbered lines for offset/limit', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-ranged-'));
    try {
      fs.writeFileSync(path.join(root, 'f.txt'), 'a\nb\nc\nd\n', 'utf8');
      const budget = new Budget(budgetCfg);
      const r = readFileTool(root, budget, { path: 'f.txt', offset: 2, limit: 2 });
      expect(r.isError).toBe(false);
      expect(r.content).toContain('2│ b');
      expect(r.content).toContain('3│ c');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('errors when offset past EOF', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-ranged-'));
    try {
      fs.writeFileSync(path.join(root, 'f.txt'), 'one\n', 'utf8');
      const budget = new Budget(budgetCfg);
      const r = readFileTool(root, budget, { path: 'f.txt', offset: 10, limit: 1 });
      expect(r.isError).toBe(true);
      expect(r.content).toMatch(/past the end/i);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
