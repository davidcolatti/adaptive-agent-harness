# Milestone 2, Job, Trace, Supabase, and Run Ledger

**Status:** M2-T1 is `completed`; M2-T2, M2-T3 and M2-T4 are `in_progress`; M2-T5 through M2-T11
are `not started`.

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

**Status:** completed (2026-09-19).

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

**Result.** The scheme is RFC 9562 UUIDv7, implemented in `packages/core/src/ids.ts` over
`node:crypto` `randomBytes`, with the RFC 9562 §6.2 Method 1 12-bit monotonic counter in `rand_a`,
so ids are strictly increasing within a process, including inside one millisecond, past counter
rollover (timestamp borrowed 1 ms forward), and across a backwards clock step. Node 24.21.0's
built-in `crypto.randomUUIDv7()` was measured and rejected: its own docs say the timestamp is "not
guaranteed to be strictly increasing", and about half of 20,000 consecutive ids came out
non-increasing in practice. The missing `@types/node@24.13.6` declaration for that function was
not the reason.

Twelve branded types (`JobId`, `RunId`, `AttemptId`, `TraceEventId`, `WorkflowId`,
`WorkflowVersionId`, `NodeExecutionId`, `DecisionId`, `EvalRunId`, `LearningRunId`,
`CompilerRunId`, `PromotionId`) each have a zero-argument generator, plus a generic
`parseEntityId(kind, value, path?)`, `isEntityId`, and the constant `ENTITY_ID_SCHEME = "uuidv7"`.
The runtime representation is a plain lowercase string. Wiring reaches exactly the two call sites
the task requires and no further: `defineDomain()` mints `Job.id`, and `createHarness()` mints the
run id. `ExecutionContext.runId`/`jobId` and `TraceEvent.runId` now take the branded types; `attempt`
stays a plain number, and where `AttemptId` and `TraceEventId` themselves surface is left to
M2-T2 and M2-T3.

Recorded in
[ADR-0030](../decisions/0030-sortable-uuidv7-entity-identifiers-owned-not-delegated.md) and
documented in [`../contracts/identifiers.md`](../contracts/identifiers.md). Verification:
`pnpm check` passes (391 tests across 31 files, up from 371/30), and `pnpm example:run:mock`
passes with a `completed` result. Commit `02b1261`.

### M2-T2, Job contract

**Status:** completed (2026-09-19).

Finalize the `Job` schema.

Jobs are immutable after execution begins.

**Result.** The field list did not change; what changed is what is guaranteed about a value of that
type and what can be done with an `unknown` claiming to be one. Five questions the build plan's
section 5 list leaves open are answered and recorded in
[ADR-0032](../decisions/0032-jobs-are-deeply-immutable-and-the-effective-job-is-the-job.md).

**Immutability is deep.** M1's `Object.freeze` stopped `job.budget = {}` and did nothing about
`job.budget.maxCostUsd = 1e9` or `job.permissions[0].mode = "write"` — the two mutations that widen
what an execution may spend and may do while the run record still names the original job. The new
`packages/core/src/freeze.ts` exports `deepFreeze()`, used by `defineDomain()`'s `createJob` and by
`createHarness()`, and every module here is an ES module and therefore strict, so a nested write
throws a `TypeError`. It recurses into arrays and plain objects **only**: a `Date`, a `Map` or a
class instance is left as found, because `Object.freeze` cannot stop `setTime()` or `set()` (that
state lives in internal slots) and freezing a memoizing class instance breaks it at a distance. The
boundary is stated positively rather than hidden — a job is deeply immutable exactly as far as it
is JSON-representable, which is exactly as far as it is persistable, traceable and replayable.

**The effective job is the job.** A run's `budget`, `permissions` and `metadata` overrides are part
of creating the job, applied before anything executes, and the value that comes out is the single
authoritative one: what the runtime receives, what a trace records, what M2-T5 will persist and
what M6 will replay, under the id the domain minted. `effectiveJob` in `harness.ts` is a local name
for the second half of a two-step construction, not a second contract type. `createJob(input)`'s
public signature is unchanged and `defineDomain()` gained no clock.

**No `createdAt`.** A `JobId` is a UUIDv7 whose first 48 bits are the creation millisecond, so a
field would be a second source of truth for one instant with no rule for which wins.
`entityIdTimestampMs(id)` and `entityIdTimestamp(id)` were added to `packages/core/src/ids.ts`, and
they refuse anything that is not a well-formed id rather than reading a v4 UUID's random bits as a
confident wrong date. The derived value inherits ADR-0030's two bounded caveats (marginally ahead
after a burst past 4096 ids in a millisecond, marginally behind while the clock steps backwards).

**`parseJob(value, path?)` is the boundary** M2-T5, M2-T10 and M6 will read a stored job through,
with `isJob()` as the predicate form that freezes nothing. It reports every problem at once, each
at the path of the field that caused it, in the `collectRefIssues` style; it is strict about
unknown fields at the top level, in `contracts`, in `budget` and in a `ToolGrant`, because
discarding a field on read loses data from the record whose purpose is reproducibility and a
mistyped budget dimension would otherwise read as unlimited; and it deep-freezes what it returns.
It deliberately does **not** validate the input against a domain schema — it has no domain to ask —
so it returns `Job<unknown, unknown>` and typed validation stays with
`DomainDefinition.inputSchema` and the one choke point `createHarness()` owns. `contracts.sop`
accepts a bare identifier, matching the example domain's unversioned `procurement-sop`; whether a
SOP reference needs a version is left to M2-T8 as an open question in the ADR rather than answered
with a speculative fourth `JobContracts` field.

