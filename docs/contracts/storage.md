---
status: active
owner: core
last_verified: 2026-09-20
related:
  - docs/milestones/build-plan.md
  - docs/contracts/harness.md
  - docs/contracts/workflow-registry.md
  - docs/contracts/job.md
  - docs/contracts/trace-event.md
  - docs/contracts/identifiers.md
  - docs/contracts/redaction.md
  - docs/decisions/0036-storage-is-a-core-port-over-a-supabase-schema-with-runs-as-the-ledger.md
  - docs/decisions/0033-supabase-cli-as-a-pinned-dev-dependency-with-reset-as-the-reproducibility-gate.md
  - docs/decisions/0043-the-workflow-registry-is-a-status-model-in-core-with-an-exact-match-selector.md
  - docs/runbooks/supabase-local.md
implementation:
  - packages/core
  - packages/registry
  - packages/storage-supabase
  - packages/testing
  - packages/trace
  - supabase/migrations
---

# Storage

`Storage` is the port the harness persists through. It is declared in
`packages/core/src/storage.ts` (M2-T5) and carries the outcome ledger row
(M2-T7). The schema behind it is the thirteen tables in
`supabase/migrations/` (M2-T5, M2-T6). [ADR-0036](../decisions/0036-storage-is-a-core-port-over-a-supabase-schema-with-runs-as-the-ledger.md)
records why it is shaped this way.

M5-T1 added a second half: six methods for the **workflow registry**, and the real columns on the
three registry tables. It is on this port rather than on a second one because a run's ledger row
already carries `workflowVersionId`, and a registry behind its own port would be a second thing to
configure against the same database. What those methods mean is
[`workflow-registry.md`](workflow-registry.md).

```ts
const storage = createSupabaseStorage({
  url: process.env.SUPABASE_URL,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
});

const harness = createHarness({
  agentRuntime,
  storage,
  target: "@internal/example-agent",
  trace: createRedactingTraceWriter({
    writer: createBufferedTraceWriter({ sink: createStorageTraceSink({ storage }) }),
  }),
});
```

It is declared in `@internal/core`, which depends on nothing, because the
dependency rule says core cannot import Supabase (build plan section 4). Core
states what persistence means; an adapter decides what it runs against. Two
implementations exist and both run the same contract suite:

| Implementation | Package | Used by |
|---|---|---|
| `createSupabaseStorage()` | `@internal/storage-supabase` | the real thing; the only package allowed to touch a database |
| `createInMemoryStorage()` | `@internal/testing` | unit tests and any caller that wants a run's record without a database |

## The three properties that define it

1. **A run row exists before its first trace event.** `startRun()` is called
   while the run is still being prepared, so every trace has something to hang
   off and a process that dies mid-run leaves a `running` row rather than
   nothing at all. "A failed run remains inspectable" is a property of that
   ordering, not of good behaviour afterwards.
2. **Every failure is a `StorageError` and every failure propagates.** A
   storage call that fails comes out of `harness.run()`. A run whose record was
   not written is not a run anyone can inspect, evaluate or replay, so returning
   `completed` for one would put a false record into the dataset the milestone
   exists to make trustworthy.
3. **Appending a trace batch twice is a no-op.** `(runId, sequence)` is the
   identity of an event, so a buffered writer that retries a failed batch cannot
   duplicate a run's narrative.

## The interface

| Method | Meaning |
|---|---|
| `saveJob(job)` | Record a job and upsert the domain it belongs to. Idempotent by job id, because a job is immutable. |
| `startRun(input)` | Create the ledger row in `running` state and return it. Rejects if `(jobId, attempt)` already has a row. |
| `finishRun(input)` | Write the outcome onto an existing row and return the completed record. Rejects if the run was never started; never creates a row. |
| `getRun(runId)` | One ledger row, or `null`. |
| `getJob(jobId)` | One job, through `parseJob()`, or `null`. |
| `listRuns(filter?, cursor?)` | Runs newest first, filtered and paged. |
| `appendTraceEvents(events)` | Append a batch. Idempotent on `(runId, sequence)`. |
| `getTrace(runId, cursor?)` | One run's trace in `sequence` order, paged. |
| `saveWorkflow(record)` | **M5.** Upsert by `(domainId, workflowKey)` and return the row that now exists, which carries the original `WorkflowId` when the key was taken. Upserts the domain too. |
| `saveWorkflowVersion(record)` | **M5.** Plain insert. A duplicate `(workflowId, fingerprint)` rejects loudly. |
| `getWorkflowVersion(id)` | **M5.** One version, through `parseWorkflowVersionRecord()`, or `null`. |
| `listWorkflowVersions(filter?, cursor?)` | **M5.** Versions newest first, filtered and keyset-paged. |
| `setWorkflowVersionStatus(input)` | **M5.** One transition, applied as a compare-and-set, plus its promotion ledger row. |
| `listWorkflowPromotions(versionId)` | **M5.** One version's history, oldest first, unpaged. |
| `saveDecision(record)` | **M3.** Plain insert of one decision's complete evidence. A duplicate `DecisionId` rejects loudly. |
| `listDecisions(runId)` | **M3.** One run's decisions, oldest first by `id`, unpaged. |

