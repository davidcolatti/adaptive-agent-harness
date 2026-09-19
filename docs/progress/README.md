# Progress and handoff system

This directory holds the repository's chronological memory. It exists so that any contributor,
human or coding agent, can pick the work up mid-flight without re-deriving what happened. The
system comes from AD-014 (`docs/decisions/0014-every-unit-of-work-leaves-a-markdown-handoff.md`)
and has three parts:

| File | Nature | Rewritten? |
|---|---|---|
| `docs/progress/WORKLOG.md` | Chronological history of every material task | Never; append-only |
| `docs/context/current-state.md` | Concise, present-tense handoff | Rewritten every session |
| `docs/progress/milestones/mX.md` | Frozen snapshot of a completed milestone | Written once |

## WORKLOG.md is append-only

`docs/progress/WORKLOG.md` is append-only. Never rewrite, reorder or delete an earlier entry, even
when it turns out to be wrong. A correction is itself a new entry appended at the end that says
what the earlier entry got wrong. The log is evidence of what was actually attempted, including
the attempts that failed, so editing history destroys its only value.

Every material task gets two kinds of entry:

- a `started` entry appended **before** implementation begins; and
- a result entry appended when the task stops for any reason, with status `blocked` or
  `completed`.

"Stops for any reason" is literal: a task that is abandoned, parked behind a blocker, or cut short
by a context/session boundary still gets its result entry. A task with a `started` entry and no
result entry is a bug in the log.

## Entry template

Every entry uses this template verbatim (source: AD-014):

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

The `### Verification` lines are not decorative: `pnpm check:handoff` parses them (see below), and
an entry marked `completed` without at least one `PASS`/`FAIL` line fails the check.

## The eight rules

1. Log a `started` entry before material implementation.
2. Update or append the result when the task stops for any reason.
3. Update `docs/context/current-state.md` before ending the session.
4. Never mark a task complete without verification results.
5. Record failed attempts when they teach something relevant.
6. Include source links and paths for Vercel-facing technical choices.
7. Milestone completion archives a snapshot under `docs/progress/milestones/mX.md`.
8. Generated code and compiler runs link back to their run IDs and their work-log entry.

In addition: a coding agent that reaches a context or session boundary MUST prioritize the handoff
update (rules 2 and 3) before starting any unrelated work. Running out of context is not an excuse
for an undocumented task; it is the exact situation the handoff exists for.

## Relation to `docs/context/current-state.md`

`WORKLOG.md` is history; `docs/context/current-state.md` is the present. It is the concise,
present-tense handoff, and unlike the work log it is **rewritten**, not appended, at the end of
every session. It should be readable in under a minute and should never accumulate narrative.

Per AD-014 it carries these fields:

- current milestone;
- current task;
- completed milestones/tasks;
- what works now;
- what is partially working;
- known failures;
- current blockers;
- important active decisions;
- uncommitted/generated artifacts;
- exact next task;
- exact verification command to run next;
- last successful `pnpm check` / `eve check`;
- last commit SHA.

When the two files disagree, `current-state.md` describes what is true now and `WORKLOG.md`
describes how it got there. Neither is a substitute for the other, and a session is not finished
until both are current.

## What `pnpm check:handoff` enforces

`pnpm check:handoff` runs `scripts/verify-handoff.ts` (Node 24 executes the TypeScript directly via
type stripping, so the script depends on nothing outside `node:*`). It is part of the `pnpm check`
gate. It reports every problem it finds with a stable code and exits non-zero if there is at least
one. The four rules it enforces are:

1. **`missing-current-state`**: fails if `docs/context/current-state.md` does not exist.
2. **`missing-worklog`**: fails if `docs/progress/WORKLOG.md` does not exist. When the work log is
   missing the script stops there, since rules 3 and 4 have nothing to read.
3. **`completed-entry-without-verification`**: the work log is split into entries at `## `
   headings (`### ` headings are subsections, and text before the first `## ` is preamble). For
   each entry, the first line matching `**Status:**` is read; if its value contains the word
   `completed` as a whole word, case-insensitively, the entry must also have a `### Verification`
   section containing at least one line with the whole word `PASS` or `FAIL` (uppercase). A section
   is "the Verification section" when a `### ` heading's text, lowercased, is exactly
   `verification`, and it ends at the next `### ` or `## ` heading. An entry that fails this is
   reported by heading.
4. **`missing-decision-record`**: the whole work log is scanned for decision-record references in
   two forms: `ADR-NNNN` with exactly four digits, and a path of the form `docs/decisions/NNNN-`
   with a four-digit prefix. Each distinct four-digit number found must match a file in
   `docs/decisions/` whose name starts with those four digits followed by a hyphen. A reference
   with no matching file is reported.

Note what the script deliberately does **not** do: it makes no attempt to infer whether every code
edit was logged. Per the build plan, that rule is enforced by task workflow and review, not by
brittle git heuristics. A green `check:handoff` means the handoff files are present and internally
consistent, not that the log is complete or honest.

## Milestone snapshots

When a milestone completes, its state is archived as a snapshot under
`docs/progress/milestones/mX.md` (rule 7). The live work log keeps growing; the snapshot freezes
what that milestone ended up being. See [`milestones/README.md`](milestones/README.md) for the
naming convention and the contents of a snapshot.
