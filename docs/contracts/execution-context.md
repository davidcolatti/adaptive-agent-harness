---
status: active
owner: core
last_verified: 2026-09-19
related:
  - docs/milestones/build-plan.md
  - docs/contracts/errors.md
  - docs/architecture/system-map.md
  - docs/decisions/0003-ai-sdk-is-the-lowest-agent-runtime-contract-eve-is-the-default-runtime-adapter.md
  - docs/decisions/0010-observability-trace-is-a-product-surface-captured-from-the-first-run.md
implementation:
  - packages/core
---

# Execution context

`ExecutionContext` is everything one attempt at a job needs that is not the job
itself. It is defined in `packages/core/src/context.ts` and was created by
M1-T7.

The split from `Job` is the point of the type. A `Job` is immutable and says
*what* to do: its domain, objective, input, contracts, budget and permissions.
An `ExecutionContext` describes *this particular attempt* at doing it, so it
carries the attempt number, the writer trace events go to, and the signal that
cancels the work. A retry reuses the same job and receives a new context.

Every field is readonly. Nothing inside an execution may reassign its own
budget or widen its own permissions part-way through a run.

## Shape

```ts
interface ExecutionContext {
  readonly runId: string;
  readonly jobId: string;
  readonly domain: DomainRef;
  readonly attempt: number;
  readonly budget: Budget;
  readonly permissions: readonly ToolGrant[];
  readonly trace: TraceWriter;
  readonly signal: AbortSignal;
  readonly runtime: RuntimeInfo;
}
```

| Field | Meaning |
| --- | --- |
| `runId` | The run this attempt belongs to. The same value appears on every `TraceEvent` the attempt writes. |
| `jobId` | The job being executed. |
| `domain` | The domain the job belongs to, as `{ id, version }`. |
| `attempt` | Which attempt this is, counting from **1**. |
| `budget` | The limits this attempt must stay inside. |
| `permissions` | The tools this attempt may use. An empty list grants nothing. |
| `trace` | Where trace events go. |
| `signal` | Cancellation. An adapter must propagate it to the work it starts. |
| `runtime` | Which runtime adapter is executing, and its own metadata. |

## Supporting types

### `DomainRef`

```ts
interface DomainRef {
  readonly id: string;
  readonly version: string;
}
```

The build plan uses this exact pair for `Job.domain` and for `CapabilityRef`
(section 5). Core defines it once, because the shape and its meaning are
identical in both places. M1-T9 may alias it for capabilities rather than
redeclare it.

### `Budget`

```ts
interface Budget {
  readonly maxCostUsd?: number;
  readonly maxDurationMs?: number;
  readonly maxModelCalls?: number;
  readonly maxToolCalls?: number;
}
```

Exactly `Job.budget` from build plan section 5, made readonly.
`FallbackContext.remainingBudget` uses the same type, which is why it has to
be. **An absent dimension is unlimited, not zero.** A budget the caller never
set is not a budget of nothing, and treating it as zero would make every
unbudgeted job fail on its first model call.

`BudgetDimension` in the error taxonomy is `keyof Budget`, so the two cannot
drift apart: adding a dimension here immediately makes it expressible in a
`BudgetExceededError`.

### `ToolGrant`

```ts
type ToolGrantMode = "read" | "write";

interface ToolGrant {
  readonly toolId: string;
  readonly mode: ToolGrantMode;
  readonly scope?: string;
}
```

**This is an M1 shape and a harness-owned one.** The build plan names
`ToolGrant` in `Job.permissions` but never defines it, so under the
no-assumption stop condition (AGENTS.md) core defines the smallest shape that
answers the only question M1 asks of it: *may this job call this tool this
way?* M2 (trace and approvals) and M5 (permission enforcement) are expected to
extend it with expiry, approval requirements and per-resource constraints.
Treat it as the current shape, not the final one.

Two rules it already encodes:

- `write` means the tool can change something outside the harness, which is the
  distinction north-star invariant 7 cares about. `read` is strictly weaker: a
  `read` grant never satisfies a `write` request.
- `scope` narrows what the grant covers and is interpreted by the tool itself:
  a repository name, a directory, a table. An **absent** scope means the grant
  is not narrowed, not that it covers nothing.

### `RuntimeInfo`

```ts
interface RuntimeInfo {
  readonly name: string;
  readonly version: string;
  readonly metadata: JsonObject;
}
```

`name` and `version` identify the runtime adapter, for example `eve` and
`0.63.0`, so a trace can state what produced it. `metadata` is deliberately
opaque: it is how an adapter publishes its own detail without those details
becoming core contract fields. That is the mechanism ADR-0003 requires for
keeping `eve` session specifics out of the core contracts.

#### `HARNESS_RUNTIME_INFO`

```ts
const HARNESS_RUNTIME_INFO: RuntimeInfo = { name: "harness", version: "0.0.0", metadata: {} };
```

