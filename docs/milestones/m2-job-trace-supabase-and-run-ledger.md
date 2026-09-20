# Milestone 2, Job, Trace, Supabase, and Run Ledger

**Status:** every task is `completed` (M2-T1 through M2-T11); all ten acceptance criteria verified.
Snapshot: `../progress/milestones/m2.md`.

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

M2-T1 through M2-T11 are `completed`.

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

**Status:** completed (2026-09-19).

**Result.** The schema exists, and so does the thing that writes it: a `Storage` **port** in
`@internal/core` (`packages/core/src/storage.ts`), because the dependency rule forbids core from
importing Supabase. Eight methods — `saveJob`, `startRun`, `finishRun`, `getRun`, `getJob`,
`listRuns`, `appendTraceEvents`, `getTrace` — each `async`, each rejecting with `StorageError`
(cause preserved) on a store failure and `ValidationError` on a caller error, plus `RunRecord` and
`parseRunRecord()` as the strict read boundary in the `parseJob` style. It is implemented **twice**:
`createSupabaseStorage()` in `@internal/storage-supabase`, and `createInMemoryStorage()` in
`@internal/testing`. Both run one `storage.contract.test.ts` suite, which is what makes them
interchangeable in fact rather than by assertion (build plan section 8).

Thirteen tables, exactly the list below. Stable metadata in columns, versioned payloads in `jsonb`.
Every id column is `uuid` with **no database default**, because ids are harness-minted UUIDv7
(ADR-0030) and a database-generated id would be a second, conflicting identity. **ADR-0030's open
caveat is closed by measurement**: neither the Postgres 17 nor the 18 documentation states how
`uuid` values compare, so it was tested against the running Postgres 17.6 with the cases that
distinguish unsigned bytewise comparison from a signed one, and
`array_agg(id::text order by id) = array_agg(id::text order by id::text)` returned true. `order by
id` is creation order; `supabase-schema.integration.test.ts` keeps checking it against real rows.

The nine later-milestone tables get their **minimal keyed shape only** — identity, the foreign keys
that fix how they relate, a timestamp, one `payload jsonb`, and a comment naming the milestone that
fills them. Their columns are not invented. **Row-level security is enabled on all thirteen with no
policies**: the harness connects as `service_role`, which holds `bypassrls`, and the integration
suite proves with a real anon client that `anon` reads nothing from any of them and cannot insert.

`@supabase/supabase-js@2.116.0` is an exact pin in `packages/storage-supabase` only, with an
assertion test in the ADR-0024 style; pnpm's release-age gate did not trigger and
`pnpm-workspace.yaml` is unchanged. The package also depends on `@internal/trace`, which the
dependency diagram already allows (storage sits under trace), because it is the last code before
persistence and redacts what it writes. Trace events reach the database through a `TraceSink`,
`createStorageTraceSink({ storage })`, so they keep the buffered writer's ordering, batching and
retry guarantees rather than acquiring a second set; `createFanOutTraceSink()` puts the JSONL file
and the database behind one buffer and one flush.

`tests/architecture/boundaries.ts` needed **no change**: `@internal/storage-supabase` was already a
declared adapter and `@supabase/*` already adapter-only. `apps/example-agent` depending on the
adapter *package* is not the same as depending on `@supabase/*`, which stays adapter-only for
applications.

Recorded in [ADR-0036](../decisions/0036-storage-is-a-core-port-over-a-supabase-schema-with-runs-as-the-ledger.md)
and documented in [`../contracts/storage.md`](../contracts/storage.md).

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

**Status:** completed (2026-09-19).

**Result.** Five migrations under `supabase/migrations/`, created with the pinned CLI
(`pnpm exec supabase migration new`) and applied in filename order:
`domains_and_jobs`, `workflow_registry_tables`, `runs_outcome_ledger`,
`trace_events_and_artifacts`, `later_milestone_tables`. The order is load-bearing, because `runs`
carries a `workflow_version_id` foreign key and every table references `domains`. One thing worth
knowing for the next schema change: the CLI's timestamps are **second-resolution**, so five
migrations created in a loop collided and then sorted by name instead, which put `runs` before the
workflow tables it references. They were recreated one per second; `supabase/migrations/README.md`
now says so.

