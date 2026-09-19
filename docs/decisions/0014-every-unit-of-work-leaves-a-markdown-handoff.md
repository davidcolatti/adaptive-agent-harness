---
status: accepted
date: 2026-09-19
deciders: project owner (build plan); recorded during M0
related: [0011, 0016]
supersedes: null
superseded_by: null
---

# ADR-0014: Every unit of work leaves a Markdown handoff (WORKLOG + current-state)

## Context

AD-014 requires the repository to maintain two mandatory progress files: `docs/context/
current-state.md` ("the concise current truth," containing current milestone, current task,
completed milestones/tasks, what works now, what is partially working, known failures, current
blockers, important active decisions, uncommitted/generated artifacts, exact next task, exact
verification command to run next, last successful `pnpm check`/`eve check`, and last commit SHA)
and `docs/progress/WORKLOG.md` ("append-only" and records "every material task"). AD-014 gives
the mandatory entry rules: log a `started` entry before material implementation; update/append
the result when the task stops for any reason; update `current-state.md` before ending the
session; never mark a task complete without verification results; record failed attempts when
they teach something relevant; include source links/paths for Vercel-facing technical choices;
milestone completion archives a snapshot under `docs/progress/milestones/mX.md`; and generated
code/compiler runs link back to their run IDs and work-log entry. It also states: "A coding agent
that reaches a context/session boundary MUST prioritize the handoff update before starting
unrelated work." Section 16 (Mandatory Task Execution Protocol) makes this the final two steps of
every task's lifecycle (steps 7-8: "RECORD RESULT" and "UPDATE HANDOFF"), and states that if a
task is interrupted after step 3 (started), "steps 7 and 8 become the highest-priority work
before continuing feature implementation."

## Decision

Every material task MUST append a `started` entry to `docs/progress/WORKLOG.md` before
implementation begins, and MUST update or append a result entry when the task stops, for any
reason (completed, blocked, or otherwise). `docs/context/current-state.md` MUST be updated before
ending any working session. No task may be recorded as `completed` without an accompanying
verification section (commands run and PASS/FAIL results). Each WORKLOG entry MUST use exactly
this template:

```md
## YYYY-MM-DD HH:mm — Mx-Ty — <task title>

**Status:** started | blocked | completed
**Actor/session:** <human or coding agent>
**Commit:** <sha or "not committed">

### Goal
...

### Implementation references
- package/version:
- installed docs read:
- official docs/repos/examples read:
- public types/exports inspected:
- selected documented pattern:

### Work completed
- ...

### Files changed
- ...

### Verification
- `command` — PASS/FAIL
- ...

### Decisions / deviations
- ...

### Known issues / blockers
- ...

### Next exact step
...
```

`WORKLOG.md` is append-only: existing entries MUST NOT be rewritten or deleted, only appended to
or followed by a later entry. Milestone completion MUST archive a snapshot under `docs/progress/
milestones/mX.md`. Generated code and compiler runs MUST link back to their run IDs and the
WORKLOG entry that produced them. If a coding agent is interrupted mid-task, updating the WORKLOG
result and `current-state.md` takes priority over any further feature work.

## Consequences

### Positive

- Any human or coding agent can resume work at any point using only `AGENTS.md` and
  `current-state.md` without needing prior chat/session context, per the documented read order
  (build plan §4 Documentation rules, Milestone 0).
- Creates a durable, chronological audit trail of implementation decisions, verification results,
  and deviations that survives across sessions, agents, and models.

### Negative

- Adds real per-task overhead (writing a `started` entry, an `Implementation references` section,
  and a result entry) on top of the implementation work itself, for every material task.
- Requires discipline to keep `current-state.md` concise and current rather than letting it drift
  from the append-only WORKLOG's more detailed history.

### Neutral

- Constrains every milestone; Milestone 0 (M0-T9, M0-T10) creates the required files and a
  lightweight verification script that fails milestone/task completion checks when
  `current-state.md` or `WORKLOG.md` is missing, a task claims `completed` without verification,
  or a referenced ADR is missing.
- Directly grounds the Definition of Done (§12): "`docs/progress/WORKLOG.md` contains the task
  result and verification" and "`docs/context/current-state.md` is updated with the exact next
  step" are both required for every task.

## Alternatives considered

- **Rely on git commit history and code comments alone for handoff context**: rejected; AD-014
  requires an explicit, structured, human-and-agent-readable Markdown handoff distinct from
  commit messages, specifically because commit history does not capture blockers, active
  decisions, or the exact next verification command.
- **Allow WORKLOG entries to be edited/rewritten after the fact**: rejected; AD-014 specifies
  `WORKLOG.md` is append-only.

## References

- `docs/milestones/build-plan.md` §1 AD-014, §12 Definition of Done, §16 Mandatory Task Execution
  Protocol, Milestone 0 (M0-T9, M0-T10)
- Related ADRs: 0011, 0016
- Related code paths: `docs/context/current-state.md`, `docs/progress/WORKLOG.md`,
  `docs/progress/milestones/`
