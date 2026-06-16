---
description: From a raw problem description — analyze the codebase, create a local intake, and generate a plan. No tracker.
---

The user gives you a **raw, freeform description** of a bug to fix or a small feature to build. You take it all the way to a reviewable plan, entirely locally — no tracker involved.

## Input

`$ARGUMENTS` = a raw description, optionally starting with `--feature <slug>`.

Examples:
```
/squad-quick "in stats In Probation, In Notice Period and Employment Type these stats not reflected with filters"
/squad-quick --feature perf-dashboard "in account/performance-dashboard add a department filter and replace the evaluation-started card with General Average Rating"
```

## Steps

1. **Determine the feature slug.**
   - If the user passed `--feature`, use it.
   - Otherwise derive a short kebab-case slug from the description (e.g. "stats-filter", "perf-dashboard"). Keep it 1–3 words.

2. **Investigate the codebase** (the core value — do this thoroughly):
   - Locate the screens/components/files the description references.
   - Trace the relevant logic; for a bug, find the likely root cause file(s) and line(s). Do NOT fix anything yet.
   - Note existing patterns the work should follow.

3. **Create the local intake:**
   ```
   squad quick-story --feature <slug> --title "<short title you composed>" --json
   ```
   Parse the JSON to get the `intakePath`.

4. **Fill the intake** at `intakePath`. Write directly into the file:
   - **Title** — your composed title.
   - **Description** — a structured rewrite of the raw input, grounded in the real files you found.
   - **Acceptance Criteria** — what "done" means, testable.
   - **Technical Hints** — the actual file paths, classes, functions, and (for a bug) the suspected root cause with line numbers from your investigation.
   - **Out of Scope** — anything explicitly excluded.

5. **Generate the plan** by running the `/squad-plan-generate` logic against `intakePath`
   (read `.squad/config.yaml`, do the mandatory exploration, write the plan file with the full required structure, update the overview/index).

6. **STOP after the plan.** Report the plan file path and a one-line summary.
   Remind the user: "Review the plan, then run `/squad-implement <plan-path>` in a new session. After implementing, run `/squad-log` if you want to document it on Azure."

## Notes
- YOU compose the title/description/AC from your analysis — never ask the user to write them.
- This never touches the tracker. The intake id will be `q-<slug>`.
