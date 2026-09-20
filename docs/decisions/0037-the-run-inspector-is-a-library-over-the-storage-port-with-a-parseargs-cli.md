---
status: accepted
date: 2026-09-20
deciders: orchestrator (Claude Fable 5.1) with repository owner constraints; recorded during M2-T10
related: [0004, 0010, 0016, 0026, 0029, 0030, 0031, 0032, 0034, 0035, 0036]
supersedes: null
superseded_by: null
---

# ADR-0037: The run inspector is a library over the `Storage` port, with a `parseArgs` CLI

## Context

M2-T10 is the last Milestone 2 task and the first command of what the build
plan's section 10 calls "the initial control plane":

```text
pnpm harness run show <run-id>
```

It must display a run's job, route, timeline, tool/model/Jev calls, errors,
result, cost and fingerprints. Five forces decide how.

**The inspector is the proof of two acceptance criteria, not a convenience.**
Milestone 2 claims "a trace reconstructs execution without application logs" and
"a failed run remains inspectable". Both are claims about what durable evidence
alone can answer. An inspector that consulted a log file, a stdout capture or a
live runtime would quietly falsify the first, and one that threw on a partial
record would falsify the second — and a crashed run leaving a `running` row with
no terminal event is precisely the case ADR-0036's write ordering exists to
produce.

**There is no `packages/cli` in the build plan.** Section 4's repository layout
names `packages/observability/` and no CLI package, and section 10 says to build
the CLI incrementally. So the entry point needs a home, and inventing a package
the plan does not name would be exactly the "silent new architectural pattern"
AGENTS.md rule 11 forbids.

**Reading a run means reading a database, and only one package may.** AGENTS.md
states "no direct database access outside `packages/storage-supabase`", and
`tests/architecture/boundaries.ts` makes `@supabase/*` adapter-only. A CLI that
prints a Supabase row has to reach Supabase somehow.

**A CLI framework is an unprescribed internal choice.** AD-016 requires that
such a choice be recorded rather than made in passing, and AGENTS.md's "no
silent dependency additions" makes adding one a thing to justify.

**A trace exists before a database does.** `apps/example-agent` writes
`<app root>/.harness/traces/<runId>.jsonl` on every run whether or not Supabase
is configured (ADR-0031). North-star invariant 15 is that local development
stays a first-class path, and the most valuable moment to inspect a run is often
the one where writing it to the database is the thing that failed.

## Decision

**A new package, `@internal/observability`, at `packages/observability`.** It is
the build plan's planned package, opened by the first thing that needs it. It is
**not** an adapter: `tests/architecture/boundaries.ts` gives it the same
`forbiddenByPackage` bans `@internal/core` and `@internal/trace` carry, so it
MUST NOT depend on `@supabase/*`, `eve`, `ai`, `@ai-sdk/*`, `workflow` or
`@vercel/*`.

**`inspectRun(source, runId)` is a pure read over a port.** It returns a
`RunInspection`, a plain JSON-able value whose fields are the build plan's
display list in the build plan's order: `job`, `route`, `timeline`, `calls`,
`errors`, `result`, `cost`, `fingerprints`. `renderRunInspection(inspection)`
turns that value into text. The split is load-bearing: `--json` and the human
form are two views of **one** value, so they cannot drift, and a future
dashboard, a test and an agent consume the same thing.

**Partial evidence is inspectable and says what is missing.** A run with no
ledger row, a ledger row with no trace, and a trace-only source each produce a
`RunInspection` with `found`, an `availability` triple and human-readable
`notes`; only a run with neither a row nor a single event is `found: false`.
`inspectRun` MUST NOT throw for absence. It does propagate a `StorageError` from
an unreachable store and a `ValidationError` from a row or line that is not what
it claims to be, because those mean the evidence itself is untrustworthy.

**`parseTraceEvent()` is added to `@internal/core`**, beside `parseJob()`
(ADR-0032) and `parseRunRecord()` (ADR-0036), and is the single read boundary
for a stored, replayed or JSONL-sourced event. `packages/storage-supabase`'s
private `readTraceEvent` is reduced to the column-name mapping and now calls it;
its own comment had already said that a second reader is what would move those
checks into core. It reads `version` rather than asserting it, accepting any
integer of at least 1, because a row written by an older schema must read back
saying so.

