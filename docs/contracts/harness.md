---
status: active
owner: core
last_verified: 2026-09-19
related:
  - docs/milestones/build-plan.md
  - docs/contracts/domain-definition.md
  - docs/contracts/agent-runtime.md
  - docs/contracts/execution-context.md
  - docs/contracts/errors.md
  - docs/contracts/job.md
implementation:
  - packages/core
  - packages/testing
---

# Harness

`createHarness()` is the public entry point. It is defined in
`packages/core/src/harness.ts` and was created by M1-T4.

```ts
const harness = createHarness({ agentRuntime });

const result = await harness.run({ domain: vendorTriage, input });

if (result.status === "completed") {
  console.log(result.output.recommendation.decision);
}
```

Build plan section 5 states the target API. The harness is the **one choke
point** where a run is validated on both sides: input against the domain's
`inputSchema` before anything executes, and the runtime's claimed output
against the domain's `outputSchema` before anything is called a success. Two of
Milestone 1's acceptance criteria are properties of this file rather than of
any domain's or adapter's good behaviour.

It holds no state between runs. It is a closure over an agent runtime, a trace
writer and a clock, so two concurrent runs cannot interfere and nothing has to
be reset.

## `createHarness(options)`

| Option | Meaning |
| --- | --- |
| `agentRuntime` | Required. The [`AgentRuntime`](agent-runtime.md) every run goes through. |
| `trace` | Where run events go. Defaults to `createNoopTraceWriter()`. |
| `clock` | The time source for trace timestamps. Defaults to the system clock. |

`createHarness` throws a `ValidationError` immediately if `agentRuntime` does
not implement `run`, rather than failing on the first run.

### `storage` is deliberately absent

The build plan's target API writes `createHarness({ agentRuntime, storage })`.
**M1 omits the option.** M2 is the milestone that defines the `Storage`
contract, the run ledger, trace persistence and the Supabase adapter behind it;
declaring a placeholder type now would publish a guess as a contract and force
M2 to break it. Adding an optional option later is not a breaking change, and
until then a run leaves its record through `trace`.

### `Clock`

```ts
interface Clock {
  now(): Date;
}
```

The minimal interface the harness needs, declared in core so the package keeps
zero dependencies and never imports the testing package. It returns a `Date`
rather than a number so that `createFakeClock()` from `@internal/testing`
satisfies it structurally with no adapter, the same way a `zod` schema
satisfies `Schema<T>`.

## `harness.run(input)`

| Field | Meaning |
| --- | --- |
| `domain` | Required. The [`DomainDefinition`](domain-definition.md) to run. |
| `input` | Required. Validated against `domain.inputSchema` before anything else happens. |
| `signal` | Cancellation for this run. |
| `budget` | Merged **shallowly** over the job's own budget. |
| `permissions` | **Replaces** the job's list. A caller states the whole list or none. |
| `metadata` | Merged per key over the job's own metadata. |

The three override fields exist because a domain decides the defaults and a
caller tightens or annotates them for one run. The harness does **not** try to
prove that an override is a narrowing: it has no basis for comparing an absent
limit (unlimited) with a present one, and a rule it cannot enforce would be
worse than none. Enforcing a budget at all is M2's work; today a budget is
metadata a runtime reads.

### What it does, in order

1. **Validate `input`** with `validateWith(domain.inputSchema, …)`. This
   **throws** `ValidationError` rather than returning a failed result: an input
   the domain's own schema rejects is a caller bug found before a run exists,
   so there is no run to report a failure against and nothing has been spent.
   The runtime is never reached.
2. **Build the job** with `domain.createJob(validInput)` and apply the
   overrides.
3. **Identify the run.** `runId` is `newRunId()`, a sortable RFC 9562 UUIDv7
   (M2-T1, [ADR-0030](../decisions/0030-sortable-uuidv7-entity-identifiers-owned-not-delegated.md)),
   so runs sort in start order and a run id works as a ledger cursor. `attempt`
   is `1`: there are no retries yet, and a counter that never moves is honest
   about that. See [identifiers.md](identifiers.md).
4. **Build the [`ExecutionContext`](execution-context.md)** from the job, the
   trace writer and the signal. It deliberately does not name a runtime; see
   "Which runtime the context reports" below.
5. **Emit `run.started`**, then run, then emit exactly one terminal event and
   `flush()`.
6. **Call `agentRuntime.run(job, context)`** inside a `try`/`catch`.
7. **Validate the output** when the execution completed.

### Cancellation

A signal that is **already aborted** short-circuits: the result is `aborted`
and the runtime is not called at all. Handing work to an adapter that the
contract then obliges it to abandon is pointless, and it would make "the
runtime saw this run" false in the trace while true in the adapter's own
records. Input validation is awaited before this check, so a signal that fires
during validation also takes this path.