`pnpm supabase:reset` applies all five from an empty database and exits 0, which is the "migrations
can create a clean database from zero" criterion run rather than asserted. `pnpm supabase:types`
regenerated `packages/storage-supabase/src/database.types.ts` (694 lines, up from 49), and two
consecutive generations are byte-identical.

`supabase/seed.sql` is deliberately **still empty**. `Storage.saveJob()` upserts the domain row a
job belongs to, so no seed has to be kept in step with the domains an application defines; a seed
that did would go stale and make `db reset` fail for a reason unrelated to the schema it is meant to
be testing.

All schema changes are SQL migrations committed to Git.

Never mutate production-like schema manually from the dashboard without generating a migration.

### M2-T7, Outcome ledger

**Status:** completed (2026-09-19).

**Result.** `runs` is the ledger, one query-friendly row per run, with every column the list below
names as a real column rather than a field in a payload. `Storage.startRun()` opens it in `running`
state and `finishRun()` writes the outcome.

Four decisions inside it. **`agent_version` holds the composite behavior fingerprint** (M2-T8),
because the build plan asks for an "agent version" and a hand-maintained version string is exactly
the value that stops tracking reality without anyone noticing; `behavior_fingerprint` carries the
same value in its own column so a later redefinition of `agent_version` cannot silently change what
the fingerprint column means. **A new `target` column records which application or agent actually
executed**, which closes the open question ADR-0034 recorded: a fingerprint describes a *domain*, so
the example's mock run and its live run share one and nothing else distinguished them. It comes from
`CreateHarnessOptions.target`, on the harness rather than on a run, because it identifies the
deployment rather than the work. **There is no attempts table**: an attempt is an ordinal on the run
row and on each trace event, and `unique (job_id, attempt)` is what makes "retrying creates a new
attempt" a database rule rather than a convention. **`success` is `null` for an aborted run**, not
`false`; `jev_calls` and `fallback_count` are real zeros because a run today makes no Jev calls and
takes no fallback; `quality_score`, `human_review` and `workflow_version_id` are null, because "not
evaluated", "not reviewed" and "no compiled workflow" are not zero.

The harness wiring is where the two failure criteria are actually enforced, and both are properties
of **ordering**. `saveJob` and `startRun` run **before** the first trace event, so a trace can never
exist for a run the ledger denies happened and a process that dies mid-run leaves an inspectable
`running` row. `finishRun` runs **after** the trace flush, so a `completed` row never outlives the
evidence for it. Every storage failure leaves `harness.run()` as a `StorageError`, and the harness
wraps anything an implementation throws that is not already one, preserving the cause.

Indexes (AD-016): `runs (domain_id, job_type, started_at desc)` is AD-008's learning scope,
`runs (status, started_at desc)` answers "what is running / what failed", `runs (job_id, attempt)`
lists the attempts of one job, and `domains (organization_id, id)` carries AD-008's outermost scope,
which is why `domains.organization_id` exists at all (defaulting to `local`; no tenancy model is
designed). Paging is keyset, never offset: `listRuns` is newest-first with a `RunId` cursor and
`getTrace` ascending with a `sequence` cursor, because `limit`/`offset` over an append-only ledger
silently skips or repeats rows.

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

**Status:** completed (2026-09-19).

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

**Result.** North-star invariant 4 is true of a real run for the first time. The new
`packages/core/src/behavior.ts` holds a closed `BehaviorDescriptor` with **one field per input
above**, and `createBehaviorFingerprint()` returns **one `sha256:` digest per component plus the
composite**, all over ADR-0029's canonical JSON. Nothing about *how* a digest is made changed;
this task decides *what* goes in and how the parts compose. Recorded in
[ADR-0034](../decisions/0034-behavior-fingerprint-is-component-wise-and-supplied-by-the-domain.md)
and documented in [`../contracts/behavior-fingerprint.md`](../contracts/behavior-fingerprint.md).

