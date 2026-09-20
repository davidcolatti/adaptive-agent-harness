---
status: accepted
date: 2026-09-19
deciders: harness owner, M2-T3/M2-T4 implementation agent
related:
  - docs/milestones/build-plan.md
  - docs/contracts/trace-event.md
  - docs/contracts/harness.md
  - docs/contracts/execution-context.md
  - docs/architecture/runtime.md
  - docs/decisions/0010-observability-trace-is-a-product-surface-captured-from-the-first-run.md
  - docs/decisions/0026-harness-errors-serialize-to-a-whitelisted-trace-safe-shape.md
  - docs/decisions/0028-eve-adapter-is-a-url-only-client-observing-the-event-stream.md
  - docs/decisions/0029-canonical-json-and-sha-256-behavior-fingerprints.md
  - docs/decisions/0030-sortable-uuidv7-entity-identifiers-owned-not-delegated.md
supersedes: null
superseded_by: null
---

# ADR-0031: Trace event taxonomy, recorder-owned sequencing, and the buffered writer

## Context

M2-T3 defines the event trace schema and M2-T4 the trace writer. They are one
decision because they share one question, which M1 left open and the M2 status
file lists first among its prerequisites:

> Harness `run.*` events and adapter `eve.*` events each number `sequence` from
> 0 within a run. M2-T4's writer must own sequencing (or M2-T3 must define a
> per-source key).

What M1 actually built: `TraceEvent` was a five-field placeholder with an open
string `type`; `createHarness()` kept a local counter and emitted
`run.started`/`run.completed`/`run.failed`/`run.aborted`; `EveAgentRuntime` kept
its own counter on `RunState` and emitted `eve.<stream event type>` with an
identity-only payload. Two counters, two vocabularies, one run. Nothing could
merge them into a single order, and nothing could switch on a type.

The build plan fixes the taxonomy (M2-T3's list), the field list ("every event
contains" — event ID, run ID, timestamp, sequence, parent span, node, event
version, behavior fingerprint, sanitized payload, usage, latency, error
metadata), and the writer interface verbatim:

```ts
interface TraceWriter {
  append(event: TraceEvent): Promise<void>;
  flush(): Promise<void>;
}
```

It says nothing about who assigns `sequence`, what a "parent span" is, how a
buffered writer behaves when its storage fails, or where events go locally
before M2-T5's database exists. AD-010 sets the standard those answers are held
to: the trace is a product surface, captured from the first working run, not
debug logging. Two M2 acceptance criteria depend directly on them: "a trace
reconstructs execution without application logs" and "storage failures cannot
silently turn into successful runs".

## Decision

### 1. The taxonomy is closed, and gains `run.aborted`

`TraceEventType` is the build plan's M2-T3 list, in its order, plus
`run.aborted`. It is exported as a runtime constant `TRACE_EVENT_TYPES` with an
`isTraceEventType()` guard, and a recorder MUST reject a type outside it.

`run.aborted` is an **amendment to the plan's list**. `createHarness()` already
emits it, and a run its caller cancelled is neither a completion nor a failure;
folding it into `run.failed` would report every cancellation as a defect in the
run ledger (M2-T7) and in every quality metric built on it.

Members with no producer yet (`decision.*`, `node.*`, `artifact.created`,
`fallback.*`, `eval.completed`) stay in the union, because the plan fixes them
and a partial list would have to be widened later.

### 2. Every event carries the plan's field list, made concrete

Fifteen fields; the full table is in `docs/contracts/trace-event.md`. The four
choices worth recording here:

- **`attempt` is a `number`, not an `AttemptId`.** ADR-0030 defined the brand
  and gave it no field. Where an attempt becomes a row with an id of its own is
  **M2-T5's** decision (the run ledger); a foreign key on this type before the
  table exists would be a guess. The ordinal is what "retrying creates a new
  attempt, not duplicate events" needs today.
