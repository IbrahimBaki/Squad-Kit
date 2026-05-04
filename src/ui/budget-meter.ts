import kleur from 'kleur';

export interface BudgetSnapshot {
  reads: number;
  readsCap: number;
  bytes: number;
  bytesCap: number;
  elapsedMs: number;
  durationMsCap: number;
}

function segmentStyle(ratio: number): (s: string) => string {
  if (ratio >= 0.9) return kleur.red;
  if (ratio >= 0.7) return kleur.yellow;
  return (s: string) => s;
}

function fmtRatio(n: number, cap: number): { text: string; ratio: number } {
  const safeCap = cap > 0 ? cap : 1;
  const ratio = Math.min(1, n / safeCap);
  const text = `${n}/${cap}`;
  return { text, ratio };
}

function fmtTimeSeg(elapsedMs: number, capMs: number): { text: string; ratio: number } {
  const elapsedSec = Math.max(0, Math.round(elapsedMs / 1000));
  const capSec = capMs > 0 ? Math.round(capMs / 1000) : 0;
  const safeCap = capSec > 0 ? capSec : 1;
  const ratio = capSec > 0 ? Math.min(1, elapsedSec / safeCap) : 0;
  return { text: `${elapsedSec}/${capSec}s`, ratio };
}

/**
 * Returns:  reads 18/25 · ctx 41/50 KB · time 142/180s
 * Each segment colored neutral / amber (≥70%) / red (≥90%) by its own ratio.
 */
export function formatBudgetMeter(b: BudgetSnapshot): string {
  const ctxKb = Math.round(b.bytes / 1024);
  const ctxCapKb = Math.round(b.bytesCap / 1024);
  const reads = fmtRatio(b.reads, b.readsCap);
  const ctx = fmtRatio(ctxKb, ctxCapKb);
  const time = fmtTimeSeg(b.elapsedMs, b.durationMsCap);

  const readsS = segmentStyle(reads.ratio)(`reads ${reads.text}`);
  const ctxS = segmentStyle(ctx.ratio)(`ctx ${ctx.text} KB`);
  const timeS = segmentStyle(time.ratio)(`time ${time.text}`);

  return `${readsS} · ${ctxS} · ${timeS}`;
}