**Component-wise, not one flat hash.** "The behavior changed" is not an actionable finding; "the
SOP changed and nothing else did" is. M6-T4's replay decides comparability from a fingerprint,
M6-T7 compares against a named full-agent fingerprint and M7-T1 selects learning batches by one,
and none of them can attribute a difference from a flat hash — the descriptor that produced a
stored fingerprint is gone. A `scheme` number is hashed into the composite so that adding a ninth
component moves every composite at once and says why, while leaving component digests comparable
across the change.

**"Do not hash timestamps or irrelevant metadata" is enforced by the type.** `BehaviorDescriptor`
has no index signature and no `metadata` field, so there is nowhere to put a timestamp, a run id
or a hostname, and a type-level test pins `keyof BehaviorDescriptor` to the component list. Also
deliberately absent: executable source (ADR-0029's reason, restated), the eve build output (it
moves on every dependency bump), credentials, and the per-run budget (it belongs to the `Job`, a
caller can override it, and folding it in would report two runs of one behavior as two behaviors).

**Normalization is line endings only.** A CRLF checkout must fingerprint identically; whitespace
in an instruction file is read by the model and is therefore behavior, so it is not trimmed.
`skills`, `tools` and `schemas` are sorted before hashing, so declaration order is not behavior,
and a duplicate id is a `ValidationError` rather than a silent deduplication.

**The domain supplies the descriptor, because only it can.** ADR-0028 makes `EveAgentRuntime` a
URL-only client that never reads an agent's files and ADR-0025 makes the application the author of
that agent, so `DefineDomainConfig`/`DomainDefinition` gained an optional
`behavior?: BehaviorDescriptor | (() => …)`. `createHarness()` resolves it **once, before
`run.started`** — so an edit mid-run cannot split one run across two behaviors — passes the
composite to `createTraceRecorder`, puts the whole `BehaviorFingerprint` on all three
`HarnessRunResult` variants (a failed run must stay comparable), and writes the component digests
into the `run.started` payload as `sha256:` strings, keeping the payload identity-only. A domain
that declares none records `null`, never a placeholder; a descriptor that cannot be gathered
throws out of `run()` rather than recording an unfingerprinted run.

**The example supplies a real one.** `apps/example-agent/src/behavior.ts` reads
`agent/instructions.md` and every skill under `agent/skills/` from disk per run (caching would
report two runs as one behavior after an edit between them), takes tool and schema entries with
their fingerprints from the capability manifest, and takes the policy thresholds from the constant
the policy itself enforces. The model configuration lives in the new `agent/lib/agent-config.ts`,
which `agent/agent.ts` passes to `defineAgent` and `src/behavior.ts` hashes: one source, because
two would drift and a drifted fingerprint looks correct. `agent/lib/` is eve's documented
import-only shared-code slot, and nothing under `agent/` imports the harness.

This also **closes ADR-0032's open question**: `Job.contracts.sop` stays a bare, unversioned
identifier. The identifier says which SOP and the `sop` component digest says which revision ran;
a hand-maintained version field would be a second source of truth that goes stale silently.

**Caveat, recorded rather than fixed:** `src/run.ts` runs the same domain against either target, so
a `pnpm example:run:mock` trace carries a fingerprint describing `apps/example-agent`'s authored
behavior while the events came from the fixture agent. Acceptable for a credential-free smoke path;
M2-T5's ledger should record which target ran. Listed as an open question in ADR-0034.

Verification: `pnpm vitest run --project unit packages/core apps/example-agent` passes (477 tests
across 22 files). `pnpm example:run:mock` exits 0 with a `completed` result and a six-event trace
whose every line carries the same non-null
`sha256:c0ab81341295c36655b5c4614d9352bd29deec74c7d75f65c82b8dd33f0f8c2d`, with all eight component
digests in `run.started`. Adding one line to `agent/instructions.md` and re-running moved the
composite to `sha256:c9b02cd6…` and moved the `instructions` component only, `sop` and the rest
unchanged; the edit was reverted.

### M2-T9, Secret and sensitive-data redaction

**Status:** completed (2026-09-19).

Redact before persistence.

Create:

