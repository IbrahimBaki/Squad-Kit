export interface ApiStory {
  feature: string;
  id: string;
  intakePath: string;
  storyDir: string;
  planFile: string | null;
  titleHint: string | null;
}

export interface ApiStoryDetail extends ApiStory {
  intakeContent: string;
}

/** Composed copy-paste plan meta-prompt (same bytes as `squad new-plan --copy`). */
export interface ApiCopyPlanPrompt {
  prompt: string;
  feature: string;
  storyId: string;
  bytes: number;
  estTokensApprox: number;
}

export interface ApiPlan {
  feature: string;
  planFile: string;
  metadata: { provider?: string; model?: string; generatedBy?: string };
}

export interface ApiPlanDetail extends ApiPlan {
  content: string;
  absPath: string;
}

export interface ApiCreatedStory {
  storyDir: string;
  intakePath: string;
  feature: string;
  id: string;
}

export type PlanDiffChange = {
  value: string;
  added?: boolean;
  removed?: boolean;
};

export interface ApiPlanDiff {
  feature: string;
  a: string;
  b: string;
  changes: PlanDiffChange[];
}

export interface ApiMeta {
  version: string;
  root: string;
  project: { name: string; primaryLanguage?: string; projectRoots?: string[] };
  planner: { provider: string; enabled: boolean } | null;
  tracker: { type: string };
  /** Omitted when no `.last-run.json` exists. */
  lastRun?: ApiLastRun | null;
}

export interface ApiDashboardRun {
  runId: string;
  startedAt: string;
  durationMs: number;
  success: boolean;
  partial: boolean;
  inputTokens: number;
  outputTokens: number;
  cacheHitRatio: number;
}

export interface ApiDashboard {
  version: string;
  root: string;
  project: ApiMeta['project'];
  planner: ApiMeta['planner'];
  tracker: ApiMeta['tracker'];
  lastRun: ApiLastRun | null;
  runs: ApiDashboardRun[];
  storyCounts: { total: number; planned: number; unplanned: number };
  stories: ApiStory[];
}

export interface ApiRecentProject {
  root: string;
  lastOpenedAt: string;
}

export interface ApiActiveRun {
  runId: string;
  feature: string;
  storyId: string;
  startedAt: number;
}

/** Subset of squad config exposed to the console UI. */
export interface ApiConfig {
  planner?: { enabled: boolean; provider?: string };
  project?: { name: string; primaryLanguage?: string };
  tracker?: { type: string };
  version?: number;
}

export interface ApiLastRun {
  stats: {
    turns: number;
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    cacheHitRatio: number;
    durationMs: number;
  };
  completedAt: string;
  provider: string;
  model: string;
  version: 1;
}

/** Wire shape parsed from SSE JSON payloads on `/api/runs/:id/stream`. */
export interface PlannerStreamEventWire {
  kind: string;
  runId?: string;
  turn?: number;
  success?: boolean;
  planFile?: string | null;
  partial?: boolean;
  message?: string;
  waitSec?: number;
  retryAfterSec?: number;
  capSec?: number;
  phase?: 'retrying' | 'aborted';
  provider?: 'anthropic' | 'openai' | 'google';
  rawBody?: string;
  delta?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheCreationTokens?: number;
    cacheReadTokens?: number;
  };
  cacheHitRatio?: number;
  toolCall?: { input?: Record<string, unknown>; name?: string };
  bytesLoaded?: number;
  totalBytes?: number;
  toolCallId?: string;
  name?: string;
  input?: Record<string, unknown>;
  durationMs?: number;
  isError?: boolean;
  errorSnippet?: string;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  stopReason?: string;
  stage?: 'scout' | 'draft' | 'validation';
  errorMessage?: string;
  severity?: 'warning' | 'error';
  issueKind?: 'missing_path' | 'line_range_too_large' | 'symbol_not_found' | 'malformed_metadata';
  path?: string;
  detail?: string;
  excerpt?: string;
  selected?: string[];
  reasoning?: string;
  model?: string;
  runtimeKind?: 'vercel' | 'agent-sdk';
  cacheEnabled?: boolean;
  scoutEnabled?: boolean;
  validationEnabled?: boolean;
  budgetCaps?: { maxFileReads: number; maxContextBytes: number; maxDurationSeconds: number };
  providerOptions?: {
    anthropic?: {
      thinking?: 'adaptive' | 'enabled' | 'disabled' | 'off';
      effort?: 'minimal' | 'medium' | 'high';
      effortByPhase?: { scout?: 'minimal' | 'medium' | 'high'; draft?: 'minimal' | 'medium' | 'high' };
    };
  };
  blockIndex?: number;
  tokensUsed?: number;
  chars?: number;
}

export interface ApiRunStats {
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  cacheHitRatio: number;
  durationMs: number;
}

/** Persisted planner run (`GET /api/runs`) — aligns with `.squad/runs/<id>.json`. */
export interface ApiRunRecord {
  runId: string;
  provider: string;
  model: string;
  feature: string;
  storyId: string;
  startedAt: string;
  completedAt: string;
  success: boolean;
  partial: boolean;
  planFile: string | null;
  durationMs: number;
  version: 1;
  stats?: ApiRunStats;
  cacheEnabled?: boolean;
  validation?: {
    enabled: boolean;
    issuesCount: number;
    issuesByKind?: Partial<
      Record<'missing_path' | 'line_range_too_large' | 'symbol_not_found' | 'malformed_metadata', number>
    >;
    durationMs?: number;
  };
  plannerRuntime?: { kind: 'vercel' | 'agent-sdk'; provider: string };
  providerOptionsSnapshot?: PlannerStreamEventWire['providerOptions'];
}

export interface ApiRunEventsPage {
  runId: string;
  fromIndex: number;
  limit: number;
  total: number;
  events: PlannerStreamEventWire[];
}
