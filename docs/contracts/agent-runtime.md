---
status: active
owner: core
last_verified: 2026-09-19
related:
  - docs/architecture/runtime.md
  - docs/milestones/build-plan.md
  - docs/contracts/job.md
  - docs/contracts/execution-context.md
  - docs/contracts/errors.md
  - docs/decisions/0003-ai-sdk-is-the-lowest-agent-runtime-contract-eve-is-the-default-runtime-adapter.md
implementation:
  - packages/core
  - packages/testing
  - packages/runtime-eve
---

# Agent runtime

`AgentRuntime` is the whole of what the harness requires of an agent
implementation. It is defined in `packages/core/src/agent-runtime.ts` and was
created by M1-T5.

```ts
interface AgentRuntime {
  run<TInput, TOutput>(
    job: Job<TInput, TOutput>,
    context: ExecutionContext,
  ): Promise<AgentExecution<TOutput>>;
}
```

Build plan section 5 states this signature. One method, two arguments, one
result: a [`Job`](job.md) that says what to do, an
[`ExecutionContext`](execution-context.md) that says everything about this
attempt, and an execution record that says what happened.

Because the interface is this small, a real adapter is replaceable by a fake in
a unit test without either of them knowing. That is Milestone 1's acceptance
criterion "a fake `AgentRuntime` can replace `EveAgentRuntime` in a unit test",
and `createFakeAgentRuntime()` in `@internal/testing` is what meets it.

## Nothing from `eve` or the AI SDK appears here

No messages, no steps, no sessions, no tool-call transcript, no model handle.
Those belong to the adapter. They reach the outside world as trace events (M2)
or through `metadata`, which is exactly the boundary
[ADR-0003](../decisions/0003-ai-sdk-is-the-lowest-agent-runtime-contract-eve-is-the-default-runtime-adapter.md)
draws: the AI SDK is the lowest agent-runtime contract, and `eve` specifics stay
behind the adapter.

## Implementations

| Implementation | Package | Notes |
| --- | --- | --- |
| `EveAgentRuntime` | [`packages/runtime-eve`](../../packages/runtime-eve) | The `eve` adapter (M1-T6). How it works, what it enforces, and what it cannot yet enforce: [`docs/architecture/runtime.md`](../architecture/runtime.md), decided in [ADR-0028](../decisions/0028-eve-agent-runtime-is-a-url-only-client-that-observes-the-eve-event-stream.md). |
| `createFakeAgentRuntime()` | [`packages/testing`](../../packages/testing) | The scripted double, below. |

`EveAgentRuntime` presents a job as a turn message (`job.objective`) plus ephemeral
`clientContext` (`{ jobId, domain, jobType, input }`), requests the domain's `outputSchema` per
turn, and returns what eve emits as the turn's structured result. A domain author should read
`docs/architecture/runtime.md` to know where their input lands and what the adapter enforces.

`packages/runtime-ai-sdk` has no adapter yet. The contract suite the build plan requires for every
`AgentRuntime` implementation is `packages/runtime-eve/src/eve-agent-runtime.contract.test.ts`;
when a second implementation exists, that suite is what both should be measured against.

## `AgentExecution`

A discriminated union on `status`, so "completed with no output" is not
expressible:

```ts
type AgentExecution<TOutput = unknown> =
  | { status: "completed"; output: TOutput; /* base */ }
  | { status: "failed"; error: SerializedHarnessError; /* base */ }
  | { status: "aborted"; /* base */ };
```

Every variant carries the same base:

```ts
readonly usage: AgentExecutionUsage;
readonly runtime: RuntimeInfo;
readonly metadata?: JsonObject;
```

No type guard is exported. `execution.status === "completed"` narrows natively,
and a guard that adds nothing is a name to maintain.

### `completed`

`output` is what the runtime **claims** the agent produced. It is typed
`TOutput`, but a runtime asserts a type, it does not prove one.
`createHarness()` (M1-T4) re-validates the value against the domain's
`outputSchema` before any caller sees it. That re-validation is what makes
Milestone 1's "one intentionally invalid output fails closed" a property of the
harness rather than of a runtime's good behaviour.

### `failed`

`error` is a [`SerializedHarnessError`](errors.md), already in its trace-safe
form. A failure is **returned, not thrown**, because a failed run is a result
with usage attached: the attempt cost something, and that has to be reported
alongside the reason. An adapter normalizes whatever the framework threw into an
`AgentExecutionError` first, keeping the original in `cause`, so no `eve` or AI
SDK error type crosses this boundary.

Throwing is reserved for a defect in the adapter itself.

### `aborted`

`context.signal` fired. The run stopped; the usage it accrued before stopping is
still reported.

### `AgentExecutionUsage`

```ts
interface AgentExecutionUsage {
  readonly modelCalls: number;
  readonly toolCalls: number;
  readonly durationMs: number;
  readonly costUsd?: number;
}
```

These are the four dimensions `Budget` limits, so a runtime reports usage in the
same terms the budget was written in. `costUsd` is optional because a local or
faked runtime genuinely has none, and reporting `0` would be a claim rather than
an absence.

## What an implementation must do

Two obligations the signature cannot express:

1. **Propagate `context.signal`.** Pass it to the work started, and resolve with
   `status: "aborted"` when it fires, rather than hanging or rejecting.
2. **Do not throw for an agent failure.** A run that failed resolves with
   `status: "failed"`.

## `createFakeAgentRuntime`

In `@internal/testing` (`packages/testing/src/fake-agent-runtime.ts`), which
depends on `@internal/core` and on nothing else. It makes no model call, opens
no socket and reads no environment variable.

```ts
const runtime = createFakeAgentRuntime({
  result: {
    status: "completed",
    output: { category: "bookkeeping" },
    usage: { modelCalls: 1, toolCalls: 1, durationMs: 3 },
    runtime: { name: "fake", version: "0.0.0", metadata: {} },
  },
});
```

| Option | Meaning |
| --- | --- |
| `result` | Resolve with the same execution every time. |
| `handler` | Compute the execution from the job and context. Mutually exclusive with `result`. |
| `delayMs` | How long the run pretends to take before the handler is consulted. Defaults to `0`. |
| `runtime` | What the fake reports about itself. Defaults to `{ name: "fake", version: "0.0.0", metadata: {} }`. |

It exposes `calls`, every `run` in order, as `{ job, context }`.

Cancellation is honoured the way the contract requires of a real adapter. An
already-aborted signal resolves `aborted` **without consulting the handler at
all**; a signal that fires during `delayMs` does the same. The call is recorded
either way, so a test can assert the runtime was reached before it was
cancelled. `delayMs` uses a real timer rather than `createFakeClock`, because a
fake clock schedules nothing and the run would never resume; the timer is
cleared and the listener removed on whichever branch wins.

The fake contains the one type assertion in either package: a scripted result is
written by a test that knows what output type it stands in for, and the generic
`run` signature cannot know. That dishonesty is contained to one function and is
itself an argument for the harness re-validating output.

## Open for later milestones

- **M1-T4** calls it, and owns validation on both sides of the call.
- The **contract test suite** the build plan requires for every `AgentRuntime`
  implementation (`*.contract.test.ts`, build plan section 8) exists as of
  M1-T6, but covers one implementation. Generalizing it to run against every
  implementation belongs with the second one.
- `FallbackContext` (build plan section 5) is not part of this interface yet. A
  fallback invokes the full-agent runtime with the original job **plus** an
  envelope, and how that envelope reaches an adapter is M4's question.
