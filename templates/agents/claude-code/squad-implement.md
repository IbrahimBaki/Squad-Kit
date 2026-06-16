---
description: Implement a squad-kit plan file inside Claude Code.
---

Implement the feature described in a squad-kit plan file.

## Input

**Plan file path:** `$ARGUMENTS`
- If empty, list `.squad/plans/` and ask which plan to implement.

## Critical rules

1. Read the plan file completely first. It is the contract.
2. The plan is read-only — do not modify it unless explicitly asked.
3. Only touch files explicitly mentioned in the plan.
4. Complete each numbered task fully before moving to the next.

## Steps

**Phase 1 — Setup**
Read the full plan. Read all files in `## Context — Read These Files First` using the exact paths and line ranges given. Check `## Prerequisites` — if prior stories are listed, confirm they are done.

**Phase 2 — Implement**
Execute each task in the implementation section in order. Match the code style of the surrounding file. Do not add unrequested changes.

**Phase 3 — Verify**
Run all commands in `## Verification Steps`. Check each item in `## Done Criteria`.

**Phase 4 — Report**
Tell the user which tasks were completed, verification results, and any `## Done Criteria` items needing manual confirmation.
If the plan says `STOP HERE` — stop and wait.

## Notes
- If you hit a problem not in `## Edge Cases & Failure Modes` — pause and ask.
- If a path in the plan does not exist — report it, do not invent an alternative.
