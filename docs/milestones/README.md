# Milestones

This directory tracks planned implementation work: what each milestone contains, what it depends
on, and where each of its tasks currently stands.

## The authoritative plan

`build-plan.md` is the authoritative plan. It is a verbatim copy of the owner's document, and it
is **never edited directly**, not to fix a typo, not to record what actually happened, and not to
adjust a task that turned out to be wrong.

Changes to the plan are proposed as an ADR under `../decisions/`. The ADR records what the plan
says, what should change, why, and the consequences. That keeps the plan readable as the original
intent while the ADRs carry the amendments, rather than silently rewriting the target underneath
work already done against it.

The per-milestone status files in this directory are where reality is recorded. They are derived
from `build-plan.md` and from `../progress/WORKLOG.md`; they never replace either.

## Milestone dependency graph

Reproduced verbatim from the build plan, section 6.

```text
M0 Repo Foundation
 |
 v
M1 Local Agent + Public Harness Boundary
 |
 v
M2 Job / Trace / Persistence
 | \
 |  \
 |   +------> M3 Jev
 |   |
 |   +------> M4 Workflow IR + Local Runtime
 |                |
 +----------------+
          |
          v
M5 Registry + Router + Full-Agent Fallback
          |
          v
M6 Replay + Evaluation
          |
          v
M7 Learning + Retrospectives
          |
          v
M8 Compiler v1
          |
          v
M9 Generated-Code Validation + Safe Promotion
          |
          v
M10 Multi-Domain Packaging
          |
          v
M11 Production-Primitive Adapters
          |
          v
M12 Hardening + Autonomous Optimization
```

**Critical path:** M0 -> M1 -> M2 -> M4 -> M5 -> M6 -> M7 -> M8 -> M9 -> M10.

**Parallel path:** M3 can proceed beside M4 after M2.

## Status files

| Milestone | Status file |
| --- | --- |
| M0, Repository Foundation | [m0-repository-foundation.md](m0-repository-foundation.md) |
| M1, Local Agent + Public Harness Boundary | [m1-local-agent-and-public-harness-boundary.md](m1-local-agent-and-public-harness-boundary.md) |

Later milestones (M2 onward) get their own status file when that milestone starts. Creating them
in advance would mean copying task lists out of the build plan with nothing verified behind them,
which is exactly the kind of stale documentation the plan's documentation rules warn against. The
build plan already holds the full task list for every milestone; read it there until the milestone
begins.

## Related

- `../progress/WORKLOG.md`, the append-only execution history that every status claim here cites.
- `../progress/milestones/`, the frozen snapshot written when a milestone is declared complete.
- `../context/current-state.md`, the concise present-tense handoff for the next session.
- `../architecture/system-map.md`, what actually exists in the workspace right now.
