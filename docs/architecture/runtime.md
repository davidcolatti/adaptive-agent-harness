---
status: active
owner: core
last_verified: 2026-09-19
related:
  - docs/contracts/agent-runtime.md
  - docs/contracts/execution-context.md
  - docs/contracts/job.md
  - docs/contracts/errors.md
  - docs/decisions/0003-ai-sdk-is-the-lowest-agent-runtime-contract-eve-is-the-default-runtime-adapter.md
  - docs/decisions/0012-reuse-documented-eve-capabilities-instead-of-cloning-them.md
  - docs/decisions/0025-application-packages-may-author-eve-agents-directly.md
  - docs/decisions/0027-standard-schema-is-the-harness-schema-contract.md
  - docs/decisions/0028-eve-agent-runtime-is-a-url-only-client-that-observes-the-eve-event-stream.md
  - docs/research/vercel/2026-09-19-m1-eve-programmatic-execution.md
implementation:
  - packages/runtime-eve
  - apps/eve-fixture-agent
  - apps/example-agent/src/run.ts
---

# Runtime: how `EveAgentRuntime` runs a job

[`AgentRuntime`](../contracts/agent-runtime.md) is the contract. This page is how the `eve`
implementation of it works, what it enforces, and what it cannot yet enforce. The decisions behind
it are [ADR-0028](../decisions/0028-eve-agent-runtime-is-a-url-only-client-that-observes-the-eve-event-stream.md);
the evidence is
[`../research/vercel/2026-09-19-m1-eve-programmatic-execution.md`](../research/vercel/2026-09-19-m1-eve-programmatic-execution.md).

## The shape of it

```text
caller                packages/runtime-eve            an eve server
  |                           |                            |
  |  run(job, context)        |                            |
  |-------------------------->|                            |
  |                           |  health()                  |
  |                           |--------------------------->|
  |                           |  sessions.create({ message,|
  |                           |    clientContext,          |
  |                           |    outputSchema, signal })  |
  |                           |--------------------------->|
  |                           |<===== event stream ========|
  |                           |   trace / permissions /    |
  |                           |   budget / usage, per event|
  |                           |  cancel()   (on a breach)  |
  |                           |--------------------------->|
  |<-- AgentExecution --------|                            |
```

**The adapter never starts a server.** `eve` 0.63.0 has no in-process run API, so somebody has to,
and a runtime adapter is the wrong place for process lifecycle. A caller supplies a URL, from
`eve dev`, from `eve start` after `eve build`, or from a deployment. For a test or a demonstration,
`startEveDevServer()` behind `@internal/runtime-eve/testing` is the supported way to get one.

## Construction

```ts
import { EveAgentRuntime } from "@internal/runtime-eve";

const runtime = new EveAgentRuntime({
  host: "http://127.0.0.1:2000",
  domains: [vendorTriage],
});
```

| Option | Meaning |
| --- | --- |
| `host` | Base URL of a running eve server. Required unless `client` is given. |
| `auth`, `headers`, `redirect` | Passed through to `eve/client`'s `Client`. `redirect` defaults to `"manual"` whenever `auth` or `headers` is set, which is what eve's own docs ask of a credential-bearing client. |
| `client` | An already-built client instead of `host`. The unit-test seam. |
| `domains` | The domains whose output schemas this runtime may request. |
| `clock` | Where wall-clock time comes from. Defaults to the system clock; `createFakeClock()` fits. |

The constructor throws `TypeError` when neither `host` nor `client` is given, or when both are.
That is a programmer error, not a run that failed, and it is the only thing this class throws for.

**`domains` is temporary.** `AgentRuntime.run(job, context)` hands over a `Job`, and a job names
its contracts as strings (`vendor-triage.output@1.0.0`) because a job is serialized into a trace.
Resolving a reference to a schema is the capability registry's job, and the registry is M1-T9.
Until it lands, the runtime is handed the schemas. A job for an unlisted domain fails before any
turn starts.

