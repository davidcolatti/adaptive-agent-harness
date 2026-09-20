---
status: active
owner: core
last_verified: 2026-09-19
related:
  - docs/milestones/build-plan.md
  - docs/contracts/execution-context.md
  - docs/contracts/harness.md
  - docs/contracts/errors.md
  - docs/contracts/identifiers.md
  - docs/architecture/runtime.md
  - docs/decisions/0010-observability-trace-is-a-product-surface-captured-from-the-first-run.md
  - docs/decisions/0026-harness-errors-serialize-to-a-whitelisted-trace-safe-shape.md
  - docs/decisions/0030-sortable-uuidv7-entity-identifiers-owned-not-delegated.md
  - docs/decisions/0031-trace-event-taxonomy-recorder-owned-sequencing-and-the-buffered-writer.md
implementation:
  - packages/core
  - packages/trace
  - packages/runtime-eve
---

# Trace event

The append-only structured event stream that reconstructs an execution without
application logs. Defined by M2-T3 (the schema) and M2-T4 (the writer), and
recorded in
[ADR-0031](../decisions/0031-trace-event-taxonomy-recorder-owned-sequencing-and-the-buffered-writer.md).

AD-010 is the standard this contract is held to: **the trace is not debug
logging.** Every behavior-affecting event needed for replay, evaluation,
lineage, cost analysis or model-risk analysis is captured as structured data
from the first working run. A `console.log` is a thing a human reads once; this
is the dataset the learner, the compiler and the evaluator are all built on.

Four pieces, in three packages:

| Piece | Where | What it is |
| --- | --- | --- |
| `TraceEvent` | `packages/core/src/trace.ts` | One event. Fifteen fields, closed `type`. |
| `TraceRecorder` | `packages/core/src/trace.ts` | Per-run minter. Owns `sequence` and identity. |
| `TraceWriter` | `packages/core/src/trace.ts` | The sink an execution appends to. Stated verbatim by the build plan. |
| `TraceSink` + `createBufferedTraceWriter()` | `packages/trace` | Persistence, and the buffered order-preserving writer over it. |

## The taxonomy

`TraceEventType` is a **closed union**, exported at runtime as
`TRACE_EVENT_TYPES` with an `isTraceEventType()` guard, so a reader, a
validator and M2-T5's database constraint share one list.

```text
run.started      run.completed      run.failed      run.aborted
agent.started    agent.completed    agent.failed
model.started    model.completed    model.failed
tool.started     tool.completed     tool.failed
decision.started decision.completed decision.failed
node.started     node.completed     node.failed
artifact.created
approval.requested  approval.resolved
fallback.started    fallback.completed
eval.completed
```

This is the build plan's M2-T3 list, in its order, **plus `run.aborted`**. The
harness already emits it, and a run its caller cancelled is neither a
completion nor a failure: folding it into `run.failed` would report every
cancellation as a defect in the run ledger and in every quality metric built on
it. ADR-0031 records the amendment.

Members with no producer yet are still in the union, because the plan fixes
them and a partial list would have to be widened later: `decision.*` arrives
with M3, `node.*` and `fallback.*` with M4, `artifact.created` with artifacts,
and `eval.completed` with M6. `approval.*` has a producer today only in the
sense that `EveAgentRuntime` maps eve's human-input events onto it.

## The event

```ts
type TraceEvent = {
  readonly id: TraceEventId;
  readonly runId: RunId;
  readonly attempt: number;
  readonly sequence: number;
  readonly timestamp: string;
  readonly type: TraceEventType;
  readonly parentId: TraceEventId | null;
  readonly node: string | null;
  readonly version: 1;
  readonly behaviorFingerprint: string | null;
  readonly payload: JsonObject;
  readonly usage: TraceEventUsage | null;
  readonly latencyMs: number | null;
  readonly error: SerializedHarnessError | null;
};
```

