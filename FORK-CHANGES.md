# Fork Changes

This is a fork of [AzmSquad/Squad-Kit](https://github.com/AzmSquad/Squad-Kit), based on upstream version **0.11.0**.

**One-line purpose:** Run entirely on Claude Code login (no Anthropic API key), with a local-first plan workflow and optional Azure DevOps logging.

---

## 1. Removed — external API planner

The direct API planner has been removed to eliminate the dependency on an Anthropic API key. Everything that used `--api` now redirects to `/squad-plan-generate` inside Claude Code.

- `squad new-plan --api` removed; the flag is still accepted but prints a redirect message pointing to `/squad-plan-generate`.
- Removed flags from `new-plan`: `--scout`, `--scout-model`, `--max-scout-files`, `--no-validation`, `--strict-validation`, `--anthropic-runtime`, `--effort`, `--scout-effort`, `--no-thinking`.
- Removed `--planner` / `--no-planner` from `init`; `init` no longer prompts for a provider or API key.
- Removed planner health checks from `squad doctor`: `planner-config`, `planner-cred`, `planner-model`.
- `squad status` shows a `/squad-plan-generate` hint instead of planner status.

---

## 2. Added — `/squad-plan-generate` (Claude Code planner)

Replaces `squad new-plan --api` with a slash command that runs entirely inside the Claude Code session.

- **File:** `templates/agents/claude-code/squad-plan-generate.md`
- Enforces the same anti-hallucination rules and plan structure as the old `--api` path.
- No API key required — uses the active Claude Code login.
- Installed automatically by `squad init --agents claude-code`.

Also added:

- **`/squad-implement`** (`templates/agents/claude-code/squad-implement.md`) — executes a plan in a fresh Claude Code session, attaching only the plan file so the executor has a bounded context.

---

## 3. Added — local-first quick workflow

Allows going from a raw problem description to a reviewable plan without any tracker interaction.

### `squad quick-story --feature <slug>`

- **File:** `src/commands/quick-story.ts`
- Registered in `src/cli.ts`.
- Creates `.squad/stories/<slug>/q-<slug>/intake.md` with a "Local quick story" banner — no tracker fetch, no PAT needed.
- Id convention: folder is named `q-<slug>` (or `q-<slug>-2`, `q-<slug>-3`, … on collision).
- `--json` outputs `{ featureSlug, storyFolderName, intakePath }` for agent consumption.

### `/squad-quick "<raw description>"`

- **File:** `templates/agents/claude-code/squad-quick.md`
- Installed by `squad init --agents claude-code`.
- Analyzes the codebase **once** from the raw description, fills the intake (title, description, AC, technical hints), generates the plan via the `/squad-plan-generate` logic, then stops for review.
- Never touches the tracker. Reminds the user to run `/squad-log` afterward if Azure logging is wanted.

### Id convention

| Folder name | Origin |
| --- | --- |
| `6521/` | Azure-sourced (bare numeric id from `squad new-story --id`) |
| `q-stats-filter/` | Local quick story, no tracker yet |

The `q-` prefix makes quick stories visually distinct and prevents any collision with numeric Azure ids.

---

## 4. Added — Azure DevOps write + logging

Adds the ability to create work items on Azure DevOps, used by `/squad-log` to document completed work after the fact.

### Types (`src/tracker/types.ts`)

Added:
- `WorkItemKind` — `'Task' | 'Bug' | 'User Story'`
- `CreateWorkItemInput` — kind, title, description, acceptanceCriteria, parentId, areaPath, iterationPath, tags
- `CreateWorkItemResult` — id, title, kind, url
- Optional `createWorkItem?(input): Promise<CreateWorkItemResult>` on `TrackerClient` — Jira and GitHub are unaffected (no implementation required).

### Azure client (`src/tracker/azure.ts`)

Added `createWorkItem()` to `AzureDevOpsClient`:
- JSON-Patch POST to `workitems/$<kind>?api-version=...` with `application/json-patch+json`.
- Builds ops for Title, Description, AcceptanceCriteria, AreaPath, IterationPath, Tags.
- Parent link via `System.LinkTypes.Hierarchy-Reverse` when `parentId` is set.
- On HTTP 401/403, throws `TrackerError('auth')` with a message about needing "Work Items (Read & Write)" PAT scope.

### `squad push-work-item`

- **File:** `src/commands/push-work-item.ts`
- Registered in `src/cli.ts`.
- Options: `--kind`, `--title`, `--description`, `--acceptance`, `--parent`, `--area`, `--iteration`, `--tags`, `--json`.
- Validates kind is one of Task/Bug/"User Story".
- Errors clearly if the tracker client does not implement `createWorkItem` (non-Azure trackers).
- `--json` outputs the `CreateWorkItemResult` for agent parsing.
- **Requires the Azure PAT to have "Work Items (Read & Write)" scope.**

### `/squad-log`

- **File:** `templates/agents/claude-code/squad-log.md`
- Installed by `squad init --agents claude-code`.
- Accepts: `--kind <kind> [--parent <id>] <q-id-or-intake-path>`.
- Reads the existing intake + plan and summarizes them — **never re-analyzes the codebase**.
- Calls `squad push-work-item --json` to create the Azure work item.
- Appends a `> Logged to tracker: [id](url) — kind, created date.` reference into the intake without renaming the folder.

---

## 5. Workflow summary

```
Local-first (no tracker):
  /squad-quick "<raw description>"
      → analyzes codebase
      → squad quick-story --feature <slug> --json   (creates q-<slug>/intake.md)
      → fills intake + generates plan
  [review plan]
  /squad-implement .squad/plans/<feature>/NN-story-<slug>.md
  [optionally:]
  /squad-log --kind Bug --parent 6432 q-<slug>
      → reads intake + plan (no re-analysis)
      → squad push-work-item --json
      → appends tracker reference into intake

Tracker-first (Azure / Jira):
  squad new-story <feature> --id <tracker-id>
  [fill intake Technical Hints]
  /squad-plan-generate .squad/stories/<feature>/<id>/intake.md
  /squad-implement .squad/plans/<feature>/NN-story-<id>.md
```

---

## 6. Install from this fork

```bash
pnpm install
pnpm run build:cli
npm install -g .
```

Requires Node 18+.
