import kleur from 'kleur';
import { dim } from './theme.js';

export type StageState = 'pending' | 'running' | 'success' | 'failed' | 'skipped';

export interface StageLine {
  scout: StageState;
  draft: StageState;
  validation: StageState;
}

const segSep = () => ` ${dim('──▶')} `;

function fmtStage(name: string, state: StageState): string {
  switch (state) {
    case 'pending':
      return `${dim(`○${name}`)}`;
    case 'running':
      return `${kleur.cyan(`●${name}`)}${kleur.cyan(' ▰▰▱')}`;
    case 'success':
      return `${kleur.green(`●${name} ✓`)}`;
    case 'failed':
      return `${kleur.red(`●${name} ✗`)}`;
    case 'skipped':
      return `${dim(`○${name} (skipped)`)}`;
    default:
      return dim(`○${name}`);
  }
}

/**
 * Returns a single line like:  ●scout ✓ ──▶ ●draft ▰▰▱ ──▶ ○validation
 * Color: cyan for running, green for success, red for failed, dim for pending/skipped.
 */
export function formatStagePipeline(line: StageLine): string {
  const sep = segSep();
  return [fmtStage('scout', line.scout), fmtStage('draft', line.draft), fmtStage('validation', line.validation)].join(
    sep,
  );
}

/** Option A: fresh line per update so scrollback stays CI-friendly. */
export function printStagePipeline(line: StageLine): void {
  process.stderr.write(`  ${dim('→')} ${formatStagePipeline(line)}\n`);
}
