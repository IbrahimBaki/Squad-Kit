import type { Budget } from '../budget.js';
import type { PlannerEventBus } from '../events.js';
import type { ReadFileToolHooks, ReadFileToolOptions } from './read-file.js';
import { readFileToolFactory } from './read-file.js';
import { grepToolFactory, type GrepToolHooks } from './grep.js';
import { listDirToolFactory, type ListDirToolHooks } from './list-dir.js';

export {
  readFileTool,
  readFileToolFactory,
  READ_FILE_TOOL_NAME,
  PlannerUserCancelledError,
  looksBinary,
  MAX_BYTES_PER_FULL_READ,
} from './read-file.js';
export type { ReadFileResult, ReadFileToolHooks, ReadFileToolOptions } from './read-file.js';
export { grepToolFactory, GREP_TOOL_NAME } from './grep.js';
export { listDirToolFactory, LIST_DIR_TOOL_NAME } from './list-dir.js';

export interface ToolFactoryOptions {
  root: string;
  budget: Budget;
  enabled?: { rangedRead?: boolean; grep?: boolean; listDir?: boolean };
  readHooks: ReadFileToolHooks;
  grepHooks?: GrepToolHooks;
  listDirHooks?: ListDirToolHooks;
}

export function buildPlannerTools(opts: ToolFactoryOptions) {
  const enabled = opts.enabled ?? { rangedRead: true, grep: true, listDir: true };
  const gh: GrepToolHooks =
    opts.grepHooks ??
    ({
      runId: opts.readHooks.runId,
      turn: opts.readHooks.turn,
      bus: opts.readHooks.bus,
      onToolCall: opts.readHooks.onToolCall,
    } satisfies GrepToolHooks);
  const lh: ListDirToolHooks =
    opts.listDirHooks ??
    ({
      runId: opts.readHooks.runId,
      turn: opts.readHooks.turn,
      bus: opts.readHooks.bus,
      onToolCall: opts.readHooks.onToolCall,
    } satisfies ListDirToolHooks);

  const readOpts: ReadFileToolOptions = { ranged: enabled.rangedRead ?? true };
  return {
    read_file: readFileToolFactory(opts.root, opts.budget, opts.readHooks, readOpts),
    ...(enabled.grep ? { grep: grepToolFactory(opts.root, opts.budget, gh) } : {}),
    ...(enabled.listDir ? { list_dir: listDirToolFactory(opts.root, opts.budget, lh) } : {}),
  };
}
