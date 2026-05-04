import fs from 'node:fs';
import path from 'node:path';
import ignore, { type Ignore } from 'ignore';

export interface RepoMapOptions {
  maxEntries?: number; // safety cap on total paths returned
  includeHidden?: boolean;
  /** `flat` preserves historical one-path-per-line output; `tree` groups by directory with size hints. */
  format?: 'flat' | 'tree';
}

const DEFAULT_IGNORES = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
  '.cache',
  '.squad/plans', // don't include existing plans as context; planner will see them separately
];

export function buildRepoIgnore(root: string): Ignore {
  const ig = ignore().add(DEFAULT_IGNORES);
  const gitignore = path.join(root, '.gitignore');
  if (fs.existsSync(gitignore)) {
    try {
      ig.add(fs.readFileSync(gitignore, 'utf8'));
    } catch {
      /* ignore */
    }
  }
  return ig;
}

export function buildRepoMap(root: string, opts: RepoMapOptions = {}): string {
  const maxEntries = opts.maxEntries ?? 5000;
  const format = opts.format ?? 'flat';
  const ig = buildRepoIgnore(root);
  if (format === 'tree') {
    const entries: FileEntry[] = [];
    collectFileEntries(root, root, ig, entries, maxEntries, !!opts.includeHidden);
    entries.sort((a, b) => a.rel.localeCompare(b.rel));
    return renderRepoTree(entries) + '\n';
  }
  const entries: string[] = [];
  walkFlat(root, root, ig, entries, maxEntries, !!opts.includeHidden);
  entries.sort();
  return entries.join('\n') + '\n';
}

interface FileEntry {
  rel: string;
  size: number;
}

function formatSizeKb(n: number): string {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}

interface DirTree {
  files: Array<{ name: string; size: number }>;
  dirs: Map<string, DirTree>;
}

function insertTree(tree: DirTree, relParts: string[], size: number): void {
  if (relParts.length === 1) {
    tree.files.push({ name: relParts[0]!, size });
    return;
  }
  const [head, ...rest] = relParts;
  if (!tree.dirs.has(head!)) tree.dirs.set(head!, { files: [], dirs: new Map() });
  insertTree(tree.dirs.get(head!)!, rest, size);
}

function renderDirTree(name: string, tree: DirTree, depth: number): string[] {
  const lines: string[] = [];
  const indent = '  '.repeat(depth);
  if (name) {
    lines.push(`${indent}${name}/`);
  }
  const innerIndent = '  '.repeat(name ? depth + 1 : depth);
  const dirNames = [...tree.dirs.keys()].sort((a, b) => a.localeCompare(b));
  for (const d of dirNames) {
    lines.push(...renderDirTree(d, tree.dirs.get(d)!, name ? depth + 1 : depth));
  }
  tree.files.sort((a, b) => a.name.localeCompare(b.name));
  for (const f of tree.files) {
    const left = `${innerIndent}${f.name}`;
    const pad = Math.max(1, 48 - left.length);
    lines.push(`${left}${' '.repeat(pad)}${formatSizeKb(f.size)}`);
  }
  return lines;
}

function renderRepoTree(entries: FileEntry[]): string {
  const root: DirTree = { files: [], dirs: new Map() };
  for (const e of entries) {
    const parts = e.rel.split(path.sep).filter(Boolean);
    if (parts.length === 0) continue;
    insertTree(root, parts, e.size);
  }
  return renderDirTree('', root, 0).join('\n');
}

function collectFileEntries(
  root: string,
  dir: string,
  ig: Ignore,
  out: FileEntry[],
  max: number,
  includeHidden: boolean,
): FileEntry[] {
  if (out.length >= max) return out;
  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of dirents) {
    if (out.length >= max) break;
    if (!includeHidden && entry.name.startsWith('.') && entry.name !== '.squad') continue;

    const abs = path.join(dir, entry.name);
    const rel = path.relative(root, abs);
    if (!rel || ig.ignores(rel) || (entry.isDirectory() && ig.ignores(rel + '/'))) continue;

    if (entry.isDirectory()) {
      collectFileEntries(root, abs, ig, out, max, includeHidden);
    } else if (entry.isFile()) {
      let size = 0;
      try {
        size = fs.statSync(abs).size;
      } catch {
        size = 0;
      }
      out.push({ rel: rel.split(path.sep).join('/'), size });
    }
  }
  return out;
}

function walkFlat(root: string, dir: string, ig: Ignore, out: string[], max: number, includeHidden: boolean): void {
  if (out.length >= max) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (out.length >= max) return;
    if (!includeHidden && entry.name.startsWith('.') && entry.name !== '.squad') continue;

    const abs = path.join(dir, entry.name);
    const rel = path.relative(root, abs);
    if (!rel || ig.ignores(rel) || (entry.isDirectory() && ig.ignores(rel + '/'))) continue;

    if (entry.isDirectory()) {
      walkFlat(root, abs, ig, out, max, includeHidden);
    } else if (entry.isFile()) {
      out.push(rel.split(path.sep).join('/'));
    }
  }
}
