---
description: Generate an implementation plan from a squad-kit story intake — runs inside Claude Code, no API key needed.
---

You are generating an **agent-executable implementation plan** for this project using the squad-kit workflow.
This command is the primary way to generate plans in this fork. It replaces `squad new-plan --api` and uses your Claude Code session directly.

## Input

**Intake file path:** `$ARGUMENTS`
- If empty, list `.squad/stories/` and ask which intake to use.
- The intake is at `.squad/stories/<feature>/<id>/intake.md`

## Step 0 — Read project config

Read `.squad/config.yaml` and extract:
- `project.projectRoots` (default: `.`)
- `project.primaryLanguage`
- `tracker.type`
- `naming.includeTrackerId`
- `naming.globalSequence`

## Step 1 — Read the intake

Read the file at `$ARGUMENTS` and every file listed in its `## Attachments` section.

Extract: feature slug, tracker id, title, description, acceptance criteria, dependencies, technical hints.

## Step 2 — Determine sequence number

Scan `.squad/plans/` for all `NN-story-*.md` files.
- `naming.globalSequence: true` → highest NN across all features + 1
- `naming.globalSequence: false` → highest NN in `.squad/plans/<feature-slug>/` only + 1

Zero-pad to 2 digits: `01`, `02`, `13`.

## Step 3 — Mandatory codebase exploration (do NOT skip)

**3a. Map the area** — list the directories the intake mentions. Confirm file names exist.

**3b. Find symbols** — grep for function names, class names, or strings cited in the intake and tech hints. Capture which files contain them.

**3c. Read targeted regions** — for each file you will cite, read the specific function/class section. Capture exact line numbers.

**3d. Find a prior plan** — read at least one existing plan in `.squad/plans/` to match tone and structure. If none exist, skip.

## Step 4 — Write the plan file

Path:
- With tracker id: `.squad/plans/<feature-slug>/NN-story-<slug>-<id>.md`
- Without: `.squad/plans/<feature-slug>/NN-story-<slug>.md`

Start the file with `# Story NN — <title>` (no metadata comment — that is only for `--api` runs).

**Required sections in order:**

```
## Prerequisites
## Story Goal
## Context — Read These Files First
## [Backend/Frontend/Implementation] Tasks
  ### 1 — <title>
  **File: `path`** or **Create file: `path`**
## Edge Cases & Failure Modes   ← mandatory
## Test Plan                    ← mandatory
## [Migration / Rollback]       ← optional
## Verification Steps           ← mandatory
## Done Criteria                ← mandatory
```

**Anti-hallucination rules — enforce strictly:**
- No invented paths — every path must come from your Step 3 exploration
- No invented line numbers — every range must come from files you actually read
- No invented symbols — every function/class/constant must appear in code you read
- No "consider", "might", "potentially" — a plan is a contract

## Step 5 — Update overview and index

Create `.squad/plans/<feature-slug>/00-overview.md` if it does not exist, then add a row.
Update `.squad/plans/00-index.md` if this is a new feature slug.

## Step 6 — Report

Tell the user:
- The plan file path written
- Title and sequence number
- One-line summary of the plan scope
- Reminder: "Open a new Claude Code session, attach ONLY this plan file, and implement it."