- field-path redaction
- secret-pattern redaction
- headers redaction
- tool-specific sanitizer hooks

Test with seeded fake secrets.

**Result.** "Redact before persistence" is answered structurally rather than by convention, and
recorded in
[ADR-0035](../decisions/0035-redaction-is-a-trace-writer-decorator-placed-before-buffering.md). A
pure redactor over the JSON value model lives in `packages/trace/src/redaction.ts`, and
`createRedactingTraceWriter({ writer, policy? })` applies it as a `TraceWriter` decorator, so the
chain an application assembles is `TraceRecorder -> redacting writer -> buffered writer ->
TraceSink`. It sits **above the buffer** on purpose: an unredacted event that reached the buffer
would already be in memory in the clear, would be retried from there after a sink rejection, and
would be written by any sink added later that forgot to redact. Every sink behind it, including
M2-T5's Supabase sink, inherits the guarantee without implementing anything, and `redactEvents()`
is exported so a sink can re-apply it defensively. It lives in `packages/trace` rather than
`packages/core` because core owns what an event *is* and this package owns what happens on the way
to storage.

The four mechanisms. **Field paths** are a glob over the JSON tree with `.` between segments, `*`
for exactly one segment and `**` for any number including none, array indices addressable as
segments, literal segments compared case-insensitively by default; a match replaces the value
whatever its type. **Secret patterns** are applied to every string leaf and replace only the span
they matched, so a sentence containing a credential keeps its sentence; eleven rules ship —
`private-key-block`, `aws-access-key-id`, `github-token`, `slack-token`, `supabase-secret-key`,
`supabase-access-token`, `vercel-ai-gateway-key`, `api-key-sk-prefix`, `jwt`,
`authorization-bearer`, `authorization-basic` — and every one matches a format its issuer
documents, with the Supabase (`sb_secret_`, `sbp_`) and Vercel (`vck_`) formats verified against
their current documentation during this task. **Headers** redaction replaces a known header name
wherever it is a key of an object whose own key is `headers`, at any depth, case-insensitively on
both. **Tool sanitizer hooks** are keyed by `payload.tool` on a `tool.*` event, run before the
generic rules, and have their output put through them, so a hook is a way to know more than the
harness does and never a way to opt out of what it enforces.

Three deliberate refusals. There is **no high-entropy heuristic** in the default set: every
identifier the harness writes is high entropy on purpose — a UUIDv7 id, a `sha256:` fingerprint, an
eve `callId` — so such a rule would redact the trace's own structure and make a run unreadable.
There is **no `strict: false`**, because a flag that disables redaction is the flag that will be
set in the one environment where it matters; `createRedactionPolicy()` concatenates onto the
defaults and never substitutes for them. And a removed value becomes **`[REDACTED:<rule-name>]`**
rather than a bare `***`, because a trace is evidence and a reader should be able to see that
something was there, that it went deliberately, and which rule decided.

Scope inside an event: `payload`, and an error's `message`, `details`, `stack` and whole `cause`
chain, which is the "Before starting" prerequisite above — ADR-0026's `details` is not a redaction
boundary and is walked here. Never `id`, `runId`, `attempt`, `sequence`, `timestamp`, `type`,
`parentId`, `node`, `version`, `behaviorFingerprint`, `usage`, `latencyMs`, or an error's `name`
and `code`. A redacted event is a new frozen object; the input is neither mutated nor frozen.

`apps/example-agent/src/run.ts` wraps the buffered writer, and because adapter payloads are
identity-only (ADR-0031) a healthy run's trace still contains no redaction token at all: a verified
`pnpm example:run:mock` wrote the same six events with the same payload keys and zero `[REDACTED`
occurrences. Documented in [`../contracts/redaction.md`](../contracts/redaction.md), with a
Redaction section in [`../contracts/trace-event.md`](../contracts/trace-event.md) and a pointer
from [`../contracts/errors.md`](../contracts/errors.md).

### M2-T10, Local run inspector

**Status:** completed (2026-09-20).

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

