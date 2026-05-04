import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildRepoMap } from '../src/core/repo-map.js';

describe('buildRepoMap tree format', () => {
  it('includes file sizes and tree structure', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-tree-'));
    try {
      fs.mkdirSync(path.join(root, 'pkg'), { recursive: true });
      fs.writeFileSync(path.join(root, 'pkg', 'a.ts'), 'x'.repeat(2048), 'utf8');
      const out = buildRepoMap(root, { format: 'tree', maxEntries: 100 });
      expect(out).toContain('pkg/');
      expect(out).toContain('a.ts');
      expect(out).toMatch(/KB/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
