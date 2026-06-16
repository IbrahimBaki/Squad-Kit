export type TrackerName = 'jira' | 'azure' | 'github';

export interface FetchIssueResult {
  id: string; // canonical id, e.g. "PROJ-123" (Jira) or "42" (Azure)
  title: string;
  description: string; // plain text, may contain blank lines
  /** Plain text when the tracker exposes it (e.g. Azure); empty string otherwise. */
  acceptanceCriteria: string;
  url: string; // web URL for the human
  labels: string[];
  type?: string; // "Story" | "Bug" | "Task" | …
  assignee?: string;
  status?: string; // optional status/workflow name
  attachments: AttachmentRef[];
  fetchedAt: string; // ISO-8601 UTC
}

export interface AttachmentRef {
  filename: string; // already sanitized
  url: string; // authenticated download URL
  size: number; // bytes; may be 0 if unknown
  mimeType?: string;
}

export interface DownloadedAttachment {
  source: AttachmentRef;
  outcome: 'written' | 'skipped-oversize' | 'skipped-error';
  bytesWritten: number;
  absolutePath?: string; // present when outcome === 'written'
  skipReason?: string; // present when outcome starts with 'skipped-'
}

/** Subset of issue fields for search result lists. */
export type SearchIssueRow = Pick<FetchIssueResult, 'id' | 'title' | 'type' | 'status' | 'url'>;

export interface TrackerClient {
  readonly name: TrackerName;
  fetchIssue(id: string): Promise<FetchIssueResult>;
  /**
   * Find issues by id, free-text, or recent (empty query → recently updated).
   * Default limit 25.
   */
  searchIssues(query: string, opts?: { limit?: number }): Promise<SearchIssueRow[]>;
  /**
   * Authenticated per-attachment download. Caller passes the directory;
   * client returns one record per attachment describing the outcome.
   * Never throws for a single-file failure; only throws for catastrophic
   * errors (auth revoked mid-session, etc.).
   */
  downloadAttachments(
    refs: AttachmentRef[],
    targetDir: string,
    opts?: DownloadOptions,
  ): Promise<DownloadedAttachment[]>;
  /** Create a new work item. Optional — only implemented by Azure DevOps. */
  createWorkItem?(input: CreateWorkItemInput): Promise<CreateWorkItemResult>;
}

export interface DownloadOptions {
  maxMegabytes?: number; // default 10
}

export class TrackerError extends Error {
  constructor(
    message: string,
    public readonly kind: 'auth' | 'not-found' | 'rate-limited' | 'network' | 'other',
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'TrackerError';
  }
}

export type WorkItemKind = 'Task' | 'Bug' | 'User Story';

export interface CreateWorkItemInput {
  kind: WorkItemKind;
  title: string;
  description?: string;
  acceptanceCriteria?: string;
  parentId?: string;
  areaPath?: string;
  iterationPath?: string;
  tags?: string[];
}

export interface CreateWorkItemResult {
  id: string;
  title: string;
  kind: string;
  url: string;
}