**Result.** The build plan's eight display items are the eight fields of one value. `inspectRun()`
in the new `@internal/observability` package gathers a run into a `RunInspection` — plain,
JSON-able, in the plan's order — and `renderRunInspection()` turns that value into text, so
`--json` and the human form are two views of one thing rather than two implementations free to
disagree. Nothing in the inspector reads anything but the `Storage` port or a JSONL trace file: no
log, no stdout capture, no running agent. That is what makes "a trace reconstructs execution
without application logs" a command anyone can run rather than a claim in a document.

**Partial evidence is inspectable, and says what is missing.** A run with no ledger row, a ledger
row with no trace, and a trace-only file each produce an inspection carrying `found`, an
`availability` triple and human-readable notes; only a run with neither a row nor a single event is
`found: false`. The case ADR-0036's write ordering actually produces — a crash leaving a `running`
row and no terminal event — prints the row and `no trace events for this run`. `inspectRun()` never
throws for absence, and does propagate a `StorageError` or a `ValidationError`, because those mean
the evidence itself is untrustworthy.

The CLI is `pnpm harness run show <run-id>`, built on Node 24's built-in `node:util` `parseArgs` in
strict mode with **no dependency added**; AD-016 required the choice be recorded, and ADR-0037 does
that along with why the entry point lives in `packages/observability` rather than in a
`packages/cli` the build plan's layout does not name. pnpm forwards the positional arguments with
no `--` separator (verified empirically against a throwaway script before the real one was
written), and turbo's build output is redirected to stderr so `--json` pipes cleanly. `--jsonl
<path>` reads `.harness/traces/<runId>.jsonl` instead, so a run is inspectable with **no database,
no key and no Docker** — north-star invariant 15, and the case that matters most, because the run
whose storage write failed is the one you most want to read. Exit codes are 0, 1 (not found, or a
configured store unreachable) and 2 (usage); an unknown subcommand prints section 10's whole target
list marked with what is implemented.

`parseTraceEvent()` moved into `@internal/core`, beside `parseJob()` and `parseRunRecord()`. The
Supabase adapter's private `readTraceEvent` had carried a comment saying that if a second reader
ever needed those checks they belonged in core; the inspector is that reader, so they moved, and
the adapter's function is now the column-name mapping alone. A hand-edited row and a hand-edited
JSONL line now fail identically. Reading a JSONL trace back is `readJsonlTraceEvents()` in
`@internal/trace`, in the module beside the sinks that define the format, so "one canonical-JSON
event per line" keeps exactly one owner.

**Two routes to one cost.** The inspection reports the ledger's `costUsd` beside the same figure
summed from the run's own span events, because `TraceEventUsage` promises those agree and a
disagreement is a finding nobody would otherwise see. `run.*` events are excluded from that sum:
they carry the run's totals, not their own usage, so including them doubled every figure — caught
by a test, not by reading.

**What the inspector cannot show is the run's output value**, and it says so rather than printing a
blank: `HarnessRunResult.output` is returned in process and a trace payload is identity-only by
rule (ADR-0031), so nothing durable holds it. The `artifacts` table (M2-T6) is where it belongs and
M5 is what fills it.

Verified against a real local Supabase, not only in memory: `pnpm example:run:mock` wrote run
`01a0bd00-3903-7001-9ee5-c9d68f7ecb3b`, and `pnpm harness run show` on it printed all eight
sections with the six-event timeline, the one model call paired to its `model.completed`,
612/61/673 tokens, `(none)` for a cost the mock model never reported, and
`consistent: yes, every event carries the run's fingerprint` over the eight component digests.
`--json` piped cleanly; `--jsonl` on the same run's trace file printed the same timeline, calls,
tokens and digests with `job and ledger row unavailable (trace-only source)`. An unknown id exits 1
with `run <id> not found`, `pnpm harness workflow list` exits 2 with the target list, and with
Supabase stopped the command prints `apps/example-agent/src/run.ts`'s one-line
configured-but-unreachable message and exits 1. Tests: 52 unit cases in the new package plus 15 for
`parseTraceEvent` and 8 for the JSONL reader, and a three-case integration leg that writes runs
through the real harness and adapter and reads them back, which skips with a printed reason when
the Supabase variables are absent.