**Reading a JSONL trace back lives in `@internal/trace`**, as
`readJsonlTraceEvents(path)`, in the module beside the sinks that write the
format. The line format then has exactly one owner; a reader that restated "one
canonical-JSON event per line" elsewhere would be a second copy free to drift.
`@internal/observability`'s `createJsonlTraceSource(path)` is the thin wrapper
that adds the run filter and the description.

**The CLI framework is Node's built-in `node:util` `parseArgs`.** Strict mode
with `allowPositionals: true`, so an unknown flag is rejected rather than
ignored. No dependency is added.

**The CLI entry point lives in this package, at `src/bin/harness.ts`**, and the
root script is:

```json
"harness": "turbo run build --filter=@internal/observability --output-logs=none 1>&2 && node --env-file-if-exists=.env.local packages/observability/dist/bin/harness.js"
```

Turbo's own output goes to **stderr**, so stdout carries the inspection alone and
`--json` is pipeable. `--env-file-if-exists=.env.local` matches what
`apps/example-agent` already does, so a local Supabase's URL and key reach the
command exactly as they reach `pnpm example:run`.

**Only the `bin` reaches an adapter.** `src/cli.ts`, which nothing but
`bin/harness.ts` and its test imports, is the one module that turns
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` into a store, through
`createSupabaseStorage()`. The package's library surface (`src/index.ts`) does
not export it and knows nothing about Supabase. So the dependency
`@internal/observability -> @internal/storage-supabase` is a workspace edge, the
database is still reached only through the declared adapter, and importing the
inspector never drags a database client in.

**Exit codes are 0, 1 and 2.** 0 printed an inspection; 1 means the run was not
found or a configured store was unreachable; 2 means a usage error (an unknown
subcommand, a missing, duplicated or malformed run id, or no source at all). An
unknown subcommand prints section 10's whole target list marked with what is
implemented. A configured-but-unreachable store prints
`apps/example-agent/src/run.ts`'s wording, one line and no stack, differing only
in naming `--jsonl` as the local way out.

**What the inspector cannot show in Milestone 2 is the run's output value**, and
it says so rather than printing a blank. `HarnessRunResult.output` is returned in
process, and a trace payload is identity-only by rule (ADR-0031), so no durable
record of it exists. The `artifacts` table (M2-T6) is where a durable output
belongs; M5 is what fills it.

## Consequences

### Positive

- Milestone 2's "a trace reconstructs execution without application logs" is now
  demonstrable by a command rather than asserted in a document, and "a failed
  run remains inspectable" has a second, independent witness beside the storage
  task's.
- A run is inspectable with **no database, no key and no Docker**, from the
  JSONL file every run already writes, which is north-star invariant 15 and is
  the case a developer actually hits when the storage write is what failed.
- `parseTraceEvent()` removes the last read boundary that existed only inside an
  adapter. A hand-edited row and a hand-edited JSONL line now fail identically.
- `inspectRun` takes the port, so the in-memory implementation is a first-class
  source: the whole inspector is unit-tested with no database, and the Supabase
  leg proves only what in-memory cannot.
- The inspection reports the ledger's cost beside the same figure summed from
  the trace. Two independent routes to one number is what makes a stored trace
  auditable; a disagreement is now visible rather than invisible.
- No dependency was added for the CLI, so `pnpm install` is unchanged and there
  is no new supply-chain surface for a command that prints text.

### Negative

- `@internal/observability` depends on `@internal/storage-supabase`, so the
  dependency graph has an edge from a non-adapter library package to an adapter.
  It is confined to one module that the library surface does not export, but it
  is a real edge and a reader has to know why it is there.
- `parseArgs` has no subcommand model, no help generation and no completion. The
  subcommand dispatch is fifteen lines of hand-written positional matching
  today; at ten commands it will be more, and that is the point at which the
  choice should be revisited.
- Shipping the CLI inside the inspector package means `packages/observability`
  has two audiences, a library one and an executable one, distinguished only by
  which module you import.
- The text renderer abbreviates a job's `input` to twenty lines. The example
  domain's input is a whole SOP, so the default view is not the whole job;
  `--json` is.

### Neutral

- Colour is opt-in: `--color` forces it on, `--no-color` off, and otherwise the
  CLI turns it on only for a TTY. `renderRunInspection` itself emits no ANSI
  unless asked, so a caller that pipes never has to strip escapes.
- The `jev` section reports 0 with a note explaining that 0 is a measurement
  rather than a gap, the same way `RunRecord.jevCalls` does (ADR-0036).
- `--trace-file` is accepted as a synonym of `--jsonl`.

## Alternatives considered

**A separate `packages/cli`.** Rejected for now: the build plan's section 4
layout does not name one, section 10 says to build the CLI incrementally, and a
package holding one command would be scaffolding ahead of need — exactly what
AGENTS.md's scope discipline warns against. When the CLI grows past run
inspection it should be split, and that split is a later ADR, not a reason to
pre-build the package today.

**commander, yargs or oclif.** Rejected. The surface is one command and four
flags; `parseArgs` is in the runtime this repository already pins to an exact
version; and each of the three is a dependency that would have to be pinned,
justified and kept current under ADR-0024 for behaviour Node already ships.
`parseArgs`'s strict mode gives the one property that actually matters, which is
that an unknown flag is an error rather than silence.

**Reading Postgres directly from the CLI**, with a `pg` client or `psql`.
Rejected outright: it would be the second place in the repository that talks to
a database, which AGENTS.md forbids, and it would bypass `parseJob()`,
`parseRunRecord()` and `parseTraceEvent()`, so the inspector would report rows
that the harness itself would reject.

**Putting the JSONL reader in `@internal/observability`.** Rejected: the format
is defined by `@internal/trace`'s sinks, and a reader that lived somewhere else
would be a second statement of it. The inspector-shaped part, the run filter and
the source description, is what stayed here.

**Rendering directly from `Storage` calls, with no `RunInspection` value.**
Rejected: `--json` would then be a second implementation of the same gathering
logic, free to disagree with the text form, and nothing but the CLI could ever
consume an inspection.

**Throwing for a missing job or a missing trace.** Rejected. The exact case the
milestone promises remains inspectable is the incomplete one, and a tool that
refuses to describe a half-written run is useless at the only moment it is
needed.

**Fabricating a `RunRecord` and event list in the tests.** Rejected. Every test
starts from a real `createHarness()` run recorded through the real buffered
writer into a real `Storage`, because "the inspector reads what the harness
writes" is the single claim it has to be right about, and a hand-written fixture
would test it against a shape someone imagined.

## References

- `docs/milestones/build-plan.md` §M2-T10, §10 "CLI Surface", §4 "Repository
  Layout", AD-010, AD-016
- `docs/milestones/m2-job-trace-supabase-and-run-ledger.md`, acceptance criteria
  "A trace reconstructs execution without application logs" and "A failed run
  remains inspectable"
- Related ADRs: ADR-0010 (the trace is a product surface), ADR-0016 (internal
  implementation choices are recorded), ADR-0026 (trace-safe errors),
  ADR-0031 (trace taxonomy and the JSONL sinks), ADR-0032 (`parseJob`),
  ADR-0034 (component-wise behavior fingerprint), ADR-0035 (redaction),
  ADR-0036 (`Storage`, `RunRecord`, `parseRunRecord`, the `artifacts` table)
- Related code paths: `packages/observability/src/inspect-run.ts`, `render.ts`,
  `jsonl-trace-source.ts`, `cli.ts`, `bin/harness.ts`;
  `packages/core/src/trace.ts` (`parseTraceEvent`);
  `packages/trace/src/jsonl-source.ts`;
  `packages/storage-supabase/src/supabase-storage.ts` (`readTraceEvent`);
  `tests/architecture/boundaries.ts`
- Runbook: `docs/runbooks/inspecting-a-run.md`
