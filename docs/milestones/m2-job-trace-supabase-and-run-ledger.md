# Milestone 2, Job, Trace, Supabase, and Run Ledger

**Status:** M2-T1 is `in_progress`; M2-T2 through M2-T11 are `not started`.

**Goal (from the build plan):** make every execution reproducible enough to inspect and later
replay.

This is the most important foundation in the project.

**Blocked by:** M1.

**Parallel work:** Supabase migrations, trace package, inspector, and redaction can proceed in
parallel after schemas stabilize.

**Deliverable:** a trustworthy learning dataset.

## Before starting

These prerequisites come from M1's output, from `../context/current-state.md`'s "Findings the next
agent needs", and from the dependency-boundary rules already enforced in the repository. Read them
before opening any M2 task.

- **Harness `run.*` events and adapter `eve.*` events each number `sequence` from 0** within a run
  today. M2-T3 defines the real event taxonomy and M2-T4's buffered writer must own a single,
  unambiguous sequence across both sources, or M2-T3 must define a per-source key so a trace
  reconstructs a total order without collision.
- **Adapter trace payloads are identity-only projections today**, carrying no message content,
  tool input/output, or results (M1-T6). M2-T3 defines the real event schema and payload shape;
  M2-T9 owns redaction. `details` on a serialized error (ADR-0026) is not itself a redaction
  boundary and must still pass through M2-T9's sanitizers.
- **`Job.contracts.sop` has no registered capability yet.** The example domain's
  `procurement-sop` was deliberately left unregistered in M1-T9, because a SOP is content, not an
  executable capability. M2-T8's behavior fingerprint must still cover SOP content; how it resolves
  and hashes an unregistered `contracts.sop` reference is relevant to that task.
- **M2-T11 (local Supabase) must land before M2-T5 through M2-T10 can be verified.** Those tasks
  define schema, migrations, the outcome ledger, redaction, and the run inspector against a real
  database; none of them can be checked end to end without one. M2-T11 needs Docker running and
  the Supabase CLI installed as a project dev dependency, per AGENTS.md's "no silent dependency
  additions" rule.
- **`@internal/storage-supabase` is already reserved** in `adapterPackages` in
  [`../../tests/architecture/boundaries.ts`](../../tests/architecture/boundaries.ts), and
  `@supabase/*` is in `adapterOnlyDependencies` there, adapter-only for every package including
  `apps/*`. Only `@internal/storage-supabase` may depend on `@supabase/*`; no other package should
  need to touch the boundary table for M2-T5 through M2-T11.
- **`packages/storage-supabase/src/database.types.ts` is generated and never hand-edited**
  (AGENTS.md rule 12). M2-T11's `pnpm supabase:types` script is the only thing that writes it; CI
  checks regeneration produces no diff.
- **Every framework-facing task needs an "Implementation references" checkpoint in the WORKLOG
  before code**, per AD-011 and the source-of-truth protocol
  (`../development/source-of-truth-protocol.md`). This applies to the Supabase CLI and `@supabase/*`
  work in M2-T5, M2-T6, and M2-T11 above all: none of those may move to `in_progress` without the
  checkpoint recorded first.
- **`packages/trace` is a new package.** When it is created (M2-T4), it must be added to
  `BOUNDARY_RULES` in [`../../tests/architecture/boundaries.ts`](../../tests/architecture/boundaries.ts)
  the same way `@internal/runtime-eve` and `@internal/runtime-ai-sdk` were reserved ahead of M1, so
  the architecture test continues to enforce the dependency graph rather than silently ignoring a
  package it does not know about.

## Tasks

### M2-T1, Stable identifiers

**Status:** in_progress.

Use UUIDv7 or another sortable unique ID.

Entities:

```text
job_id
run_id
attempt_id
trace_event_id
workflow_id
workflow_version_id
node_execution_id
decision_id
eval_run_id
learning_run_id
compiler_run_id
promotion_id
```

### M2-T2, Job contract

**Status:** not started.

Finalize the `Job` schema.