## How a job is presented

Harness-owned, because eve documents no context slot for either half of a job.

| Job field | Where it goes |
| --- | --- |
| `job.objective` | the turn's `message`: the instruction the model acts on |
| `job.id`, `job.domain`, `job.jobType`, `job.input` | `clientContext`: the data it acts on |
| `context.fallback`, when the run is an escalation | `clientContext.harness.fallback` (M5-T6) |

`clientContext` is the right home for the data because eve documents it as ephemeral: "available
to every model call in the turn, then disappears before the next turn", and "never persisted to
durable session history". That is exactly the lifetime of a one-shot job.

**Both reach the model. Neither may carry a secret.**

### The fallback envelope (M5-T6)

When a compiled workflow escalates, the router runs this adapter with
`ExecutionContext.fallback` set, and the adapter adds the envelope to the same `clientContext`
object under a `harness.fallback` key. M5-T6 requires the full-agent adapter to receive the
envelope "through its documented runtime boundary", and this is eve's: an object `clientContext`
is JSON-serialized into one user-role context message that every model call of the turn sees and
that is discarded before the next one, which is exactly an escalation's lifetime. **The transport
is eve's; the key name and the shape under it are the harness's**, because eve imposes no schema
on what a `clientContext` object contains. The envelope carries references and flags only — node
ids, `node:<id>` output references, trust bits, artifact ids and the remaining budget — in a
prompt — and it carries each completed node's **validated output** inline, because a model cannot
follow a `node:<id>` reference. Those outputs already passed a domain-authored schema and are the
same values the workflow's own `agent` node was handed, so the turn sees no new class of content;
the envelope's 64 KiB budget, not redaction, is what bounds them. An agent is told what to do with
it by its own instructions; see
`apps/example-agent/agent/instructions.md`. Grounded in
[`../research/vercel/2026-09-20-m5-eve-client-context-for-fallback.md`](../research/vercel/2026-09-20-m5-eve-client-context-for-fallback.md)
and recorded in
[ADR-0044](../decisions/0044-the-router-is-an-agentruntime-and-a-fallback-travels-in-the-execution-context.md).

## Structured output

The domain's `outputSchema` is sent with the turn, and the result is read from the structured
payload eve emits as `result.completed`. The adapter never falls back to the assistant message,
which is `undefined` on a structured turn anyway.

One step is the harness's own. `SendTurnOptions.outputSchema` is typed `StandardJSONSchemaV1 |
JsonObject`, which needs a `~standard.jsonSchema` converter, while
[ADR-0027](../decisions/0027-standard-schema-is-the-harness-schema-contract.md)'s `Schema<T>` is
Standard **Schema** v1 and declares only `~standard.validate`. They are siblings in one
specification family, not the same interface. So the adapter lowers the schema itself, through the
converter the schema publishes, and sends a plain JSON Schema object. `zod@4.6.5` publishes the
converter, so a domain authored the ADR-0027 way works unchanged; a Standard Schema implementation
that only validates fails before the turn starts, with a message saying so.

## The event-to-trace mapping

The adapter maps eve's stream onto the harness's closed trace taxonomy
([`../contracts/trace-event.md`](../contracts/trace-event.md), M2-T3). It does **not** name its own
event types: M1 emitted `eve.<event type>` because the taxonomy did not exist yet, and
[ADR-0031](../decisions/0031-trace-event-taxonomy-recorder-owned-sequencing-and-the-buffered-writer.md)
replaced that. An eve event either *is* a member of the taxonomy or is not a trace event at all.

Ordering is no longer the adapter's either. `context.trace` is the run's `TraceRecorder`, and it
owns `sequence` for the whole run, so the harness's `run.*` events and the adapter's events
interleave in one total order. `state.sequence` is gone.

| Stream event | Trace event | Payload adds |
| --- | --- | --- |
| `turn.started` | `agent.started` | `runtime`, `sessionId` |
| `turn.completed` | `agent.completed` | — (carries the run's accrued `usage` and `latencyMs`) |
| `turn.failed`, `session.failed` | `agent.failed` | `code` |
| `turn.cancelled` | `agent.failed` | `cancelled: true` |
| `step.started` | `model.started` | `modelId` |
| `step.completed` | `model.completed` | `finishReason`; `usage` from the step (`modelCalls`, `costUsd`, `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, each only when present) |
| `step.failed` | `model.failed` | `code` |
| `actions.requested` | one `tool.started` **per action** | `tool`, `callId`, `kind` |
| `action.result` | `tool.completed`, or `tool.failed` when `status` is `failed` or `rejected` | `tool`, `callId`, `status`, `code` |
| `input.requested` | `approval.requested` | `requestCount` |
| `input.resolved` | `approval.resolved` | `outcomes` |
| everything else | **no trace event** | — |