Recorded in
[ADR-0037](../decisions/0037-the-run-inspector-is-a-library-over-the-storage-port-with-a-parseargs-cli.md);
operated per [`../runbooks/inspecting-a-run.md`](../runbooks/inspecting-a-run.md).

### M2-T11, Reproducible local Supabase environment

**Status:** completed (2026-09-19).

**Result.** A local Supabase is now reproducible from what is committed, and the CLI that produces
it is pinned like any other dependency. `supabase@2.117.0` is an exact root `devDependencies` pin
(no range), driven only through `pnpm` scripts so it resolves from `node_modules/.bin`; the
development host's Homebrew CLI, twelve minor versions behind at 2.105.0, is never used and never
required. pnpm's release-age gate did not trigger and `pnpm-workspace.yaml` is unchanged: the
package was published about 33 hours before the install, and `pnpm install` reported
`Lockfile passes supply-chain policies` while appending nothing to `minimumReleaseAgeExclude`. The
npm package ships its platform binary as an optional dependency rather than a postinstall
download, so pnpm 12's blocked lifecycle scripts do not affect it and no `onlyBuiltDependencies`
entry was needed. `tests/toolchain/supabase-cli-pin.test.ts` extends ADR-0024's mechanism to it,
reading both the pin and the installed version from disk and also asserting the four scripts still
wrap the four CLI commands verbatim.

`supabase init` (non-interactive by default in 2.117.0; `-i` is what would have generated editor
settings, and was not used) wrote `supabase/config.toml` and `supabase/.gitignore`. `project_id`
defaulted to the working-directory name, `adaptive-agent-harness`, which is the stable value
wanted, so the file is committed at the CLI's defaults with nothing changed. Ports were checked
rather than moved and none collides: API 54321, DB 54322, shadow 54320, Studio 54323, Mailpit
54324, analytics 54327, pooler 54329 (disabled), edge-runtime inspector 8083, against `eve dev`'s
default 2000 and `eve start`'s 3000. `supabase/migrations/` carries a `README.md` saying M2-T6
fills it, and `supabase/seed.sql` is an empty file with a header; both are what `db reset` needs
to be meaningful before a schema exists.

`packages/storage-supabase` (`@internal/storage-supabase`) is scaffolded on the `packages/trace`
template and holds exactly one thing: `src/index.ts` re-exporting the generated `Database` type.
`@supabase/supabase-js` is deliberately **not** installed; whether the adapter needs it is M2-T5's
decision. The package was already in `adapterPackages`, so `tests/architecture/boundaries.ts`
needed no change at all; the one architecture-test edit was adding the package name to the
workspace-discovery assertion in `package-boundaries.test.ts`, which exists precisely so a new
package cannot be silently ungoverned.

**Reproducibility is verified, not asserted.** The full sequence ran against real Docker: start,
reset (zero migrations plus the seed, exit 0), generate types, reset a second time, generate
again, and the two generations are byte-identical
(`sha256:5e938e4d...`, `git diff --no-index --exit-code` silent). `git diff` rather than a checksum
comparison is what CI uses, through a new `supabase-types` job that starts, resets, regenerates,
runs `git diff --exit-code` on the one generated path, and stops with `if: always()`. It is a
second job rather than steps on `check` because it needs Docker and minutes of image pulls, and
`check` must stay the fast gate. Supabase was left **stopped**.

Two facts about 2.117.0 shaped the scripts. `supabase gen types` has **no output-file flag**, so
`pnpm supabase:types` redirects stdout; its log lines go to stderr, so the redirected file is
clean, but a failed generation truncates the committed file, which the runbook and ADR both call
out. And the generated file carries **no hand-written header on purpose**: a header would be
deleted by the next generation and would then register as drift in the job whose purpose is
detecting drift, so "generated, never hand-edit" lives in AGENTS.md rule 12, the package's
`src/index.ts`, the runbook and the ADR instead. Biome's formatter would rewrite the generator's
output (it omits semicolons), so `biome.json` gained an `overrides` entry disabling the
**formatter** for that one path; linting still applies and already passes.