Every method is `async` and rejects with `StorageError` (cause preserved) when
the store fails, or `ValidationError` when the caller passed something the port
forbids.

### Paging is keyset, never offset

`listRuns` returns runs **newest first**, and its cursor is a `RunId`: `after`
means "strictly older than this run". `getTrace` returns events in ascending
`sequence`, and its cursor is a `sequence`. A `limit`/`offset` pair over an
append-only ledger silently skips or repeats rows whenever a run starts
mid-pagination; a keyset cursor over a sortable id cannot. Both return
`nextCursor: null` on the last page rather than omitting the field.

`listWorkflowVersions` pages the same way, newest first, with a `WorkflowVersionId` cursor.
`listWorkflowPromotions` is the one list that is neither newest-first nor paged: it is the
narrative of how a version reached its status, and the transition table bounds it.

`listDecisions` is the other unpaged list, and for the same kind of reason: it is one run's
judgments in the order they were made, and the number of `jev` nodes in a workflow bounds it. A
`DecisionId` is a sortable UUIDv7, so `id` order **is** that order.

`DEFAULT_RUN_PAGE_SIZE` is 50, `DEFAULT_WORKFLOW_VERSION_PAGE_SIZE` is 50 and
`DEFAULT_TRACE_PAGE_SIZE` is 500.
`MAX_PAGE_SIZE` is 1000, matching `max_rows` in `supabase/config.toml`; a larger
`limit` is a `ValidationError` rather than a silent truncation, because a short
page looks exactly like the end of the data.

## `RunRecord`: the outcome ledger

One query-friendly row per run (M2-T7). The build plan's list is here in full,
in real columns rather than a payload, because the point of the ledger is that
cost, latency, success and lineage are answerable by `select` and `group by`
without opening a JSON document. `parseRunRecord()` is the strict read boundary,
the same thing `parseJob()` is for jobs and `parseTraceEvent()` is for events.

The port's first read-only consumer is the run inspector,
`inspectRun()` in `@internal/observability` (M2-T10): it calls `getRun()`,
`getJob()` and pages `getTrace()` to completion, and nothing else. It takes the
port rather than an adapter, so it reads the in-memory implementation and the
Supabase one identically, and
[`../runbooks/inspecting-a-run.md`](../runbooks/inspecting-a-run.md) is how to
run it.

| Field | Column | Meaning and who fills it |
|---|---|---|
| `runId` | `id` | The run. Sortable, so it doubles as a ledger cursor. |
| `jobId` | `job_id` | The job. |
| `attempt` | `attempt` | Ordinal from 1. `(job_id, attempt)` is unique. |
| `domain` | `domain_id`, `domain_version` | AD-008's middle learning scope. |
| `jobType` | `job_type` | AD-008's innermost learning scope. |
| `status` | `status` | `running` until a terminal event, then `completed`, `failed` or `aborted`. |
| `success` | `success` | `null` while running **and for an aborted run**: a cancellation is not a defect. |
| `qualityScore` | `quality_score` | **M6.** `null` means not evaluated, which is not zero. |
| `costUsd` | `cost_usd` | `null` when no producer knew. |
| `latencyMs` | `latency_ms` | Measured by the harness clock. |
| `modelCalls` | `model_calls` | From the execution's usage. |
| `toolCalls` | `tool_calls` | From the execution's usage. |
| `jevCalls` | `jev_calls` | Decisions the run asked a `DecisionEngine` for, including ones that threw. See below. |
| `fallbackCount` | `fallback_count` | **0 until M5**, for the same reason. |
| `humanReview` | `human_review` | **M5/M6.** `null` means not reviewed. |
| `workflowVersionId` | `workflow_version_id` | **M4.** `null` is also the honest answer for a run that used the full agent. |
| `agentVersion` | `agent_version` | The composite behavior fingerprint. See below. |
| `behaviorFingerprint` | `behavior_fingerprint` | The same digest every trace event of the run carries. |
| `runtime` | `runtime_name`, `runtime_version`, `runtime_metadata` | Which adapter ran it, plus its own free-form detail. |
| `target` | `target` | Which application or agent executed. See below. |
| `startedAt` | `started_at` | ISO 8601. |
| `finishedAt` | `finished_at` | `null` while running. |
| `error` | `error` | The trace-safe serialized error, redacted. |

