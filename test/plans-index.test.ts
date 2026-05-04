import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPlansIndex } from '../src/core/plans-index.js';
import { buildPaths } from '../src/core/paths.js';

describe('buildPlansIndex', () => {
  it('returns bullet rows with titles from plan markdown', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-plansix-'));
    try {
      const paths = buildPaths(root);
      fs.mkdirSync(path.join(paths.plansDir, 'feat'), { recursive: true });
      fs.writeFileSync(
        path.join(paths.plansDir, 'feat', '01-story-alpha.md'),
        '# Alpha story title\n\nBody.\n',
        'utf8',
      );
      const idx = buildPlansIndex(paths);
      expect(idx).toContain('.squad/plans/feat/01-story-alpha.md');
      expect(idx).toContain('Alpha story title');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns placeholder when plans dir empty', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-plansix-empty-'));
    try {
      const paths = buildPaths(root);
      fs.mkdirSync(paths.plansDir, { recursive: true });
      expect(buildPlansIndex(paths)).toBe('(no prior plans yet)');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