No key value was written anywhere. Local URLs and keys are captured into a git-ignored
`.env.local` via `supabase status -o env --override-name ...`, mapped onto the names
`.env.example` already declares, and the root `.gitignore` gained explicit `supabase/.temp/`,
`supabase/.branches/`, `.env.local` and `.env*.local` entries so the rule survives the CLI's own
ignore file being regenerated.

Recorded in
[ADR-0033](../decisions/0033-supabase-cli-as-a-pinned-dev-dependency-with-reset-as-the-reproducibility-gate.md)
and operated per the new runbook
[`../runbooks/supabase-local.md`](../runbooks/supabase-local.md). Verification: the reproducibility
sequence above, `pnpm typecheck` (8 packages), `pnpm build` (8 packages), the architecture and
toolchain suites (22 tests, 3 files), and `pnpm example:run:mock` (exit 0, `completed`), all PASS.
`pnpm check` is **FAIL**, at its first stage and for reasons outside this task: `biome format`
reports four unformatted files owned by the concurrent M2-T8 and M2-T9 work
(`packages/core/src/behavior.ts`, `behavior.test.ts`, `harness.test.ts`,
`packages/trace/src/secret-patterns.ts`) and `pnpm lint` reports an import-order fix in
`packages/trace/src/redacting-trace-writer.ts`. Every file this task touched passes both.

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