| Field | Meaning | Notes |
| --- | --- | --- |
| `id` | This event's identity | Sortable UUIDv7 ([ADR-0030](../decisions/0030-sortable-uuidv7-entity-identifiers-owned-not-delegated.md)), so it doubles as a global cursor. |
| `runId` | The run it belongs to | Matches `ExecutionContext.runId`. |
| `attempt` | Which attempt produced it, from 1 | A **number**, not an `AttemptId`. See below. |
| `sequence` | Position in the run's total order, from 0 | Strictly increasing. Owned by the recorder. |
| `timestamp` | When it happened | ISO 8601. Harness clock, or the framework's own instant when the adapter has one. |
| `type` | What happened | From the closed taxonomy. |
| `parentId` | The enclosing span | A `*.started` event's `id`. `null` for a root. |
| `node` | The workflow node | **Always `null` until M4.** Typed now so the schema does not change then. |
| `version` | Event schema version | The literal `1`, exported as `TRACE_EVENT_VERSION`. |
| `behaviorFingerprint` | `sha256:` digest of the behavior that produced the run | Filled by M2-T8, the same value on every event of a run. `null` only when the domain declares no behavior source; never faked. See [`behavior-fingerprint.md`](./behavior-fingerprint.md). |
| `payload` | The sanitized body | **Identity-only.** See below. |
| `usage` | What this event's work consumed | `null` when nothing is known. |
| `latencyMs` | How long the work this event closes took | `null` on a `*.started` event. |
| `error` | Why it failed | Only on `*.failed`. ADR-0026's whitelisted, stack-free shape; never a raw `Error`. |

`TraceEvent` is declared as a type alias rather than an interface so that it has
an implicit index signature and is assignable to `JsonObject`. That is what lets
it be canonicalized, written as a JSONL line or stored as JSONB with no
conversion step, exactly as `SerializedHarnessError` already is.

### Spans, without a span type

A span is not a separate entity: **a `*.started` event's `id` is its span id**,
which is why there is no `spanId` field and nothing to leak if a caller forgets
to close one. Three rules:

- a `*.completed` or `*.failed` event points at its own `*.started` event;
- a `model.*` or `tool.*` event points at the enclosing `agent.started`;
- every `run.*` event is a root with `parentId: null`, because a run is already
  identified by `runId`. `agent.started` points at `run.started`, so the run is
  still the top of the tree.

### Usage

```ts
type TraceEventUsage = {
  readonly modelCalls?: number;
  readonly toolCalls?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly costUsd?: number;
};
```

Every field is optional and **absent is not zero**: a mock or direct-provider
model reports no cost, and writing `0` would turn "unknown" into a measurement.
The fields are the union of what `AgentExecutionUsage` already carries and what
eve reports per step; nothing is invented ahead of a producer.

Usage is per event, not cumulative. A `model.completed` carries that call's
tokens and `run.completed` carries the run's totals, so summing a run's events
and reading its terminal event are two routes to the same figure. That is what
makes a stored trace auditable rather than merely informative.

### `attempt` is a number

`ExecutionContext.attempt` is an ordinal and so is this. ADR-0030 defined an
`AttemptId` brand and deliberately gave it no field; **where an attempt becomes
a row with an id of its own is M2-T5's decision** (the run ledger). Putting a
foreign key on this type before the table exists would be a guess. The ordinal
is what "retrying creates a new attempt, not duplicate events" needs today.

### The payload is identity-only

What belongs in `payload`: the shape of the run. Ids, names, counts, statuses,
codes, model ids, tool ids, the framework's own event id for cross-reference.

What never belongs in it: message text, reasoning, tool arguments, tool
results, model output, or anything read out of a job's input.