### `agentVersion` is the behavior fingerprint

The build plan asks the ledger for an "agent version". A hand-maintained version
string is precisely the value that stops tracking reality without anyone
noticing, and north-star invariant 4 needs one that cannot. The composite
`sha256:` behavior fingerprint (M2-T8) is therefore what the column holds.
`behavior_fingerprint` carries the same value in its own column, so that a later
decision to make `agent_version` mean something else does not silently change
what the fingerprint column means.

### `target` closes ADR-0034's open question

A behavior fingerprint describes a **domain**. The example runs one domain
against two different agents, a live one and a credential-free mock, so the two
share a fingerprint and nothing else in the record distinguishes them.
`target` is the application or agent that actually executed, taken from
`CreateHarnessOptions.target`, and it is on the harness rather than on a run
because it identifies the deployment rather than the work.


### `jev_calls`, and the comment on the column (M3, M5)

`runs.jev_calls` is a **measurement** as of M5. The harness no longer writes a hardcoded `0`: the
workflow interpreter counts each decision it asks a `jev` node's engine for, the router carries
that count through both the compiled path and a fallback, summing the workflow's decisions with any
the full agent made after taking over, and `createHarness()` copies
`AgentExecution.jevCalls` into `RunFinish`. A runtime that makes no decisions reports none, so `0`
is now "it made none" rather than "nobody counted".

A call is counted **where `decide()` is invoked**, not derived from the node records afterwards. A
record's `attempts` counts retries of the whole node, including an attempt that failed input
validation before any engine was reached, and this column is meant to be what the decision layer
was asked to do. A call that threw still counts: it was made, and it may well have been paid for.

**The SQL comment on the column still says otherwise.** `supabase/migrations/20260920030258_runs_outcome_ledger.sql`
describes `jev_calls` as a placeholder that is zero until M3, and migrations are append-only and
never hand-edited after the fact (AGENTS.md rule 12 and the M2 migration rules), so it cannot be
corrected in place. This section is the authority; a future migration may restate the comment if
one is needed for another reason.

## Where it sits in the harness

`createHarness({ storage })` is optional, and **a harness without one behaves
exactly as it did before M2-T5**: a full ordered trace through `trace`, and no
database. That is what keeps `pnpm example:run:mock` working on a machine with
no Docker, which is north-star invariant 15.

When it is present, one run does this:

1. validate the input, build the job, mint the run id, fingerprint the behavior;
2. `saveJob()`, then `startRun()` — **before the first trace event**;
3. record `run.started`, run the agent, record the terminal event;
4. flush the trace writer;
5. `finishRun()`.

The ledger is written **after** the flush, deliberately. The run row is the
claim that a run reached an outcome and the trace is the evidence for it;
writing the claim first and then failing to write the evidence would leave a
`completed` row nobody can verify. Failing in the other order leaves a `running`
row beside a complete trace, which is visibly incomplete rather than quietly
wrong.

Any failure in steps 2 or 5 comes out of `run()` as a `StorageError`. The
harness wraps anything an implementation throws that is not already one, with
the cause preserved, for the same reason it already contains a runtime adapter
that throws instead of returning a failure: a defect in an implementation must
not become a defect in the harness.

## Persisting the trace

Trace events do **not** go through `createHarness({ storage })`. They go through
a `TraceSink` over the same `Storage`, so they keep the buffered writer's
ordering, batching and retry guarantees rather than acquiring a second set:

```
TraceRecorder -> redacting writer -> buffered writer -> sink
```

`createStorageTraceSink({ storage })` in `@internal/trace` is that sink. It
takes the port rather than Supabase, so the in-memory implementation works
behind it too. `createFanOutTraceSink([a, b])` puts several sinks behind one
buffered writer, which is how the example writes both a JSONL file and Supabase
from one buffer and one flush; it attempts every sink and fails the write if any
of them failed, so a retry re-sends the batch to all of them.

### Redaction

Redaction happens twice, and the second time is not waste.