Every payload also carries `eveEventId` (eve's `evt_`-prefixed sortable id, which M2-T5 can dedupe
on), plus `turnId` and `stepIndex` where the event carries them. That is the join key back to eve's
own durable stream for anything this trace deliberately leaves out.

Spans are correlated the way eve's own documentation requires: **tool spans by `callId`**, because
`ActionsRequestedStreamEvent` states that consumers "must correlate action lifecycles by call ID
rather than assume one event contains every call from an assistant step"; **model spans by `turnId`
plus `stepIndex`**. Each event's `timestamp` is its `meta.at`, so the trace reports when eve saw
something rather than when the adapter read it, and `latencyMs` is measured between those.

A `rejected` action result becomes `tool.failed` carrying a `PermissionDeniedError` rather than a
`ToolExecutionError`: eve's `rejected` means a human or a policy denied the call at an approval
gate, so it never ran. A failure event's harness error carries eve's `code` and never its
`message`, which is provider text the harness did not author.

**Dropped, deliberately:** `session.started`, `session.waiting`, `session.completed`,
`message.received`, `message.appended`, `message.completed`, `reasoning.appended`,
`reasoning.completed`, `action.input.appended`, `action.partial`, `result.completed`,
`context.cleared`, `compaction.requested`, `compaction.completed`, `authorization.required`,
`authorization.completed`, `approval.candidate`, `approval.settled` and the four `subagent.*`
events. The deltas and `result.completed` are content; the rest describe eve's own lifecycle rather
than the agent's work. ADR-0031 names the two groups a later milestone will want (eve's approval
gate and connection authorization for M5's approvals, and `subagent.*` as nested runs with their
own `runId`).

The payload is a **whitelist, never a dump**, for the same reason `serializeError` is one
(ADR-0026). **Never carried:** assistant text, reasoning, tool inputs, tool outputs, the structured
result, and the text of a human-input request. M2-T9 owns redaction; the adapter carries nothing
that would need it, which is also why payloads stay small.

## Enforcement points

| What | Where it happens | How |
| --- | --- | --- |
| Permissions | on `actions.requested` | each tool name is looked up in `context.permissions`; the first ungranted one cancels the turn and fails the run with `PermissionDeniedError` |
| Model-call budget | on `step.completed` | `modelCalls > maxModelCalls` cancels and fails with `BudgetExceededError` |
| Tool-call budget | on `action.result` | `toolCalls > maxToolCalls`, likewise |
| Cost budget | on `step.completed` | only when a `costUsd` was actually reported |
| Duration budget | on a timer | a wall-clock limit checked only on an event is no limit at all, because a stalled turn emits nothing |
| Cancellation | `context.signal` | passed to the client calls **and** used to trigger `response.cancel()` |
| Human input | on `input.requested` | M1 has no human in the loop, so the turn is cancelled rather than parked durably |

A tool call needs at least a `read` grant, and a `write` grant satisfies it too: the harness cannot
tell from an eve event whether a tool wrote anything, and `write` is strictly stronger.