Jobs are immutable after execution begins.

### M2-T3, Event trace schema

**Status:** not started.

Append-only events:

```text
run.started
run.completed
run.failed

agent.started
agent.completed
agent.failed

model.started
model.completed
model.failed

tool.started
tool.completed
tool.failed

decision.started
decision.completed
decision.failed

node.started
node.completed
node.failed

artifact.created

approval.requested
approval.resolved

fallback.started
fallback.completed

eval.completed
```

Every event contains:

- event ID
- run ID
- timestamp
- sequence
- parent span
- node
- event version
- behavior fingerprint
- sanitized payload
- usage
- latency
- error metadata

### M2-T4, Trace writer interface

**Status:** not started.

```ts
interface TraceWriter {
  append(event: TraceEvent): Promise<void>;
  flush(): Promise<void>;
}
```

Use a buffered writer locally but preserve event order.

### M2-T5, Supabase schema

**Status:** not started.

Initial tables:

```text
domains
jobs
runs
trace_events
artifacts
workflow_definitions
workflow_versions
workflow_promotions
decisions
eval_runs
eval_results
learning_runs
compiler_runs
```

Do not prematurely normalize every model/tool field into separate tables. Store stable indexed
metadata in columns and versioned payloads in JSONB.

### M2-T6, Migrations

**Status:** not started.

All schema changes are SQL migrations committed to Git.

Never mutate production-like schema manually from the dashboard without generating a migration.

### M2-T7, Outcome ledger

**Status:** not started.

One query-friendly row per run:

```text
status
success
quality score
cost
latency
model calls
tool calls
Jev calls
fallback count
human review
workflow version
agent version
```

### M2-T8, Behavior fingerprint

**Status:** not started.

Hash canonicalized behavior-affecting inputs:

- agent instructions
- SOP
- loaded skills
- tool definitions/version IDs
- model configuration
- schemas
- workflow IR
- policy thresholds

Do not hash timestamps or irrelevant metadata.

### M2-T9, Secret and sensitive-data redaction

**Status:** not started.

Redact before persistence.

Create:

- field-path redaction
- secret-pattern redaction
- headers redaction
- tool-specific sanitizer hooks

Test with seeded fake secrets.

### M2-T10, Local run inspector

**Status:** not started.

CLI:

```text
pnpm harness run show <run-id>
```

Display:

- job
- route
- timeline
- tool/model/Jev calls
- errors
- result
- cost
- fingerprints

### M2-T11, Reproducible local Supabase environment

**Status:** not started.

Install the Supabase CLI as a project dev dependency and initialize the repository-local
configuration.

Document and script the supported lifecycle:

```text
pnpm supabase:start
pnpm supabase:stop
pnpm supabase:reset
pnpm supabase:types
```

These scripts wrap the current documented CLI commands:

```text
supabase start
supabase stop
supabase db reset
supabase gen types --lang typescript --local
```

`supabase db reset` is the reproducibility gate: from an empty local database it applies committed
migrations and seed data.

Generate database types into:

```text
packages/storage-supabase/src/database.types.ts
```

The generated type file is committed. CI checks that regeneration after migration setup produces
no diff.

Local Supabase URLs/keys are loaded from local environment configuration; they are never copied
into committed source.

## Acceptance criteria

From the build plan.

- Every example execution has a durable run row and ordered trace. **not yet verified**
- A trace reconstructs execution without application logs. **not yet verified**
- Retrying creates a new attempt, not duplicate events. **not yet verified**
- Seeded secrets never appear in stored trace payloads. **not yet verified**
- Behavior fingerprint changes when instructions/SOP/policy changes. **not yet verified**
- Migrations can create a clean database from zero. **not yet verified**
- A failed run remains inspectable. **not yet verified**
- Storage failures cannot silently turn into successful runs. **not yet verified**
- `pnpm supabase:reset` recreates the database from committed migrations and seed. **not yet verified**
- `pnpm supabase:types` regenerates committed TypeScript database types without drift. **not yet verified**