- The **redacting writer** sits above the buffer (ADR-0035), so nothing
  unredacted is ever buffered.
- The **storage sink** and the **Supabase adapter** redact again. Redaction is
  idempotent — a `[REDACTED:…]` token matches no secret pattern and a field-path
  rule replaces it with the identical token — so the second pass changes nothing
  when the first one ran, and is the only pass when a caller assembled their
  chain without the redacting writer.

The Supabase adapter also redacts **the run row's `error` and
`runtime.metadata`**, which no writer chain reaches. A serialized error's
`details` is explicitly not a redaction boundary (ADR-0026) and its `message` is
whatever a framework wrote, so redacting the trace's copy of a value while
leaving the ledger's copy alone would be an inconsistency with a secret in it.

A **job is not redacted**. Its `input` is the work itself, and a harness that
stored a redacted job could not replay one.

## The schema

Thirteen tables, in `supabase/migrations/`, applied in file order. The rules
they share: every id column is `uuid` with **no database default**, because ids
are harness-minted UUIDv7 (ADR-0030); stable indexed metadata lives in columns
and versioned payloads in `jsonb`; row-level security is enabled on every table
with **no policies**.

| Table | Milestone | Key columns |
|---|---|---|
| `domains` | M2 | `(id, version)` primary key, `organization_id` |
| `jobs` | M2 | `id`, domain FK, `job_type`, `objective`, `job jsonb`, `behavior_fingerprint` |
| `runs` | M2 | the ledger columns above; unique `(job_id, attempt)`; FKs to `jobs`, `domains`, `workflow_versions` |
| `trace_events` | M2 | `id`, `run_id` FK, `attempt`, `sequence`, `occurred_at`, `type`, `parent_id` self-FK, `node`, `version`, `behavior_fingerprint`, `payload`/`usage`/`error` jsonb; unique `(run_id, sequence)` |
| `artifacts` | M5 | `id`, `run_id` FK, `payload jsonb` |
| `workflow_definitions` | M2 shape, **M5 columns** | `id`, domain FK, `workflow_key`, `job_type`; unique `(domain_id, workflow_key)` |
| `workflow_versions` | M2 shape, **M5 columns** | `id`, `workflow_id` FK, `domain_id`, `job_type`, `fingerprint`, `status`, `definition jsonb`, `compatibility jsonb`, `status_changed_at`, `metadata jsonb`; unique `(workflow_id, fingerprint)` |
| `workflow_promotions` | M2 shape, **M5 columns** | `id`, `workflow_version_id` FK, `from_status`, `to_status`, `actor`, `reason` |
| `decisions` | M3 | `id`, `run_id` FK, `payload jsonb` |
| `eval_runs` | M6 | `id`, domain FK, `payload jsonb` |
| `eval_results` | M6 | `id`, `eval_run_id` FK, `payload jsonb` |
| `learning_runs` | M7 | `id`, domain FK, `payload jsonb` |
| `compiler_runs` | M8 | `id`, domain FK, `payload jsonb` |

The three workflow registry tables were created in that minimal shape by M2-T5 and filled by M5-T1
in a **new** migration, `..._workflow_registry_columns.sql`, which also drops their `payload jsonb`
placeholder. What the columns mean is
[`workflow-registry.md`](workflow-registry.md) and
[ADR-0043](../decisions/0043-the-workflow-registry-is-a-status-model-in-core-with-an-exact-match-selector.md).

The six remaining later-milestone tables carry their **minimal keyed shape only**:
identity, the foreign keys that fix how they relate, a timestamp and one
`payload jsonb`, plus a comment naming the milestone that fills them. Their
columns are not invented here.

### Indexes (AD-016)

| Index | Answers |
|---|---|
| `runs (domain_id, job_type, started_at desc)` | AD-008's learning scope, newest first. |
| `runs (status, started_at desc)` | "what is still running / what failed". |
| `runs (job_id, attempt)` | the attempts of one job. |
| `trace_events` unique `(run_id, sequence)` | **also the index** every trace read uses. No second index on the same two columns exists; it would be byte-for-byte redundant. |
| `trace_events (type, id desc)` | "every model call / every failure, across runs". |
| `jobs (domain_id, job_type, id desc)` | jobs of a domain, newest first. |
| `domains (organization_id, id)` | AD-008's outermost scope. |

### Two column names differ from their contract fields

- `TraceEvent.timestamp` is the **`occurred_at`** column, because `timestamp` is
  a Postgres type name and a column called that needs quoting everywhere.