A signal that fires **during** the run is the adapter's to honour. It reports
`aborted` itself, and the harness passes that through with the usage the
attempt accrued before stopping.

### A runtime that throws

An `AgentRuntime` is contractually required to *return* a failure rather than
throw. A defect in an adapter must not become a defect in the harness, so a
thrown value is contained: the result is `failed`, carrying an
`AgentExecutionError` with the thrown value in `cause`, zero model and tool
calls, and a `durationMs` measured from the harness's own clock.

### Output validation, and failing closed

A runtime **asserts** its output type; it does not prove one. The harness
re-validates against `domain.outputSchema`, and an output that fails becomes a
`failed` result carrying the `ValidationError`. That is Milestone 1's "one
intentionally invalid output fails closed", and it holds no matter which
adapter ran.

The offending value is not returned, and it is not reachable: `failed` has **no
`output` field at all**. Making it unstatable is stronger than documenting that
it must not be read.

## `HarnessRunResult`

A discriminated union on `status`:

```ts
type HarnessRunResult<TOutput = unknown> =
  | { status: "completed"; output: TOutput; /* base */ }
  | { status: "failed"; error: SerializedHarnessError; /* base */ }
  | { status: "aborted"; /* base */ };
```

Every variant carries the same base:

```ts
readonly runId: RunId;
readonly jobId: JobId;
readonly domain: DomainRef;
readonly attempt: number;
readonly usage: AgentExecutionUsage;
readonly runtime: RuntimeInfo;
```

`usage` and `runtime` are on every variant because a failed or cancelled
attempt still cost something, and what it cost has to be reportable next to why
it stopped. For the two outcomes the harness produces without reaching an
adapter (a pre-aborted signal, and a runtime that threw) `usage` is zero and
`runtime` is `HARNESS_RUNTIME_INFO`.

`harness.run()` **does not throw for a failed run**, for the same reason
`AgentRuntime.run()` does not. The one thing it throws for is a caller bug: an
input the domain's schema rejects.

## Which runtime the context reports

`createExecutionContext` requires a `RuntimeInfo`, and the harness does not have
one: it builds the context *before* it calls an adapter, so at construction time
it does not know which adapter will run the job or what version that adapter is.

M1-T4 resolved this by making `runtime` **optional** on
`CreateExecutionContextInput`, defaulting to the exported constant
`HARNESS_RUNTIME_INFO` (`{ name: "harness", version: "0.0.0", metadata: {} }`).
That is the honest answer rather than a placeholder: at that moment the harness
*is* what is executing. The adapter identifies itself where it actually can, in
`AgentExecution.runtime`, which is the value that reaches a caller and a trace.

`version` is a module constant rather than a value read from
`packages/core/package.json` at runtime, because reading a package manifest
from a compiled `dist/` at an unknown path is brittle and would make the
contract depend on file layout. Nothing branches on it.

An adapter that builds its own context, for a nested or delegated run, supplies
its own identity.

## Trace events

The harness emits exactly two events per run: `run.started`, then one of
`run.completed`, `run.failed` or `run.aborted`. `sequence` starts at `0`,
timestamps are ISO 8601 strings from the configured clock, and `flush()` is
called once before the result is returned.

**These four type strings are M1 placeholders.** M2-T3 owns the event taxonomy
and the full `TraceEvent` schema: event ID, parent span, node reference, event
version, behavior fingerprint, usage, latency and error metadata. Nothing may
branch on the payload shape until M2-T3 settles it.

`createRecordingTraceWriter()` in `@internal/testing` is what a test asserts
against; it records events and counts `flush` calls, so "the harness flushed the
trace before returning" is checkable rather than taken on trust.
`apps/example-agent/src/domain/harness.test.ts` uses it.

`packages/core/src/harness.test.ts` deliberately does **not**. `@internal/testing`
depends on `@internal/core`, so a dependency in the other direction, even a
dev-only one, makes the workspace graph cyclic; core's own tests declare a local
scripted runtime, trace writer and clock inline instead. Do not add
`@internal/testing` to this package's `devDependencies` to tidy that up.

## Open for later milestones

- **M1-T6** supplies `EveAgentRuntime` as the `agentRuntime`, and
  `apps/example-agent/src/run.ts` plus `pnpm example:run` call this API.
- **M2** adds the `storage` option, the real trace taxonomy and the sortable ID
  scheme, and makes budgets enforced rather than declarative.
- **Retries** do not exist. `attempt` is always `1`; retry policy has no owner
  yet.
- **The execution router** (build plan section 2, "workflow match / no match")
  is not here. M4 introduces it, and this file is what the "no match" branch
  becomes.
