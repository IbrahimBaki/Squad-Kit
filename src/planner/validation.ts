import fs from 'node:fs';
import path from 'node:path';
import { buildRepoIgnore } from '../core/repo-map.js';

const CODE_EXT =
  /\.(ts|tsx|js|jsx|mjs|cjs|md|json|ya?ml|css|html|py|go|rs|cs|java|kt|kts|swift|rb|php|vue|svelte)$/i;

export interface ValidationIssue {
  severity: 'warning' | 'error';
  kind: 'missing_path' | 'line_range_too_large' | 'symbol_not_found' | 'malformed_metadata';
  path?: string;
  detail: string;
  excerpt?: string;
}

export interface ValidatePlanInput {
  root: string;
  planText: string;
}

interface PathClaim {
  path: string;
  isCreate: boolean;
  excerpt: string;
}

/** Per-call breakdown for run telemetry. */
export function summariseIssuesByKind(
  issues: ValidationIssue[],
): Partial<Record<ValidationIssue['kind'], number>> {
  const out: Partial<Record<ValidationIssue['kind'], number>> = {};
  for (const i of issues) {
    out[i.kind] = (out[i.kind] ?? 0) + 1;
  }
  return out;
}

/** Extract backtick-enclosed segments that look like repo paths. */
function extractBacktickPaths(planText: string): PathClaim[] {
  const claims: PathClaim[] = [];
  const re = /`([^`\n]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(planText)) !== null) {
    const inner = m[1]!.trim();
    if (!inner.includes('/') || inner.startsWith('http')) continue;
    if (inner.includes('story ') || inner.includes('Story ')) continue;
    const seg = inner.split(/[\s:]/)[0];
    if (!seg || !CODE_EXT.test(seg)) continue;
    claims.push({ path: seg.replace(/^\.\//, ''), isCreate: false, excerpt: m[0]! });
  }
  return claims;
}

function extractFileHeadingPaths(planText: string): PathClaim[] {
  const claims: PathClaim[] = [];
  const fileRe = /\*\*\s*(?:File|Create file)\s*:\s*`([^`\n]+)`\s*\*\*/gi;
  let m: RegExpExecArray | null;
  while ((m = fileRe.exec(planText)) !== null) {
    const p = m[1]!.trim().replace(/^\.\//, '');
    const isCreate = /create file/i.test(m[0]!);
    claims.push({ path: p, isCreate, excerpt: m[0]!.slice(0, 120) });
  }
  return claims;
}

function mergePathClaims(planText: string): PathClaim[] {
  const map = new Map<string, PathClaim>();
  for (const c of [...extractFileHeadingPaths(planText), ...extractBacktickPaths(planText)]) {
    const key = `${c.isCreate}:${c.path}`;
    if (!map.has(key)) map.set(key, c);
  }
  return [...map.values()];
}

const LINE_RANGE_RE = /(?:~?\s*lines?\s*|lines\s+)(\d+)\s*[–-]\s*(\d+)/gi;

/** Single-line citations: `line N`, `(LN)`. */
const LINE_SINGLE_WORD_RE = /\bline\s+(\d+)\b|\(L(\d+)\)/gi;

/** Path followed by `:line` (same line common in prose). */
const PATH_COLON_LINE_RE = /`([^`\n]+\.[a-z0-9]{1,6})`\s*:\s*(\d+)\b/gi;

function pathNear(planText: string, idx: number): string | undefined {
  const before = planText.slice(Math.max(0, idx - 200), idx);
  const pathMatch = before.match(/`([^`\n]+\.[a-z0-9]{1,6})`/i);
  const filePath = pathMatch?.[1]?.trim().replace(/^\.\//, '');
  return filePath;
}

function trigrams(s: string): Set<string> {
  const x = s.toLowerCase();
  const g = new Set<string>();
  for (let i = 0; i + 3 <= x.length; i++) {
    g.add(x.slice(i, i + 3));
  }
  return g;
}

function trigramSimilarity(a: string, b: string): number {
  const A = trigrams(a);
  const B = trigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) {
    if (B.has(t)) inter += 1;
  }
  return inter / Math.sqrt(A.size * B.size);
}

function suggestPaths(root: string, missingRel: string, max = 3): string[] {
  const targetBase = path.basename(missingRel).toLowerCase();
  const ig = buildRepoIgnore(root);
  const candidates: string[] = [];

  const walk = (dir: string): void => {
    if (candidates.length >= 2000) return;
    let ents: fs.Dirent[];
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of ents) {
      if (candidates.length >= 2000) return;
      const abs = path.join(dir, ent.name);
      const rel = path.relative(root, abs).split(path.sep).join('/');
      if (!rel || ig.ignores(rel) || (ent.isDirectory() && ig.ignores(`${rel}/`))) continue;
      if (ent.isDirectory()) walk(abs);
      else if (ent.isFile()) candidates.push(rel);
    }
  };
  walk(root);

  type Row = { rel: string; score: number };
  const rows: Row[] = [];
  for (const rel of candidates) {
    const base = path.basename(rel).toLowerCase();
    let score = 0;
    if (base === targetBase) score = 1000;
    else if (base.startsWith(targetBase) || targetBase.startsWith(base)) score = 500;
    else if (base.includes(targetBase) || targetBase.includes(base)) score = 200;
    score += trigramSimilarity(targetBase, base) * 50;
    if (score > 0) rows.push({ rel, score });
  }
  rows.sort((a, b) => b.score - a.score || a.rel.localeCompare(b.rel));
  const uniq: string[] = [];
  for (const r of rows) {
    if (r.rel === missingRel.replace(/^\.\//, '')) continue;
    if (!uniq.includes(r.rel)) uniq.push(r.rel);
    if (uniq.length >= max) break;
  }
  return uniq;
}

const SYMBOL_DEF_RE =
  /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)/g;

function collectSymbols(src: string, maxLines = 200): string[] {
  const head = src.split(/\r?\n/).slice(0, maxLines).join('\n');
  const syms = new Set<string>();
  SYMBOL_DEF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SYMBOL_DEF_RE.exec(head)) !== null) {
    syms.add(m[1]!);
  }
  return [...syms];
}

function leadingCharScore(sym: string, missing: string): number {
  let i = 0;
  const a = sym.toLowerCase();
  const b = missing.toLowerCase();
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i * 10 + trigramSimilarity(sym, missing) * 30;
}

function suggestSymbols(fileText: string, missingSym: string, max = 3): string[] {
  const defs = collectSymbols(fileText);
  const ranked = defs
    .filter((s) => s !== missingSym)
    .map((s) => ({ s, score: leadingCharScore(s, missingSym) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.s.localeCompare(b.s));
  const out: string[] = [];
  for (const r of ranked) {
    if (!out.includes(r.s)) out.push(r.s);
    if (out.length >= max) break;
  }
  return out;
}

function parseMetadataLine(planText: string): ValidationIssue | undefined {
  const lines = planText.split(/\r?\n/);
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    const line = (lines[i] ?? '').trim();
    if (!line.startsWith('<!--') || !line.includes('squad-kit:')) continue;
    if (!line.endsWith('-->')) {
      return {
        severity: 'warning',
        kind: 'malformed_metadata',
        detail: 'Metadata comment is not a single-line <!-- squad-kit: … -->',
        excerpt: line.slice(0, 120),
      };
    }
    const inner = line.replace(/^<!--\s*squad-kit:\s*/i, '').replace(/\s*-->$/, '');
    if (!inner.trim()) {
      return {
        severity: 'warning',
        kind: 'malformed_metadata',
        detail: 'Empty squad-kit metadata body',
        excerpt: line,
      };
    }
    return undefined;
  }
  return undefined;
}

export function validatePlan(input: ValidatePlanInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const metaIssue = parseMetadataLine(input.planText);
  if (metaIssue) issues.push(metaIssue);

  const cache = new Map<string, { text: string; lines: number; isBinary: boolean }>();
  const readCached = (rel: string): { text: string; lines: number; isBinary: boolean } | undefined => {
    if (cache.has(rel)) return cache.get(rel);
    const resolved = path.resolve(input.root, rel);
    const rc = path.relative(input.root, resolved);
    if (rc.startsWith('..') || path.isAbsolute(rc)) return undefined;
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return undefined;
    try {
      const buf = fs.readFileSync(resolved);
      const isBinary = buf.includes(0);
      const text = isBinary ? '' : buf.toString('utf8');
      const lines = isBinary ? 0 : text.split(/\r?\n/).length;
      const entry = { text, lines, isBinary };
      cache.set(rel, entry);
      return entry;
    } catch {
      return undefined;
    }
  };

  const pathClaims = mergePathClaims(input.planText);
  for (const c of pathClaims) {
    if (c.isCreate) continue;
    const resolved = path.resolve(input.root, c.path);
    const rel = path.relative(input.root, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
    if (!fs.existsSync(resolved)) {
      const suggestions = suggestPaths(input.root, c.path);
      issues.push({
        severity: 'warning',
        kind: 'missing_path',
        path: c.path,
        detail:
          'Path cited in plan does not exist in the workspace' +
          (suggestions.length ? ` — did you mean: ${suggestions.join(', ')}?` : ''),
        excerpt: c.excerpt,
      });
    }
  }

  const rangeText = input.planText;
  LINE_RANGE_RE.lastIndex = 0;
  let rm: RegExpExecArray | null;
  while ((rm = LINE_RANGE_RE.exec(rangeText)) !== null) {
    const lo = parseInt(rm[1]!, 10);
    const hi = parseInt(rm[2]!, 10);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
    const filePath = pathNear(rangeText, rm.index);
    if (!filePath) continue;
    const cached = readCached(filePath);
    const lines = cached?.isBinary ? undefined : cached?.lines;
    if (lines !== undefined && hi > lines) {
      issues.push({
        severity: 'warning',
        kind: 'line_range_too_large',
        path: filePath,
        detail: `Range ends at line ${hi} but file has ${lines} lines`,
        excerpt: rm[0]!.slice(0, 80),
      });
    }
  }

  LINE_SINGLE_WORD_RE.lastIndex = 0;
  while ((rm = LINE_SINGLE_WORD_RE.exec(rangeText)) !== null) {
    const n = parseInt(rm[1] || rm[2] || '', 10);
    if (!Number.isFinite(n)) continue;
    const filePath = pathNear(rangeText, rm.index);
    if (!filePath) continue;
    const cached = readCached(filePath);
    const lines = cached?.isBinary ? undefined : cached?.lines;
    if (lines !== undefined && n > lines) {
      issues.push({
        severity: 'warning',
        kind: 'line_range_too_large',
        path: filePath,
        detail: `Range ends at line ${n} but file has ${lines} lines`,
        excerpt: rm[0]!.slice(0, 80),
      });
    }
  }

  PATH_COLON_LINE_RE.lastIndex = 0;
  while ((rm = PATH_COLON_LINE_RE.exec(rangeText)) !== null) {
    const fp = rm[1]!.trim().replace(/^\.\//, '');
    const n = parseInt(rm[2]!, 10);
    if (!Number.isFinite(n)) continue;
    const cached = readCached(fp);
    const lines = cached?.isBinary ? undefined : cached?.lines;
    if (lines !== undefined && n > lines) {
      issues.push({
        severity: 'warning',
        kind: 'line_range_too_large',
        path: fp,
        detail: `Range ends at line ${n} but file has ${lines} lines`,
        excerpt: rm[0]!.slice(0, 80),
      });
    }
  }

  const textByLine = input.planText.split(/\r?\n/);
  for (let li = 0; li < textByLine.length; li++) {
    const line = textByLine[li] ?? '';
    const near = [textByLine[li - 1] ?? '', line, textByLine[li + 1] ?? ''].join('\n');
    const pathNearCell = near.match(/`([^`\n/]+\/[^`\n]+?\.[a-z0-9]{1,6})`/i);
    if (!pathNearCell) continue;
    const fp = pathNearCell[1]!.replace(/^\.\//, '');
    const cached = readCached(fp);
    if (!cached || cached.isBinary) continue;
    const symRe = /`([A-Za-z_][A-Za-z0-9_]{2,50})`/g;
    let sm: RegExpExecArray | null;
    while ((sm = symRe.exec(line)) !== null) {
      const sym = sm[1]!;
      if (
        ['true', 'false', 'null', 'undefined', 'string', 'number', 'boolean', 'void', 'never'].includes(
          sym,
        )
      ) {
        continue;
      }
      if (!cached.text.includes(sym)) {
        const suggestions = suggestSymbols(cached.text, sym);
        issues.push({
          severity: 'warning',
          kind: 'symbol_not_found',
          path: fp,
          detail:
            `Symbol \`${sym}\` not found as substring in file` +
            (suggestions.length ? ` — did you mean: ${suggestions.map((s) => `\`${s}\``).join(', ')}?` : ''),
          excerpt: sm[0]!,
        });
      }
    }
  }

  return issues;
}
