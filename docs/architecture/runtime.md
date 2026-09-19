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

`clientContext` is the right home for the data because eve documents it as ephemeral: "available
to every model call in the turn, then disappears before the next turn", and "never persisted to
durable session history". That is exactly the lifetime of a one-shot job.

**Both reach the model. Neither may carry a secret.**

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

One `TraceEvent` per stream event, with `sequence` counting from 0 within the run, `timestamp`
taken from eve's own `meta.at`, and `type` namespaced `eve.<event type>`.

The payload is a **whitelist, never a dump**, for the same reason `serializeError` is one
(ADR-0026). Every event contributes `eventId` (eve's `evt_`-prefixed ULID, which M2 can dedupe on),
plus `turnId` and `stepIndex` where the event carries them.

| Stream event | Trace type | Payload adds |
| --- | --- | --- |
| `step.started` | `eve.step.started` | `modelId` |
| `step.completed` | `eve.step.completed` | `finishReason`, `usage` (`costUsd`, `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, each only when present) |
| `actions.requested` | `eve.actions.requested` | `tools` (names), `actionCount` |
| `action.result` | `eve.action.result` | `status`, `tool`, `errorCode` |
| `input.requested` | `eve.input.requested` | `requestCount` |
| `step.failed`, `turn.failed`, `session.failed` | `eve.<type>` | `code` |
| everything else | `eve.<type>` | identity and coordinates only |

**Never carried:** assistant text, reasoning, tool inputs, tool outputs, the structured result, and
the text of a human-input request. M2-T9 owns redaction; until it exists the adapter carries
nothing that would need it, which is also why payloads stay small.

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
3. **The trace payload is a placeholder.** M2-T3 owns the event taxonomy and the full `TraceEvent`
   schema; nothing may branch on these payloads yet.
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
`createHarness()`, print the `HarnessRunResult` as JSON, stop the server, and exit non-zero unless
the run completed. `pnpm example:run` exits early with a message naming `.env.example` when no
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
