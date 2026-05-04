import fs from 'node:fs';
import path from 'node:path';
import type { SquadPaths } from './paths.js';

const MAX_ENTRIES = 30;

function firstMarkdownH1(src: string): string | undefined {
  const lines = src.split(/\r?\n/);
  for (const line of lines) {
    const m = /^\s*#\s+(.+?)\s*$/.exec(line);
    if (m) return m[1]!.trim();
  }
  return undefined;
}

function collectPlanMarkdownFiles(plansDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let ents: fs.Dirent[];
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of ents) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(abs);
      } else if (ent.isFile() && ent.name.endsWith('.md')) {
        if (ent.name === '00-index.md' || ent.name === '00-overview.md') continue;
        out.push(abs);
      }
    }
  };
  if (fs.existsSync(plansDir)) walk(plansDir);
  out.sort((a, b) => a.localeCompare(b));
  return out.slice(0, MAX_ENTRIES);
}

/**
 * Bullet list of existing plan documents under `.squad/plans/` for scout context (~≤30 rows).
 */
export function buildPlansIndex(paths: SquadPaths): string {
  const files = collectPlanMarkdownFiles(paths.plansDir);
  if (files.length === 0) return '(no prior plans yet)';

  const bullets: string[] = [];
  for (const abs of files) {
    const rel = path.relative(paths.root, abs).split(path.sep).join('/');
    let title = '';
    try {
      const raw = fs.readFileSync(abs, 'utf8');
      title = firstMarkdownH1(raw) ?? path.basename(abs);
    } catch {
      title = path.basename(abs);
    }
    bullets.push(`- ${rel} — "${title}"`);
  }
  return bullets.join('\n');
}