Cancellation is propagated twice on purpose. Aborting the HTTP request alone would leave the turn
running server-side; `cancel()` alone would let a hung transport outlive the job.

## Terminal state

Decided on turn boundary events and `isTurnFailureEvent`, **never** on `MessageResult.status`.
That field was observed to be `"waiting"` for a successful turn, a failed turn and a cancelled turn
alike: it reports where the session ended up, not how the turn ended.

| Observed | Result |
| --- | --- |
| `context.signal` fired | `aborted` |
| a harness policy stopped the run | `failed`, with the `PermissionDeniedError`, `BudgetExceededError` or `AgentExecutionError` that caused it |
| the stream itself failed | `failed` with `AgentExecutionError` |
| any `isTurnFailureEvent` | `failed` with `AgentExecutionError` carrying eve's `{ code, message }` in `details` |
| `turn.cancelled` with no harness reason | `failed` with `AgentExecutionError` |
| the stream ended with no boundary | `failed` with `AgentExecutionError` |
| `turn.completed`, no structured payload | `failed` with `ValidationError` |
| `turn.completed`, payload present | `completed` |

`run()` **never throws for an agent failure.** Usage accrued before a failure is reported with it,
because the attempt cost something.

eve publishes no catalogue of failure codes, so the adapter carries the code it was given rather
than switching on it.

## Usage

| Field | Source |
| --- | --- |
| `modelCalls` | count of `step.completed` |
| `toolCalls` | count of `action.result` |
| `durationMs` | the harness clock; eve exposes no turn duration |
| `costUsd` | summed from `step.completed.data.usage.costUsd`, **absent** when nothing reported one |

`costUsd` is absent rather than `0` when no step reported one, because a mock or direct-provider
model genuinely has no cost and `0` would be a claim. Cost appears only when the Vercel AI Gateway
served the call.

**Retried steps are counted.** eve runs a durable step up to four times and records no attempt
identity, so a naive sum over-reports for an interrupted turn and a deduplication would risk
keeping the abandoned attempt. The adapter sums everything and the figure is provider-attempted
usage; over-reporting cost is the safe error.

`runtime` is `{ name: "eve", version: <the installed eve version>, metadata: { sessionId, turnId } }`.
Those ids are opaque strings. No other eve type leaves the package.

## Sessions

One fresh session per run, created with the turn in a single request. A brand-new session starts
with clean history and fresh state, so no teardown is needed and none is done. `session.reset()`
is deliberately not called: it would terminally retire an id a human might want to inspect with
`eve dev <url>`, and it buys nothing.

## Known limitations (M1)

1. **Permission enforcement is detection, not prevention.** eve accepts no caller-supplied tool
   policy, so the adapter can only watch `actions.requested` and stop the turn. By then the call
   was requested and, depending on ordering, may already have run. The example domain's one tool
   is read-only, which is why this is acceptable now and not in general. The upgrade path is
   M2/M5: a channel `AuthFn` minting a short-lived per-run token whose claims carry the job's
   grants, plus a per-tool `approval` policy that denies before execution. Both halves are
   documented eve features.
2. **Budget enforcement is the harness's, and it is reactive.** eve's own limits are authored, per
   session, token and cost only, and prompt a human on breach.
3. **The trace maps onto the taxonomy, but two of its fields are still empty.** M2-T3 settled the
   event schema; `behaviorFingerprint` stays `null` until M2-T8 and `node` until M4.
4. **`domains` stands in for the capability registry** until M1-T9.
5. **`pnpm example:run` against a live Gateway model is unverified.** No credential was available
   when this was written. Everything below the model is verified by the contract suite and by
   `pnpm example:run:mock`.

## Running the example

```bash
pnpm example:run        # apps/example-agent, a real Gateway model, credential required
pnpm example:run:mock   # apps/eve-fixture-agent, eve's mockModel, no credential
```