**An attempt is not part of a job.** ADR-0030 deferred this here, and the answer is that an attempt
belongs to a run: a retry reuses the job unchanged and receives a new `ExecutionContext`, so
`AttemptId` still has no field and where attempt identity surfaces is M2-T3's and M2-T5's decision.

Supporting work: `isPlainObject`, `isJsonValue` and `isJsonObject` were added to
`packages/core/src/json.ts` (the runtime half of the value model, which M2-T3's payloads and
M2-T9's redaction can reuse). A test proves producer and validator agree —
`parseJob(JSON.parse(JSON.stringify(job)))` deep-equals the job the harness built — and the
contract is documented in [`../contracts/job.md`](../contracts/job.md), with the effective-job
semantics in [`../contracts/harness.md`](../contracts/harness.md) and the timestamp helpers in
[`../contracts/identifiers.md`](../contracts/identifiers.md).

### M2-T3, Event trace schema

**Status:** completed (2026-09-19).

**Result.** `packages/core/src/trace.ts` now holds the real contract, documented in
[`../contracts/trace-event.md`](../contracts/trace-event.md) and recorded in
[ADR-0031](../decisions/0031-trace-event-taxonomy-recorder-owned-sequencing-and-the-buffered-writer.md).
`TraceEventType` is a **closed** union of the list below plus `run.aborted`, exported at runtime as
`TRACE_EVENT_TYPES` with an `isTraceEventType()` guard so a reader, a validator and M2-T5's column
constraint share one list. `run.aborted` is an amendment to the plan's list: the harness already
emits it, and folding a cancellation into `run.failed` would report every abort as a defect in the
run ledger. Every event carries the plan's "every event contains" list made concrete: a UUIDv7
`id`, `runId`, `attempt`, `sequence`, `timestamp`, `type`, `parentId`, `node`, `version`,
`behaviorFingerprint`, `payload`, `usage`, `latencyMs` and `error`.

Four of those needed a decision. **"Parent span" is `parentId`, and a `*.started` event's own `id`
is its span id**, so there is no span entity and nothing to leak if a span is never closed; every
`run.*` event is a root, because a run is already identified by `runId`. **`attempt` stays a
number**: ADR-0030 defined an `AttemptId` and gave it no field, and when an attempt becomes a row
is M2-T5's decision, not this one. **`node` and `behaviorFingerprint` are typed and always
`null`** until M4 and M2-T8 respectively; a fabricated fingerprint would break every comparison
built on it. **`payload` stays identity-only**, as M1's adapter projection already was, so M2-T9
does not inherit content that leaked before redaction existed.

This is also where the sequencing question from "Before starting" is answered, jointly with M2-T4:
a run-scoped `createTraceRecorder()` in `@internal/core` is the single owner of `sequence`,
`ExecutionContext.trace` carries it instead of a raw `TraceWriter`, and `createHarness()` builds
one per run and passes the same one to the adapter. `EveAgentRuntime` maps eve's stream onto the
taxonomy (`turn.*` to `agent.*`, `step.*` to `model.*`, `actions.requested`/`action.result` to
`tool.*`, eve's human-input events to `approval.*`) instead of emitting `eve.<type>`, and its own
`state.sequence` is gone. The mapping table and the eve events that are deliberately **not** trace
events are in [`../architecture/runtime.md`](../architecture/runtime.md).

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

**Status:** completed (2026-09-19).

**Result.** `TraceWriter` is kept **verbatim** as stated below. The new `packages/trace`
(`@internal/trace`, `@internal/core` only, Node built-ins only, added to `BOUNDARY_RULES` as a
non-adapter with core's bans) holds everything underneath it: a `TraceSink` interface
(`write(events)`), `createBufferedTraceWriter({ sink, maxBufferedEvents })`, and three sinks —
`createInMemoryTraceSink()`, `createJsonlFileTraceSink(path)` and
`createJsonlDirectoryTraceSink(directory)`, the last writing one canonical-JSON line per event to
`<directory>/<runId>.jsonl`.

The writer's guarantees: append order is write order; concurrent flushes serialize rather than
interleaving; `append` auto-flushes at `maxBufferedEvents` (default 256) and awaits it; and a sink
failure becomes a `StorageError` with the cause preserved **while the events stay buffered**, so a
later flush retries them in the same order and nothing is dropped. `createHarness()` awaits
`flush()` after the terminal event and lets that `StorageError` out of `harness.run()` rather than
returning `completed`, which is how "storage failures cannot silently turn into successful runs"
is enforced rather than merely intended.

`pnpm example:run:mock` now writes a real ordered trace to
`apps/eve-fixture-agent/.harness/traces/<runId>.jsonl` and prints the path; `.harness/` is
git-ignored. A verified run produced six events with contiguous sequences 0 to 5:
`run.started`, `agent.started`, `model.started`, `model.completed`, `agent.completed`,
`run.completed`. Until M2-T5 that file is the durable trace, and the Supabase sink will be another
`TraceSink` behind the same writer.

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
