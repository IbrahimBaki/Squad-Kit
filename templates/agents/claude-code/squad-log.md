---
description: Document an already-completed quick story on Azure DevOps as a work item. Summarizes the existing intake + plan — does not re-analyze.
---

Create an Azure work item that **documents work already done**. This reads the existing intake + plan and summarizes them — it does NOT re-investigate the codebase.

## Input

`$ARGUMENTS` format:
```
--kind <Task|Bug|"User Story"> [--parent <ID>] <quick-story-id-or-intake-path>
```

Examples:
```
/squad-log --kind Bug --parent 6432 q-stats-filter
/squad-log --kind Task --parent 6521 q-perf-dashboard
```

## Steps

1. **Locate the quick story.**
   - If given a `q-...` id, find it under `.squad/stories/*/<id>/intake.md`.
   - If given a path, use it directly.
   - List `.squad/stories/` and ask which one if ambiguous or missing.

2. **Read the intake and the corresponding plan** (find the plan in `.squad/plans/<feature>/` matching the feature). Do NOT re-analyze the codebase — the analysis is already in these files.

3. **Compose the work item from what's already written:**
   - **Title** — from the intake title.
   - **Description** — a concise summary of the intake description + what the plan implemented. Frame it as completed/scoped work, not a fresh investigation.
   - **Acceptance criteria** — from the intake's acceptance criteria.

4. **Create the work item:**
   ```
   squad push-work-item --kind <KIND> --parent <PARENT_ID> --title "<TITLE>" --description "<DESC>" --acceptance "<AC>" --json
   ```
   (omit `--parent` if none given)

5. **Parse the JSON.** Get the new work-item `id` and `url`.

6. **Append a reference into the intake** (do NOT rename the folder). Add near the top of `intake.md`, just under the local-quick banner:
   ```
   > **Logged to tracker:** [<id>](<url>) — <kind>, created <date>.
   ```

7. **Report** the created work-item id and URL to the user.

## Notes
- This is documentation after the fact. The work item is created in New/Active state; set it to Resolved manually on the board if you wish.
- Never re-run codebase exploration here — `/squad-quick` already did that.
- If the PAT lacks write scope, `push-work-item` returns HTTP 403 — tell the user to regenerate it with "Work Items (Read & Write)".