Both build first, then start an eve dev server, run the vendor-triage domain through
`createHarness()`, print the `HarnessRunResult` as JSON, write the run's ordered trace to
`apps/<agent>/.harness/traces/<runId>.jsonl` and print that path, stop the server, and exit
non-zero unless the run completed. `pnpm example:run` exits early with a message naming `.env.example` when no
`AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN` is set.

`example:run:mock` is the whole harness path with the model scripted: the real domain, the real
adapter, a real eve server, a real durable session. What it cannot show is whether a real model
produces a useful triage.

## Testing

| Layer | File | What it proves |
| --- | --- | --- |
| unit | `packages/runtime-eve/src/eve-agent-runtime.test.ts` | every adapter branch, against an injected client yielding scripted event sequences. No process, no server, no credential. |
| contract | `packages/runtime-eve/src/eve-agent-runtime.contract.test.ts` | the real adapter against a real `eve dev` server: structured output, a tool-call round trip, permission denial, cancellation of a genuinely in-flight turn, and two back-to-back start/stop cycles each serving a turn. |
| unit | `packages/runtime-eve/src/testing/dev-server.test.ts` | that the recorded-URL reader is total: absent, malformed and non-app-root all return `undefined` rather than throwing. |

The contract suite is credential-free because `apps/eve-fixture-agent`'s model is eve's own
`mockModel`. It runs inside `pnpm test:contract`, and therefore inside `pnpm check`, in about four
seconds including boot, or about fourteen with the two extra boots the restart test needs.

### Only one `eve dev` per app root

`eve dev` records its URL in `.eve/dev-server-state.v1.json`, and
`eve/docs/reference/cli.md` states the rule in two halves:

> Local dev records the last ready URL per resolved app root in
> `.eve/dev-server-state.v1.json`. … A stale or malformed record is replaced
> when eve starts a new server. Passing `--host`, `--port`, or a `PORT`
> environment value skips reconnection and reports a healthy recorded server
> instead.

`startEveDevServer()` always passes `--port 0`, so it is on the second branch:
eve never attaches to an existing server for it, and errors instead. Three
consequences shape the helper.

- **A record left behind by a dead server is harmless**, so the harness reads
  that file and never writes or deletes it. Cleaning up another tool's state
  would be reaching past a documented guarantee.
- **A record whose server still answers blocks the start**, and eve reports
  that by exiting 1, which reaches a caller as an opaque `code=1`. The helper
  probes the recorded URL first and fails with a message naming it. It does not
  reuse the server: one started earlier may be serving different code, and a
  test that passes against the wrong agent is worse than one that will not
  start. A caller that genuinely wants the running server passes its URL to
  `EveAgentRuntime` directly, which is what the adapter is for.
- **`stop()` waits for the address to be free**, not just for the process to
  exit. It sends `SIGTERM` so eve shuts down cleanly and removes its own
  record, waits for the child, then polls until the URL stops answering.
  `SIGKILL` is the five-second escalation only, because a killed server leaves
  both the record and the bound port behind.

A parent that dies without calling `stop()` is the one way an orphan still
appears, so the module also kills any surviving child on `process.on("exit")`.
Ctrl-C needs no handler: the shell signals the whole foreground process group,
and the child is in it because the helper never detaches.

**One trap worth knowing.** eve replaces every authored model with its own internal runtime mock
when `NODE_ENV=test` or `EVE_MOCK_AUTHORED_MODELS=1`. Vitest sets `NODE_ENV=test`, so a fixture
agent's scripted responder is silently ignored inside a test run and only inside one; the symptom
is a turn that succeeds with plausible data while every scripted branch is unreachable.
`startEveDevServer()` strips both names from the child environment, along with
`AI_GATEWAY_API_KEY` and `VERCEL_OIDC_TOKEN`. This behaviour is in no eve document; it was found
by reading `eve/dist/src/runtime/agent/mock-model-adapter.js`.

## What this page does not cover

`packages/runtime-ai-sdk` has no adapter yet. When it gains one, the contract suite is what both
implementations should be measured against, and this page grows a second half.