**M2-T9's redaction is the safety net, not the boundary.** A payload that needs
redacting should not have been written. The one place content could still reach
a trace today is the `details` of a serialized error on a `run.failed` event,
which carries whatever a thrower chose to publish; ADR-0026 says `details` is
opt-in and is explicitly not a redaction boundary. See
[Redaction](#redaction) below and [`redaction.md`](./redaction.md).

## `TraceRecorder`: who owns `sequence`

One recorder per run, created by `createHarness()` and handed to the adapter
through `ExecutionContext.trace`.

```ts
const recorder = createTraceRecorder({ runId, writer, attempt, clock, behaviorFingerprint });

const started = await recorder.record({ type: "run.started", payload: { jobId } });
const agent = await recorder.span({ type: "agent.started", parentId: recorder.rootId });
await agent.end({ type: "agent.completed", usage: { modelCalls: 2 } });
```

`record()` takes a `TraceEventInput`: the event minus the six fields the
recorder stamps (`id`, `runId`, `attempt`, `sequence`, `version`,
`behaviorFingerprint`) and minus `timestamp` unless the caller has a better one.
It returns the event it wrote, so a caller can use its `id` as a `parentId`.

What the recorder guarantees:

- **`sequence` is assigned synchronously**, before anything is awaited, and
  appends are chained, so the writer sees events in sequence order even when
  two callers record concurrently.
- **A writer that rejects does not poison the run.** The next `record()` still
  gets the next sequence number.
- **`rootId`** is the run's `run.started` event, captured automatically. An
  adapter parents its `agent.started` on it without being told what the harness
  emitted.
- **`span()`** returns a handle whose `end()` sets `parentId` and measures
  `latencyMs` from the start event's timestamp to the terminal event's. A
  timestamp that cannot be parsed, or one that runs backwards, yields `null`
  rather than a negative or `NaN` duration.
- **An unknown `type` is rejected** with a `ValidationError`, so the closed
  taxonomy is closed at runtime too.

This is what the M1 defect looked like, and why the recorder exists: the
harness counted `run.*` from 0 and `EveAgentRuntime` counted its own events from
0 within the same run, so the two collections could not be merged into one
order at all.

## `TraceWriter` and `TraceSink`

```ts
interface TraceWriter {
  append(event: TraceEvent): Promise<void>;
  flush(): Promise<void>;
}

interface TraceSink {
  write(events: readonly TraceEvent[]): Promise<void>;
}
```

`TraceWriter` is the build plan's M2-T4 interface, unchanged. `TraceSink` is the
harness-owned split underneath it: a writer owns buffering, ordering and failure
semantics; a sink owns one storage medium and knows nothing about buffering.
That is what lets one buffered writer serve a JSONL file today and M2-T5's
Supabase table next, without either reimplementing the ordering guarantee.

A sink implementation must write the batch in order, resolve only when the
events are durable, reject on failure rather than swallowing, and tolerate being
handed the same events again after a rejection.

### `createBufferedTraceWriter({ sink, maxBufferedEvents })`

The local writer, in `@internal/trace`. Four guarantees:

1. **Append order is write order.** Nothing sorts or regroups.
2. **Concurrent flushes serialize.** A `flush()` issued while one is in flight
   waits for it and then drains what is left; each caller still gets its own
   outcome.
3. **A sink failure is a `StorageError` with the cause preserved, and the
   events stay buffered.** Nothing is dropped, so a later flush retries the same
   events in the same order, and `details.bufferedEvents` says how many are at
   risk. This is what makes M2's "storage failures cannot silently turn into
   successful runs" enforceable.
4. **Events appended during a flush are not stranded.** The drain loop runs
   until the buffer is empty.

`append` **auto-flushes** once the buffer reaches `maxBufferedEvents`
(`DEFAULT_MAX_BUFFERED_EVENTS`, 256) and awaits it, so the caller feels the
back-pressure. An unbounded buffer would hold an entire long run in memory and
lose all of it if the process died, which is the opposite of what a durable
trace is for.

### Sinks

| Sink | What it does |
| --- | --- |
| `createInMemoryTraceSink()` | Keeps every event and every batch. For tests, and for a caller that wants a run's trace in memory and nowhere else. |
| `createJsonlFileTraceSink(path)` | One canonical-JSON line per event, appended, parent directories created. |
| `createJsonlDirectoryTraceSink(directory)` | The same, filed as `<directory>/<runId>.jsonl`. |

Canonical JSON rather than `JSON.stringify`: `canonicalJson()`
([ADR-0029](../decisions/0029-canonical-json-and-sha-256-behavior-fingerprints.md))
sorts object keys and drops `undefined` properties, so the same event always
produces the same line and a trace file is diffable and hashable.

The directory sink exists because a run id is minted *inside* `harness.run()`,
so a caller cannot name the file before the run starts; a sink sees the `runId`
on every event it is handed. `pnpm example:run:mock` uses it, writing
`apps/<agent>/.harness/traces/<runId>.jsonl` and printing the path. Until M2-T5,
that file is the durable trace.

## Redaction

Full detail is in [`redaction.md`](./redaction.md) and
[ADR-0035](../decisions/0035-redaction-is-a-trace-writer-decorator-placed-before-buffering.md);
what a reader of this contract needs is where it sits and what it may change.

`createRedactingTraceWriter({ writer, policy? })` in `@internal/trace` is a
`TraceWriter` decorator, and the chain an application assembles is:

```text
TraceRecorder -> redacting writer -> buffered writer -> TraceSink
```

Redaction is **above the buffer**, so an unredacted event is never held in
memory, never retried from the buffer after a sink rejection, and never written
by a sink added later that forgot to redact. It is **below the recorder**,
because the recorder's event is the truth about what happened and this is the
projection of it that is safe to store. `redactEvents(events, policy?)` lets a
sink re-apply the same rules defensively.

Four mechanisms: field-path redaction over a `**`/`*` glob of the JSON tree,
secret-pattern redaction that replaces only the matched span of a string,
headers redaction under any `headers` object, and per-tool sanitizer hooks keyed
by `payload.tool`. A removed value becomes `[REDACTED:<rule-name>]`, which names
the rule so a reader knows something was there and why.

What it may change: `payload`, and an error's `message`, `details`, `stack` and
`cause` chain. What it never touches: `id`, `runId`, `attempt`, `sequence`,
`timestamp`, `type`, `parentId`, `node`, `version`, `behaviorFingerprint`,
`usage`, `latencyMs`, and an error's `name` and `code`. A redacted event is a new
frozen object; the input is neither mutated nor frozen.

Because payloads are identity-only, a healthy run's trace contains no redaction
token at all. A verified `pnpm example:run:mock` writes the same six events with
the same payload keys as before redaction was wired, and no `[REDACTED` anywhere
in the file.

## How a run reads

The mock example, end to end:

```text
sequence 0  run.started      parent null
sequence 1  agent.started    parent = run.started      (eve turn.started)
sequence 2  model.started    parent = agent.started    (eve step.started)
sequence 3  model.completed  parent = model.started    usage, latencyMs
sequence 4  agent.completed  parent = agent.started    run totals, latencyMs
sequence 5  run.completed    parent null               run totals, latencyMs
```

The `agent.*`, `model.*` and `tool.*` events come from `EveAgentRuntime`, which
maps eve's stream events onto this taxonomy rather than emitting adapter-named
events. The mapping table, and the list of eve events that are deliberately not
trace events, are in [`../architecture/runtime.md`](../architecture/runtime.md).

## Open for later milestones

- **M2-T5** persists events (the `trace_events` table) and decides when an
  attempt becomes a row with an `AttemptId`. It adds a Supabase `TraceSink`; the
  writer does not change.
- **M2-T8** is done: `createHarness()` resolves the domain's behavior source
  before `run.started` and passes the composite to the recorder, so every event
  of a run carries one `sha256:` value, and `run.started`'s payload carries the
  per-component digests. A domain that declares no behavior source still records
  `null`. See [`behavior-fingerprint.md`](./behavior-fingerprint.md).
- **M2-T9** is done: redaction runs in a `TraceWriter` decorator above the
  buffer, covers a serialized error's `details`, and is documented in
  [`redaction.md`](./redaction.md).
- **M2-T10**, the run inspector, is the first reader of a stored trace; today a
  JSONL file and `jq` are the inspector.
- **M3** produces `decision.*`, **M4** produces `node.*`, `fallback.*` and the
  first non-`null` `node`, and **M6** produces `eval.completed`.