- **"Parent span" is `parentId: TraceEventId | null`, and a `*.started` event's
  `id` IS its span id.** No separate span entity and no `spanId` field. A
  `*.completed`/`*.failed` points at its own `*.started`; a `model.*` or
  `tool.*` points at the enclosing `agent.started`; every `run.*` event is a
  root with `null`, because a run is already identified by `runId`.
  `agent.started` points at `run.started`, so the run remains the top of the
  tree.
- **`node` is typed now and always `null` until M4.** Writing the field before
  workflow nodes exist costs nothing and stops the schema changing when they do.
- **`behaviorFingerprint` is typed now and always `null` until M2-T8.** It MUST
  NOT be faked. North-star invariant 4 is that every behavior-affecting version
  is fingerprinted; a fingerprint that does not track behavior silently breaks
  every comparison built on it.
- **`error` is a `SerializedHarnessError` (ADR-0026), only on `*.failed`.**
  Never a raw `Error` and never a stack.
- **`payload` is identity-only**, as M1's adapter projection already was: no
  message content, no tool arguments or results, no model output. M2-T9 owns
  redaction and its sanitizers are the safety net, not the boundary.

`TraceEvent` and `TraceEventUsage` are declared as **type aliases rather than
interfaces**, so they carry an implicit index signature and are assignable to
`JsonObject`. `SerializedHarnessError` is one for the same reason.

### 3. A run-scoped `TraceRecorder` owns `sequence`

`TraceWriter` stays **verbatim as the build plan states it**. A writer is a sink
for complete events: it never mints an id, never assigns a sequence and never
reorders.

A new `createTraceRecorder({ runId, writer, attempt, clock, behaviorFingerprint })`
in `@internal/core` is the single owner of a run's ordering. It stamps `id`,
`runId`, `attempt`, `sequence`, `version` and `behaviorFingerprint`, and
`timestamp` when the caller supplies none. `sequence` is assigned synchronously
before any await, and appends are chained so the writer sees events in sequence
order under concurrency.

`ExecutionContext.trace` becomes a `TraceRecorder`. The field keeps its name:
`trace` is what an adapter reaches for, and renaming it would churn every call
site for no gain. `createExecutionContext` accepts either a `TraceWriter` (which
it wraps) or an already-built `recorder` (which wins). `createHarness()` builds
one recorder per run, records `run.started` through it, and passes the same
recorder down — which is the whole fix.

The recorder also exposes `rootId` (the run's `run.started` event, captured
automatically) and `span()`, whose `end()` sets `parentId` and measures
`latencyMs`. That is how an adapter sets parents without bookkeeping.

`EveAgentRuntime`'s own `state.sequence` is **deleted**.

### 4. The adapter maps onto the taxonomy instead of naming its own events

`EveAgentRuntime` no longer emits `eve.<type>`. The mapping, verified against
`eve` 0.63.0's `dist/src/protocol/message.d.ts` and
`dist/src/shared/action-types.d.ts`:

| eve stream event | trace event |
| --- | --- |
| `turn.started` | `agent.started` (opens the run's agent span) |
| `turn.completed` | `agent.completed`, with the run's accrued usage |
| `turn.failed`, `session.failed` | `agent.failed`, `payload.code` |
| `turn.cancelled` | `agent.failed`, `payload.cancelled: true` |
| `step.started` | `model.started`, `payload.modelId` |
| `step.completed` | `model.completed`, with the step's usage |
| `step.failed` | `model.failed`, `payload.code` |
| `actions.requested` | one `tool.started` **per requested action** |
| `action.result` | `tool.completed`, or `tool.failed` when `status` is `failed` or `rejected` |
| `input.requested` | `approval.requested` |
| `input.resolved` | `approval.resolved` |

Correlation follows eve's own documentation: tool spans are keyed by `callId`
(`ActionsRequestedStreamEvent` states that consumers "must correlate action
lifecycles by call ID"), model spans by `turnId` plus `stepIndex`, and each
event's instant is its `meta.at` rather than the harness clock. `meta.id` is
kept in the payload as `eveEventId` so a harness trace lines up against eve's
durable stream.

Three sub-decisions:

- **A cancelled turn is `agent.failed` with `payload.cancelled: true`**, not
  silence. A span nothing closes makes a trace unreadable, and the taxonomy has
  no `agent.aborted`; the run-level event is `run.aborted` in that case anyway,
  and the payload distinguishes it from a real failure.
- **A `rejected` action result is `tool.failed` carrying a
  `PermissionDeniedError`**, not a `ToolExecutionError`. eve's `rejected` means
  a human or a policy denied the call at an approval gate, so it never ran; that
  is a permission outcome, and ADR-0026 already draws exactly that line.
- **A failure event's harness error carries eve's `code`, never its
  `message`.** A provider failure message is text the harness did not author
  and M2-T9 has not sanitized.

**Eve events that are deliberately not trace events**: `session.started`,
`session.waiting`, `session.completed`, `message.received`, `message.appended`,
`message.completed`, `reasoning.appended`, `reasoning.completed`,
`action.input.appended`, `action.partial`, `result.completed`,
`context.cleared`, `compaction.requested`, `compaction.completed`,
`authorization.required`, `authorization.completed`, `approval.candidate`,
`approval.settled`, `subagent.called`, `subagent.started`, `subagent.event`,
`subagent.completed`. The deltas and `result.completed` are content the trace
does not carry; the session, compaction and context events describe eve's own
lifecycle rather than the agent's work.

Two of those omissions are worth naming, because a future milestone will want
them rather than a wider taxonomy:

- `approval.candidate` and `approval.settled` are eve's tool-approval gate, and
  `authorization.required`/`authorization.completed` are connection
  authorization. They are the natural producers of `approval.*` once **M5**
  wires approvals and the harness can actually answer one. They are dropped in
  M2 because the harness cannot.
- `subagent.*` describes a nested agent run. When the harness supports nested
  runs it should record them as a child run with its own `runId`, not as a new
  member of this taxonomy.

### 5. `@internal/trace` owns persistence

A new workspace package, `packages/trace`, depending on `@internal/core` and
nothing else, Node built-ins only. It is **not** an adapter: it is added to
`BOUNDARY_RULES` in `tests/architecture/boundaries.ts` with the same bans
`@internal/core` carries. When M2-T5 adds a Supabase sink, that sink belongs in
`@internal/storage-supabase`, which is already a declared adapter.

It exports:

- `TraceSink` — `write(events: readonly TraceEvent[]): Promise<void>`. The
  harness-owned split beneath `TraceWriter`: a writer owns buffering and
  ordering, a sink owns one storage medium.
- `createBufferedTraceWriter({ sink, maxBufferedEvents })`. Append order is
  write order; concurrent flushes serialize; a sink failure becomes a
  `StorageError` with the cause preserved **and the events stay buffered**, so a
  later flush retries them in the same order and nothing is silently lost;
  events appended during a flush are drained by that same flush. `append`
  **auto-flushes** at `maxBufferedEvents` (default 256) and awaits it, so the
  caller feels the back-pressure rather than the buffer growing behind it.
- `createInMemoryTraceSink()`, `createJsonlFileTraceSink(path)` and
  `createJsonlDirectoryTraceSink(directory)`. JSONL lines are `canonicalJson()`
  (ADR-0029), so a trace file is diffable and hashable; writes append and create
  parent directories. The directory sink files each run as
  `<directory>/<runId>.jsonl`, which exists because a run id is minted inside
  `harness.run()` and a caller cannot name the file before the run starts.

### 6. A flush failure propagates out of `harness.run()`

`createHarness()` awaits `trace.flush()` after the terminal event and does
**not** catch. A `StorageError` leaves `harness.run()` rather than being
reported as a `completed` result.

## Consequences

### Positive

- A run has one total order. Merging harness and adapter events is nothing but
  sorting by `sequence`, and the M2 acceptance criterion "a trace reconstructs
  execution without application logs" becomes checkable.
- A reader can switch exhaustively on `type`, and M2-T5 can put a check
  constraint on the column.
- Spans are free: no span table, no span ids to allocate, no orphan spans to
  clean up, and `latencyMs` is measured rather than recomputed by a reader.
- A storage failure cannot be mistaken for a successful run, and the events it
  failed on are still in memory for a retry.
- `pnpm example:run:mock` now leaves a real ordered trace on disk, months
  before Supabase exists, and the same writer serves the database later.
- The adapter's vocabulary stops leaking: nothing downstream has to know that
  `eve.step.completed` means "a model call finished".

### Negative

- `ExecutionContext.trace` changed type, which is a breaking change for every
  caller. Inside this repository that is four packages and their tests; there
  are no external consumers yet, which is the cheapest moment for it.
- The recorder is per-run mutable state, so a caller that shares one recorder
  across two runs would interleave them. Nothing does, and `createHarness()`
  builds one per run, but the type cannot prevent it.
- Mapping eve's events loses detail that `eve.<type>` kept verbatim. A reader
  who wants the raw stream has eve's own durable session, and `eveEventId` in
  the payload is the join key.
- `agent.failed` for a cancelled turn overstates the outcome at the agent level.
  The payload and the run-level `run.aborted` carry the truth.
- A run whose sink is down now fails at the last step, after the work was done.
  The result is lost to the caller even though the agent succeeded. That is the
  deliberate reading of the acceptance criterion; M2-T7's ledger may soften it
  once a run row exists to record "completed but unpersisted" against.

### Neutral

- `TraceWriter` is unchanged, so anything written against the build plan's
  interface still compiles.
- `maxBufferedEvents` defaulting to 256 is a guess at a good batch size, not a
  measured one. It is one option away from being changed.
- Two JSONL sinks rather than one is a small surface cost for the ergonomics of
  one file per run.

## Alternatives considered

- **Give each source its own key** (the M2 status file's other option: a
  `source` field plus a per-source sequence). Rejected: every reader would then
  have to merge two sequences with no defined interleaving, and timestamps
  cannot do it because adapter events are stamped by eve and harness events by
  the harness clock. A total order is the thing the trace is for.
- **Make the `TraceWriter` assign `sequence`.** Rejected: a writer is shared
  across runs, so it would need a per-run counter keyed by `runId`, which is a
  recorder with a worse name and no place to put `id`, `attempt` or
  `behaviorFingerprint`. It would also change the interface the build plan
  states verbatim.
- **Keep `eve.<type>` events alongside the taxonomy.** Rejected: two
  vocabularies for one run is the problem, not a feature, and a payload-shaped
  reader is exactly what AD-010 says the trace must not require.
- **Emit nothing for `turn.cancelled`.** Rejected: it leaves the agent span
  open, which makes a cancelled run's trace structurally different from every
  other run's.
- **Add `agent.aborted` to the taxonomy.** Rejected for now: `run.aborted` was
  already forced by existing behaviour, and adding a second unplanned member for
  a case the payload already distinguishes is how a closed taxonomy stops being
  closed. M4 or M5 can revisit it with a real second producer.
- **Let `harness.run()` return `completed` and report the flush failure
  separately.** Rejected: it is precisely the "storage failure silently turns
  into a successful run" the acceptance criteria forbid.
- **Drop the events a failed flush could not write.** Rejected: deterministic
  loss is still loss, and retaining them costs one `slice`/`splice` pair.
- **Put the JSONL sink in `@internal/core`.** Rejected: it would put `node:fs`
  and a storage decision in the package whose whole discipline is having
  neither.

## References

- `docs/milestones/build-plan.md` M2-T3, M2-T4, M2 acceptance criteria, AD-010
- `docs/milestones/m2-job-trace-supabase-and-run-ledger.md` "Before starting"
- Related ADRs: ADR-0010, ADR-0026, ADR-0028, ADR-0029, ADR-0030
- Installed `eve` 0.63.0: `dist/src/protocol/message.d.ts`,
  `dist/src/shared/action-types.d.ts`,
  `docs/concepts/sessions-runs-and-streaming.md`
- Related code paths: `packages/core/src/trace.ts`, `context.ts`, `harness.ts`,
  `packages/trace/src/`, `packages/runtime-eve/src/eve-agent-runtime.ts`,
  `eve-events.ts`, `apps/example-agent/src/run.ts`
- Contract: `docs/contracts/trace-event.md`