**M1-T4 made `runtime` optional on `CreateExecutionContextInput`**, defaulting
to this constant. The reason is that `createHarness()` builds the context
*before* it calls an adapter, so at construction time it does not know which
adapter will run the job or what version that adapter is. Naming one would be a
guess; naming the harness is the honest answer, because at that moment the
harness is what is executing. The adapter identifies itself where it actually
can, in `AgentExecution.runtime`, which is the value that reaches a caller and
a trace.

`version` is a module constant rather than a value read from
`packages/core/package.json` at runtime: reading a package manifest from a
compiled `dist/` at an unknown path is brittle and would make the contract
depend on file layout. Nothing branches on it.

An adapter that builds its own context, for a nested or delegated run, supplies
its own identity and this default does not apply.

### `JsonValue` and `JsonObject`

```ts
type JsonPrimitive = string | number | boolean | null;
type JsonArray = readonly JsonValue[];
interface JsonObject { readonly [key: string]: JsonValue | undefined }
type JsonValue = JsonPrimitive | JsonArray | JsonObject;
```

The build plan types `Job.metadata` as `Record<string, JsonValue>` without
defining `JsonValue`, so core owns it. It is recursive and contains no `any`,
which matters because `packages/core` is the package where `any` is banned
outright. Anything crossing a persistence, trace or manifest boundary is typed
with these, so a value that typechecks is a value `JSON.stringify` can
round-trip.

The index signature admits `undefined` so that a type with optional properties
is assignable to `JsonObject`. That is faithful to `JSON.stringify`, which
omits an `undefined`-valued property rather than emitting it. Reading a key
yields `JsonValue | undefined` in any case, because the repository compiles
with `noUncheckedIndexedAccess`.

## `TraceWriter` and `TraceEvent`

```ts
interface TraceWriter {
  append(event: TraceEvent): Promise<void>;
  flush(): Promise<void>;
}
```

`TraceWriter` is stated verbatim by the build plan in **M2-T4**. It is declared
in core during M1 only because `ExecutionContext` has to hold one. The
buffered, order-preserving local implementation is M2-T4's work and belongs in
`packages/trace`.

`TraceEvent` is the deliberately minimal M1 placeholder:

```ts
interface TraceEvent {
  readonly runId: string;
  readonly sequence: number;
  readonly timestamp: string;  // ISO 8601
  readonly type: string;
  readonly payload: JsonObject;
}
```

**M2-T3 owns the full schema and will replace this shape.** The build plan
requires every event to additionally carry an event ID, a parent span, a node
reference, an event version, a behavior fingerprint, usage, latency and error
metadata, and to draw `type` from a closed taxonomy (`run.started`,
`agent.completed`, `tool.failed`, and so on). None of that is defined here,
because M1 has no execution to fingerprint and inventing the fields now would
make a guess look like a contract. The five fields above are the subset the
build plan already fixes and M2 will keep.

`createNoopTraceWriter()` returns a writer that discards every event. It exists
so a test, or a caller that genuinely has nowhere to write yet, can build a
context without a trace package. It is not a test double: it records nothing,
so it cannot be asserted against. The recording counterpart is
`createRecordingTraceWriter()` in `@internal/testing`, added by M1-T4 when the
harness's own tests needed to assert on emitted events.

## `createExecutionContext`

```ts
function createExecutionContext(input: CreateExecutionContextInput): ExecutionContext;
```

One constructor, so defaults are applied in one place rather than at every call
site. Required: `runId`, `jobId` and `domain`. Everything else defaults, and
every default is the conservative reading:

| Field | Default | Why |
| --- | --- | --- |
| `attempt` | `1` | Attempts are 1-based. |
| `budget` | `{}` | No budget means unlimited, not zero. |
| `permissions` | `[]` | Permission is explicit, so the default is denial. |
| `trace` | `createNoopTraceWriter()` | Nowhere to write yet is not a reason to fail. |
| `signal` | a signal that never aborts | Not a signal that is already aborted. |
| `runtime` | `HARNESS_RUNTIME_INFO` | The caller may not know the adapter yet; see above. |
| `runtime.metadata` | `{}` | An adapter that publishes nothing is not an error. |

The default signal comes from an `AbortController` whose reference is
discarded, so nothing can ever abort it. That keeps `signal` non-optional and
means no caller has to null-check it.

The one thing the factory validates is `attempt`: it must be an integer of at
least 1, and anything else throws a `ValidationError` naming the field. An
off-by-one here would silently mislabel every retry in the trace, so it fails
at construction instead of in the evidence.

## Open for later milestones

- `Job` itself is not defined yet. M1-T3 (`defineDomain()`) and M2-T2 own it;
  this contract deliberately references `jobId` rather than embedding a job.
- `ToolGrant` will need expiry and approval semantics once approvals exist
  (M2), and an enforcement point once tools actually run (M5).
- `TraceEvent` is replaced wholesale by M2-T3.
- Identifier format is not fixed here. `runId` and `jobId` are opaque strings
  in M1; M2-T1 chooses the sortable scheme.