- `RuntimeInfo` is **three** columns, `runtime_name`, `runtime_version` and
  `runtime_metadata`, because the two identifying strings are grouped and
  filtered on and the adapter's free-form detail is not.

### `order by id` is creation order

ADR-0030 left this as an open caveat: UUIDv7's sortability is a property of its
bytes, and neither the Postgres 17 nor the 18 documentation states how `uuid`
values compare. It was measured rather than assumed, against the pinned local
Postgres 17.6, including the cases that would distinguish unsigned bytewise
comparison from a signed one. `uuid` ordering equals the lowercase textual
ordering of the same values, so a `uuid` primary key sorts in creation order and
works as a cursor. `supabase-schema.integration.test.ts` keeps checking it.

### Row-level security

Every table has RLS enabled and **no policies**. The harness connects as
`service_role`, which holds `bypassrls`; `anon` and `authenticated` therefore
reach nothing, even though Supabase grants them table privileges by default.
There is no multi-tenant auth in this milestone, and inventing policies for one
would be the speculative work scope discipline forbids. The integration suite
checks it with a real anon client on all thirteen tables.

## Environment

| Variable | Meaning |
|---|---|
| `SUPABASE_URL` | The API URL, e.g. `http://127.0.0.1:54321` locally. |
| `SUPABASE_SERVICE_ROLE_KEY` | The secret key. **Server-side only**: it bypasses RLS and must never reach a client, an agent tool or a trace. |
| `SUPABASE_ANON_KEY` | Optional; only the integration suite's RLS cases use it. |

Values are never committed. Capture them into the git-ignored `.env.local` with
`pnpm exec supabase status -o env …`; see
[`../runbooks/supabase-local.md`](../runbooks/supabase-local.md). The example
app's `start` script loads them with Node 24's
`--env-file-if-exists=../../.env.local`, so `pnpm example:run:mock` records to
Supabase when the file exists and stays JSONL-only when it does not, saying on
stderr which it did.

Both variables or neither. A URL with no key cannot authenticate and a key with
no URL has nowhere to go, so "one of them" is treated as not configured rather
than as a half-working setup that fails at the first query.

## Testing

- `packages/storage-supabase/src/storage.contract.test.ts` is the **contract
  suite**: one set of assertions, run against the in-memory implementation
  always and against Supabase when the two variables are set. M5-T1 extended it
  with the registry cases — round trip, list filtering and keyset paging,
  duplicate fingerprint rejected, illegal transition rejected, the
  compare-and-set, and the promotion ledger. It is in the
  `contract` project rather than `integration` because its purpose is proving
  two implementations of one port behave identically, which is that project's
  definition; it would be pointless against only one of them.
- `packages/storage-supabase/src/supabase-schema.integration.test.ts` is the
  **schema** suite: the thirteen tables, RLS against a real anon client, the
  `uuid` ordering, and the taxonomy check constraint. One possible
  implementation, so `integration`.
- Both **skip with a printed reason** when Supabase is unavailable, rather than
  failing. `pnpm check` must pass on a machine with no Docker, and a suite that
  fails for a missing environment gets ignored.

## `DecisionRecord`: one decision's evidence (M3-T3)

`saveDecision` and `listDecisions` write and read the `decisions` table, which M2-T5 created as a
minimal keyed placeholder and `20260920205520_decisions_columns.sql` filled. ADR-0045 records the
model; `decision-engine.md` documents what a record carries and why the two halves are apart.

What matters at the port's level is three rules:

1. **A duplicate id rejects.** A `DecisionId` is minted by the engine when it answers, so the same
   id twice means either a retry that should not have re-recorded or a collision, and both are
   facts a caller has to see. Nothing upserts; overwriting a decision would destroy the evidence a
   replay depends on.
2. **Reading goes through `parseDecisionRecord()`**, like every other read here. The six columns
   denormalized out of `result` — `state_fingerprint`, `question_ids`, `model_provider`, `model_id`,
   `cost_usd`, `latency_ms` — are deliberately **not** read back, for the same reason
   `workflow_versions.domain_id` is not: they exist so a query can `group by` without opening a JSON
   document, and reading them instead of the authoritative `result` would make a drifted row look
   consistent.
3. **`policy` may be `null`**, and that is a real state rather than a gap. It means no policy
   consumed the answer.

The `decisions` row and the run's trace join on `run_id`, and a record's `node_id` lines it up with
the `node.*` and `decision.*` spans of the same run, so `pnpm harness run show` and a `select`
describe the same judgments.