- Every example execution has a durable run row and ordered trace. **verified 2026-09-19**
  (M2-T5, M2-T7): `pnpm example:run:mock` with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` set
  exited 0 and printed where the row went. Querying it back:
  `runs` has one row for `01a0bcd7-1256-7001-b00d-60e9296aa3d0` with `status = completed`,
  `success = t`, `attempt = 1`, `domain_id = vendor-triage`, `job_type = vendor-triage`,
  `model_calls = 1`, `tool_calls = 0`, `jev_calls = 0`, `fallback_count = 0`, `latency_ms = 173`,
  `runtime_name = eve`, `runtime_version = 0.63.0`,
  `agent_version = sha256:c0ab81341295c366…`, `target = @internal/eve-fixture-agent`, and both
  `started_at` and `finished_at` set; `select count(*) from trace_events where run_id = …` returns
  **6**, sequences 0 to 5, types `run.started`, `agent.started`, `model.started`,
  `model.completed`, `agent.completed`, `run.completed`, with `parent_id` set on the four
  non-`run.*` events. The run's job row is there too, with the full effective job in `job jsonb`.
- A trace reconstructs execution without application logs. **verified 2026-09-19** (M2-T5): the
  contract suite's "reconstructs a whole execution from storage alone" case, run against Supabase,
  starts from a run id and nothing else: `getRun()` returns the ledger row (status, target,
  behavior fingerprint, usage, timings), `getJob(run.jobId)` returns the job through `parseJob()`
  with its objective, input, contracts, budget and permissions intact, and `getTrace(runId)`
  returns the events in `sequence` order with their parent links, usage and latencies. No log file,
  no stdout and no second source is consulted. The same case passes against the in-memory
  implementation, which is what proves it is a property of the port rather than of one adapter.
- Retrying creates a new attempt, not duplicate events. **verified 2026-09-19** (M2-T5, M2-T7):
  two halves, both asserted against Supabase and against the in-memory implementation. On the
  ledger, `startRun` for a second run of `(job_id, attempt = 1)` is **rejected** with a
  `StorageError` (the `unique (job_id, attempt)` constraint), while `attempt = 2` of the same job
  is accepted as a separate run row and `listRuns({ jobId })` then returns both. On the trace,
  sending the identical batch twice leaves two rows, not four, and re-sending a different event at
  an already-written `(run_id, sequence)` leaves the **first** payload, because a trace is
  append-only and the adapter upserts with `ON CONFLICT (run_id, sequence) DO NOTHING`. That is
  exactly what the buffered writer does after a sink rejection, so the retry path is the one under
  test.
- Seeded secrets never appear in stored trace payloads. **verified (M2-T9)**: a real
  `createHarness()` run whose job input carries seeded fake credentials (an AWS access key id, an
  `sk-` API key, a GitHub token, a Supabase secret key, a Vercel AI Gateway key and a bearer
  credential), against a runtime that deliberately echoes that input into a `tool.completed`
  payload, an `agent.completed` payload, an `Authorization` header and a thrown failure's
  `details` and `cause`, leaves no seeded value anywhere in the events the sink received or in the
  JSONL file written to disk — asserted for both a completed and a failed run, on
  `JSON.stringify` of the sink's events and on the file's text. The seeds are built at runtime
  from fragments and `pnpm exec secretlint --no-glob` passes on the test files.
- Behavior fingerprint changes when instructions/SOP/policy changes. **verified (M2-T8,
  2026-09-19)**: `createBehaviorFingerprint` moves the composite and exactly the named component
  for each of the three, in `packages/core/src/behavior.test.ts` and against the real descriptor
  in `apps/example-agent/src/behavior.test.ts`; and end to end, editing one line of
  `agent/instructions.md` moved a `pnpm example:run:mock` trace's fingerprint from
  `sha256:c0ab8134…` to `sha256:c9b02cd6…` with only the `instructions` component changed. A
  reordered or CRLF-converted descriptor does not move it.
- Migrations can create a clean database from zero. **verified 2026-09-19** (M2-T6):
  `pnpm supabase:reset` drops and recreates the database and applies all five committed migrations
  in order, exit 0, printing `Applying migration 20260920030254_domains_and_jobs.sql` through
  `20260920030301_later_milestone_tables.sql`. The thirteen tables then exist and are reachable
  through PostgREST, asserted table by table in `supabase-schema.integration.test.ts`, and
  `pnpm supabase:types` regenerates the committed types with two consecutive generations
  byte-identical.
- A failed run remains inspectable. **verified 2026-09-19** (M2-T5, M2-T7): a harness run against
  a runtime that throws produces a `failed` result **and** a `failed` ledger row carrying the
  serialized error, with the storage calls in order `saveJob`, `startRun`, `finishRun`
  (`packages/core/src/harness.test.ts`). Read back from Supabase, the row has `status = failed`,
  `success = f` and `error.code = AGENT_EXECUTION`, beside its ordered trace. An **aborted** run is
  recorded as `aborted` with `success = null` rather than as a failure, so a cancellation is not
  filed as a defect. The stronger case is a crash: because `startRun` runs before the first trace
  event, a process that dies mid-run leaves a `running` row rather than nothing, which is asserted
  by the "does not write the outcome when flushing the trace fails" case; also verified through the
  inspector (M2-T10), which prints a failed run's error twice over — from the `*.failed` events and
  from the ledger row — and which is required never to throw for a partial record, so the
  `running`-row-with-no-trace case renders as the row plus `no trace events for this run` rather
  than as an error.
- Storage failures cannot silently turn into successful runs. **verified 2026-09-19** (M2-T5,
  M2-T7): a `Storage` whose `saveJob`, `startRun` or `finishRun` throws makes `harness.run()`
  **reject** with a `StorageError` rather than return any result, asserted for all three
  (`packages/core/src/harness.test.ts`). A `startRun` failure also means the agent runtime is never
  called at all, so nothing is spent on a run that cannot be recorded. A trace-flush failure leaves
  the ledger row `running` and no `finishRun` is attempted, so a `completed` row never outlives the
  evidence for it. And an implementation that throws something that is **not** a `StorageError` is
  wrapped into one with the cause preserved, so a defect in an adapter cannot become a defect in
  the harness.
- `pnpm supabase:reset` recreates the database from committed migrations and seed. **verified
  2026-09-19** (M2-T11): exit 0 from an empty database, applying zero migrations and
  `supabase/seed.sql`. Re-verified on a second consecutive reset.
- `pnpm supabase:types` regenerates committed TypeScript database types without drift.
  **verified 2026-09-19** (M2-T11): two generations separated by a full `db reset` are
  byte-identical, and the new `supabase-types` CI job enforces it with
  `git diff --exit-code`.
