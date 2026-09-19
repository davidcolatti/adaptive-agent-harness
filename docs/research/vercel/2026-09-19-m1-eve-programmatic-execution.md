---
status: active
owner: core
last_verified: 2026-09-19
related:
  - docs/development/source-of-truth-protocol.md
  - docs/research/vercel/2026-09-19-m1-eve-ai-sdk-install-survey.md
  - docs/research/vercel/2026-09-19-m1-eve-project-scaffold.md
  - docs/contracts/execution-context.md
  - docs/contracts/errors.md
  - docs/decisions/0003-ai-sdk-is-the-lowest-agent-runtime-contract-eve-is-the-default-runtime-adapter.md
  - docs/decisions/0012-reuse-documented-eve-capabilities-instead-of-cloning-them.md
  - docs/decisions/0025-application-packages-may-author-eve-agents-directly.md
  - docs/milestones/m1-local-agent-and-public-harness-boundary.md
implementation:
  - packages/runtime-eve
---

# M1-T6: driving an `eve` agent from TypeScript

The research checkpoint for `EveAgentRuntime`. It answers the one question M1-T2 left open — "how
does a TypeScript caller start a run, feed it input, and await a result?" — from the installed
`eve` 0.63.0 and `ai` 7.0.107 only. No source code was written for this note.

It does not repeat
[`2026-09-19-m1-eve-ai-sdk-install-survey.md`](2026-09-19-m1-eve-ai-sdk-install-survey.md)
(versions, peer dependencies, export maps, CLI inventory) or
[`2026-09-19-m1-eve-project-scaffold.md`](2026-09-19-m1-eve-project-scaffold.md) (the authored
filesystem layout, path-derived identity, the absent read-only tool flag). Read those first.

Resolve the installed packages before re-running anything here; pnpm isolates them, so
`node_modules/eve` is not a directory:

```sh
EVE=$(dirname "$(node -e "console.log(require.resolve('eve/package.json', { paths: ['apps/example-agent'] }))")")
AI=$(dirname "$(node -e "console.log(require.resolve('ai/package.json', { paths: ['apps/example-agent'] }))")")
```

On 2026-09-19 those resolved to
`node_modules/.pnpm/eve@0.63.0_ai@7.0.107_zod@4.6.5_/node_modules/eve` and
`node_modules/.pnpm/ai@7.0.107_zod@4.6.5/node_modules/ai`. Every `$EVE/...` and `$AI/...` path
below is relative to those directories.

---

## 1. There is no in-process run API. The programmatic surface is HTTP

**Answer: no.** Nothing in `eve` 0.63.0 lets a TypeScript caller load an authored agent and run a
turn inside the same process. The documented programmatic surface is `eve/client`, a typed HTTP
client that talks to a **running eve server**.

### What the root export actually contains

`$EVE/dist/src/index.d.ts` is one line, `export * from "#public/index.js"`, and
`$EVE/dist/src/public/index.d.ts` exports exactly six runtime values and their types:

| Export | Kind |
| --- | --- |
| `defineAgent` | agent-config authoring helper |
| `defineDynamic` | dynamic-resolver authoring helper |
| `defineWorkspaceAgent` | workspace-peer authoring helper |
| `defineRemoteAgent` | remote-subagent authoring helper |
| `AgentDefinition` and friends | types only |
| `DynamicResolveContext`, `DynamicSentinel` | types only |

There is no `run`, `invoke`, `createRuntime`, `createServer`, or `handler`. `$EVE/package.json`
`exports` (78 subpaths, listed in the M1-T1 survey) contains no entry that returns a fetch handler
or an agent-execution function either. `eve/local-dev` sounds like a candidate and is not one:
`$EVE/dist/src/public/local-dev.d.ts` exports only `getLocalDevCapability` and
`LocalDevCapability`, which `$EVE/dist/src/runtime/local-dev-capability.d.ts` documents as
"Capabilities available to authored code in an execution initiated by a same-machine request to
`eve dev`" — an authored-tree mutation capability for tools running inside a dev server, not a way
to start one.

### What the docs say the programmatic surface is

`$EVE/docs/guides/client/overview.mdx` opens: "The `eve/client` entrypoint is the typed client for
eve's default HTTP API. Use it from scripts, server-to-server integrations, **tests, evals**,
backend jobs, or custom UIs." `$EVE/docs/concepts/sessions-runs-and-streaming.md` §"Use the client
from TypeScript" says the same: "For scripts, server-to-server calls, tests, evals, and custom
UIs, `eve/client` wraps these routes in a typed client so you don't hand-roll the POST and NDJSON
stream loop."

`$EVE/docs/README.md` ("The runtime shape") describes what eve gives you as "a stable HTTP message
route … a reconnectable session stream", not an embeddable loop.

### Evals are not the in-process path either

The orchestrator asked whether `eve/evals` is the documented way to run an agent in process. It is
not. `$EVE/docs/evals/targets.mdx` is explicit in its first line: **"An eval target is always an
HTTP URL. `eve eval` starts a local dev server, while `eve eval --url <url>` runs against an
existing server or deployment."** `$EVE/docs/evals/overview.mdx` repeats it: "Evals exercise the
same HTTP surface your users hit. The runner boots (or targets) a real agent server, drives
sessions through the TypeScript client protocol." `$EVE/dist/src/evals/types.d.ts` `EveEvalTarget`
confirms the shape (`kind: "local" | "remote"`, `url: string`).

`eve/evals` also exposes no runner function. `$EVE/dist/src/evals/index.d.ts` exports
`defineEval`, `defineEvalConfig`, `mockModel`, `EveEvalTurnFailedError` and types. The runner is
the `eve eval` CLI (`$EVE/docs/evals/running.mdx`). An eval is authored under `evals/*.eval.ts`
and discovered by file path, so the harness cannot call it as a library.

### What must be started, and how eve itself starts it

`$EVE/docs/reference/cli.md` documents three ways to get a server:

| Command | What it does (cli.md) |
| --- | --- |
| `eve dev [--no-ui] [--port <n>]` | "Start the local dev server"; `--no-ui` starts it without the terminal UI; `--port 0` picks a free port |
| `eve build` | "Compile `.eve/` artifacts and build the host output; prints the output directory" |
| `eve start [--host] [--port]` | "Serve the built `.output/` app; prints the listening URL" |

`$EVE/docs/guides/deployment/self-hosting.md` ties the last two together: "The build writes the
Nitro server under `.output/`. `eve start` serves that output and accepts either `PORT` or the
`--port` flag." Verified on this repository: `apps/example-agent/.output/server/index.mjs` exists
after the M1-T2 `eve build` (§10).

**The decisive evidence is eve's own first-party integrations.** `eve/next`, `eve/nuxt` and
`eve/sveltekit` all need an eve server next to a framework dev server, and all three spawn one as
a child process. From `$EVE/dist/src/public/next/server.js` (minified, but readable):

```js
function startEveDevServer(e,t,n){return startServerProcess({args:[createEveBinaryPath(),`dev`,`--no-ui`,`--port`,`0`],command:process.execPath,cwd:e,logLabel:n,…})}
function startEveProductionServer(e){…let r=join(e.appRoot,`.output`,`server`,`index.mjs`);if(!existsSync(r))throw Error(`eve production output is missing at ${r}. Run eve build from ${e.appRoot} before starting Next.js.`);return startServerProcess({args:[r],command:process.execPath,cwd:e.appRoot,env:{HOST:…,NITRO_HOST:…,NITRO_PORT:n,PORT:n}})…}
```

`$EVE/dist/src/public/sveltekit/dev-server.js` and `$EVE/dist/src/public/nuxt/dev-server.js` are
the same code with a different registry filename, and `$EVE/dist/src/public/sveltekit/index.d.ts`
documents the behaviour in prose: "it resolves the server in order: the `EVE_BASE_URL` env var if
set, then a healthy shared eve dev server already running for the app, then a freshly spawned
`eve dev --no-ui --port 0`."

If eve's own framework adapters cannot embed the runtime, neither can the harness. **Spawning a
process and speaking `eve/client` to it is the documented pattern, not a workaround.**

### There is also a CLI one-shot

`$EVE/docs/reference/cli.md` §`eve invoke` documents `eve invoke [prompt] [-u <url>] [--resume]
[--json-schema]`: "Use `eve invoke` to submit a turn without opening the TUI. It emits JSON after
the invocation completes or reaches a blocking input or authorization event." Paused invocations
exit `3`, failures exit `1`. This is a second documented programmatic path, but it is a subprocess
with a JSON stdout contract rather than a typed API, it offers no per-event stream for tracing,
and its result shape has no published TypeScript type. Prefer `eve/client`.

### Can it be driven from a test?

Yes, at the cost of a process. `eve eval` proves the pattern (boot, poll `/eve/v1/health`, verify
`/eve/v1/info`, drive sessions), and `client.health()` / `client.info()` are the public equivalents
(`$EVE/docs/guides/client/overview.mdx`). `localDev()` route auth accepts requests only while
the process is an `eve dev` server, which `$EVE/docs/guides/auth-and-route-protection.md`
describes as "a property of the deployment, not the request, so no request header can flip it" —
so a spawned `eve dev` needs no credential wiring for the transport. What it costs is a real
server per unit test, which is why §12 recommends the fake-runtime split.

---

## 2. Structured output is first-class, per turn, and server-validated

**Answer: yes, and the harness should use it rather than parsing text.**

`$EVE/docs/guides/client/output-schema.mdx`: "Pass `outputSchema` on a client turn when the caller
needs structured data instead of only assistant text. The runtime makes the model satisfy the
schema before the turn settles, then emits the final payload as `result.completed`."

Three facts that matter for the harness:

- **Both schema forms are accepted.** A raw JSON Schema object works directly, and "the client also
  accepts Standard Schema implementations such as Zod, Valibot, and ArkType. The schema is lowered
  to JSON Schema before the request is sent." The type confirms it:
  `$EVE/dist/src/client/types.d.ts` `SendTurnOptions.outputSchema?: StandardJSONSchemaV1<unknown,
  TOutput> | JsonObject`. This matters because M1-T3 owns the harness `Schema<T>` abstraction, and
  whatever it picks must be able to produce one of these two forms.
- **The server validates, the client does not.** "The server is authoritative for validation. The
  client types `MessageResult.data` from your generic and schema, but it doesn't revalidate the
  streamed payload client-side." So the harness still has to validate `result.data` against the
  domain's `outputSchema` before returning it, and raise `ValidationError`
  (`docs/contracts/errors.md`) on a mismatch. Do not treat a typed `data` as a checked `data`.
- **It is per turn, not per session.** "Client `outputSchema` is scoped to the turn that sends it.
  It doesn't become a permanent setting for the conversation." That is exactly the harness's unit
  of work.

Where it lands: `$EVE/dist/src/client/types.d.ts` `MessageResult.data: TOutput | undefined`,
documented as "Final structured result emitted by the harness, when this turn requested an output
schema and the server fulfilled it". `result.data` is `undefined` when the turn produced none.
The corresponding stream event is `ResultCompletedStreamEvent`
(`$EVE/dist/src/protocol/message.d.ts`, `{ data: { result: JsonValue, sequence, stepIndex,
turnId }, type: "result.completed" }`); `$EVE/docs/concepts/sessions-runs-and-streaming.md`
describes it as "The finalized structured result for a turn that requested an output schema".

There is a second, authored form: `defineAgent({ outputSchema })`
(`$EVE/docs/agent-config.md` "Other defineAgent fields"), but it is for "function-like invocations
such as a subagent turn, schedule, or remote job", and "Ordinary interactive turns ignore it
unless the client supplies a per-message schema." The per-turn client schema is the one the
harness wants, because the domain's output schema belongs to the job, not to the authored agent.

---

## 3. Model injection works, and the documented test double is eve's own `mockModel`

**Answer: yes to a `LanguageModel` instance; yes to a test double without a credential.**

`$EVE/dist/src/shared/agent-definition.d.ts` line 54:

```ts
export type PublicAgentStaticModelDefinition = string | LanguageModel;
```

which confirms the scaffold note's reading. `$EVE/docs/agent-config.md` §"Set the model": "`model`
accepts a gateway model id string, which routes through the Vercel AI Gateway. To call a provider
directly and configure the model in code, pass a provider-authored `LanguageModel`."

### The documented test double is `mockModel`, not an AI SDK mock

`$EVE/docs/evals/overview.mdx` §"Deterministic fixture models": "Use `mockModel` when an eval
fixture needs to exercise eve's runtime without calling a model provider." It is exported from
`eve/evals` (`$EVE/dist/src/evals/index.d.ts`) and
`$EVE/dist/src/evals/mock-model.d.ts` gives the signature:

```ts
export declare function mockModel(input?: MockModelOptions | MockModelResponder | string): LanguageModel;
```

It returns an AI SDK `LanguageModel`, so it slots straight into `defineAgent({ model })`. The
responder receives an eve-normalized prompt view (`MockModelRequest`: `messages`, `userMessages`,
`lastUserMessage`, `userMessageCount`, `tools`, `toolResults`) and may return a string or
`{ text?, toolCalls?, usage? }` — enough to script a deterministic tool loop and explicit token
counts. `mockModel()` with no argument replies `"Mock response"`.

The docs are explicit about the constraint: "**Because the model is part of the agent definition,
use it for a dedicated fixture agent**; it remains mocked whether that fixture runs locally or as
a deployed eval target." There is no documented way to inject a model per run from outside the
authored file. `defineDynamic` can select a model at `session.started` / `turn.started` /
`step.started` (`$EVE/docs/guides/dynamic-capabilities.md` §"Dynamic models"), but the resolver is
itself an authored file and its inputs are session auth, channel metadata and `ctx.messages` — not
a caller-supplied model object.

### The AI SDK's own mocks, for completeness

`$AI/package.json` exposes `./test`, and `$AI/dist/test/index.d.ts` exports `MockLanguageModelV3`
and `MockLanguageModelV4` (plus `MockProviderV3/V4`, `simulateReadableStream`, `mockValues`,
`convertArrayToAsyncIterable`, and the rest). Those are the right doubles for **M1-T5**, the
`ai`-based `AgentRuntime`, where the harness constructs the model call itself. For M1-T6 they are
the wrong layer: a model injected on the harness side never reaches an eve server process. Nothing
in the installed docs says eve rejects an `ai/test` mock passed to `defineAgent`, and nothing says
it accepts one either; `mockModel` is the documented choice and should be used.

### What the Gateway string path needs

`$EVE/docs/agent-config.md`: a Gateway id string "routes through the Vercel AI Gateway".
`$EVE/docs/guides/deployment/self-hosting.md`: "Set `AI_GATEWAY_API_KEY` to use a string model ID
through the Vercel AI Gateway from a non-Vercel host." `$EVE/docs/guides/dev-tui.md` adds that
deployments "need explicitly provisioned `AI_GATEWAY_API_KEY`, `OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, or supported project OIDC credentials", while local development can also use
credentials saved through `/login` (stored in the OS secret store, never in project files).
`$EVE/docs/reference/cli.md` §`eve link` says linking "pulls the project's environment so an AI
Gateway credential (`VERCEL_OIDC_TOKEN` or `AI_GATEWAY_API_KEY`) lands in `.env.local`".

So: the example agent's current `EXAMPLE_AGENT_MODEL` Gateway string
(`apps/example-agent/agent/agent.ts`) requires a credential at model-call time and is therefore a
`live:eve` path. A `mockModel` fixture requires none.

---

## 4. Cancellation: `response.cancel()`, and `signal` is not it

**Answer: two distinct mechanisms, and the harness needs the second one.**

`SendTurnOptions.signal` exists (`$EVE/dist/src/client/types.d.ts`) but its doc comment is "Abort
signal for cancelling **the request**." It aborts the HTTP call, not the durable run. The run
would keep going server-side.

The documented run-level cancellation is `MessageResponse.cancel()`.
`$EVE/dist/src/client/message-response.d.ts`:

```ts
/**
 * Requests cooperative cancellation of this exact turn.
 *
 * The request waits for the response stream to identify the turn when
 * necessary. Continue consuming the stream to observe its durable boundary.
 */
cancel(): Promise<CancelSessionResult>;
```

`$EVE/docs/guides/client/streaming.mdx` shows the exact usage and the ordering rule: "Start
consuming the response first; cancellation waits for the stream to identify the turn, guards the
request with its ID, and never targets a later turn."

```ts
const resultPromise = response.result();
const cancellation = await response.cancel();
const result = await resultPromise;
```

`ClientSession.cancel({ signal?, tasks?, turnId? })` is the fixed-handle variant
(`$EVE/dist/src/client/session.d.ts`), "Requests cooperative cancellation of this session's active
turn and optionally its tasks".

Semantics, from `$EVE/docs/concepts/sessions-runs-and-streaming.md` §"Cancel the in-flight turn":

- `"accepted"` means the request was durably queued; "cancellation completes asynchronously".
- Confirm it on the stream as `turn.cancelled` followed by `session.waiting`.
- `"no_active_turn"` means the session is unknown or terminal. **Both statuses are success.**
- Cancellation is not a failure: "the cancelled turn ends without any failure event … Durable
  history keeps the accepted user input and previously settled work, but discards incomplete
  assistant output and unfinished tool state."
- By default, already-admitted background tasks survive; pass `tasks: true` to cancel them too.

Nothing documents `task_cancel` as a caller-facing API — it is a model-facing default tool that
"lets the root session cancel background tasks" (`$EVE/docs/concepts/built-in-tools.md`), i.e. the
model calls it, not the harness.

**Consequence for `ExecutionContext.signal`** (`docs/contracts/execution-context.md`: "Cancellation.
An adapter must propagate it to the work it starts."): the adapter must register an `abort`
listener that calls `response.cancel()`, and must also pass `signal` to the underlying HTTP calls
so a hung transport does not outlive the job. Those are two propagations, not one.

---

## 5. Observing the run: the turn's own event list is the trace source

**Answer: `MessageResult.events`, or live iteration of the same stream.**

`$EVE/dist/src/client/types.d.ts` `MessageResult`:

| Field | Meaning (from the declaration) |
| --- | --- |
| `data` | Structured result when the turn requested an output schema |
| `message` | Final completed assistant text, or `undefined` |
| `events` | "All events received during this turn" |
| `inputRequests` | HITL input requests emitted during this turn |
| `sessionId` | The turn's session ID |
| `status` | `"completed"` / `"waiting"` / `"failed"` |

`events` is a `MessageStreamEvent[]`, the discriminated union in
`$EVE/dist/src/protocol/message.d.ts`. The events the harness needs are all there, with exact
shapes:

| Harness need | Event | `data` fields that carry it |
| --- | --- | --- |
| model calls + tokens + cost | `step.completed` | `finishReason`, `stepIndex`, `turnId`, `usage?: { costUsd?, inputTokens?, outputTokens?, cacheReadTokens?, cacheWriteTokens? }`, `providerMetadata?.gateway.generationId` |
| model call started (and which model) | `step.started` | `modelId`, `stepIndex`, `turnId` |
| tool calls requested | `actions.requested` | `actions: readonly RuntimeActionRequest[]`, `stepIndex`, `turnId` |
| tool call returned | `action.result` | `result: RuntimeActionResult`, `status`, `error?`, `stepIndex`, `turnId` |
| structured output | `result.completed` | `result: JsonValue` |
| failure | `step.failed` / `turn.failed` / `session.failed` | `{ code, message, details? }` |
| HITL pause | `input.requested` | `requests: readonly InputRequest[]` |
| boundary | `turn.completed` / `turn.cancelled` / `session.waiting` | `turnId`, `sequence` |

Every event also carries `meta` (`MessageStreamEventMeta`: `id`, `at`, optional `deliveryIds`).
`$EVE/docs/concepts/sessions-runs-and-streaming.md` §"The event envelope" documents `meta.id` as an
`evt_`-prefixed ULID, "stamped once, when the event is written to the durable stream", stable
across reconnects and rewinds — a natural idempotency key for `TraceEvent` rows in M2.

`costUsd` is the answer to `usage.costUsd?`. `$EVE/docs/reference/cli.md` §`eve traces` confirms
its provenance: "Step spans carry token counts under `agent.usage.*`, and cost **when Vercel AI
Gateway served the call**." A direct-provider or mock model reports no cost, so `costUsd` must
stay optional in the harness shape.

### Three caveats the implementer must not miss

1. **There is no aggregate `usage` on `MessageResult`.** The harness sums `step.completed.data.usage`
   itself. `modelCalls` = count of `step.completed`; `toolCalls` = count of `action.result` (or of
   the entries in `actions.requested.data.actions`, which is the better count if a call never
   returns). `durationMs` is the harness's own wall clock — eve exposes no turn duration on the
   stream.
2. **Retries double-count.** `$EVE/docs/concepts/sessions-runs-and-streaming.md`: "eve runs each
   durable step up to four times. If a step is interrupted partway … whatever it already wrote
   stays on the stream, and the new attempt emits its own events with their own ids. Both attempts
   carry the same `turnId`, `stepIndex`, and `sequence` … but they are distinct events and **no
   field records which attempt finished**." A naive sum over `step.completed` therefore
   over-reports usage for an interrupted turn. Deduplicating on `(turnId, stepIndex, sequence)`
   would instead risk keeping the abandoned attempt. This is an unresolved trade-off the harness
   must choose deliberately (§11).
3. **`message.completed` fires more than once per turn.** "the agent often emits interim assistant
   text before a tool call. To tell tool-call narration from a terminal reply, check
   `message.completed.data.finishReason`." `MessageResult.message` already applies the terminal
   rule, so prefer it over scanning events.

### The other two observation surfaces are authored, not caller-side

- **Hooks** (`$EVE/docs/guides/hooks.md`, `eve/hooks`): `defineHook({ events })` files under
  `agent/hooks/`. They see the same envelope but "observe each event as it is emitted rather than
  as it is read". They run in the server process, so they cannot write to a harness `TraceWriter`
  held in the caller's process. Useful later for persisting events to storage (M2), not for M1
  tracing.
- **Instrumentation** (`$EVE/docs/guides/instrumentation/instrumentation.mdx`, `eve/instrumentation`):
  `agent/instrumentation/*.ts` files handling `session`, `turn`, `model.call.*`, `action.*`,
  `tool.call.*` lifecycle events, with a per-file `tracePolicy` controlling whether inputs and
  outputs are recorded. OTel destinations are configured through
  `eve/instrumentation/otel` (`$EVE/docs/guides/instrumentation/otel.mdx`); `eve dev` records local
  traces under `.eve/traces/` by default and preview/production export to Vercel Agent Runs. Again:
  server-side, authored, out-of-band. The trace topology it produces is
  `invoke_agent → agent.step → {chat <model>, agent.action → execute_tool <tool>}`.

**For M1, the client event list is the right source.** It is in the harness's own process,
synchronous with the run, and needs no authored file.

### This reads against the letter of ADR-0012, and the reading needs confirming

[ADR-0012](../../decisions/0012-reuse-documented-eve-capabilities-instead-of-cloning-them.md)
says "agent-runtime observation MUST go through `eve/hooks`, normalized into the harness trace
schema … not through console-log parsing". Its Context section states the underlying rule more
loosely: use eve hooks/instrumentation "when the documented event stream contains the needed
event", and normalize "rather than parsing console logs". The same ADR separately mandates
`eve/client` for "documented programmatic/session invocation".

The recommendation here is that consuming `eve/client`'s stream **satisfies ADR-0012** rather than
deviating from it, because it is literally the same documented event stream with the same envelope.
`$EVE/docs/concepts/sessions-runs-and-streaming.md` §"The event envelope" says so outright:
"Authored hooks receive the same envelope, but observe each event as it is emitted rather than as
it is read." Nothing is being parsed out of logs, and nothing parallel to eve is being built.

The practical argument is that a hook cannot do the job: it runs inside the server process, so it
has no reference to the caller's `TraceWriter`, and shipping trace events back across the process
boundary would mean the harness inventing a transport that `eve/client` already provides. It is also
the wrong granularity — a hook fires for every session on the server, not for one job.

Flagged as open question 8 (§14) so the orchestrator can confirm the reading, or record a short
ADR-0012 clarification, rather than have the implementer decide it silently.

---

## 6. Per-run tool policy: not directly, but there is a documented composition

**Answer: no API lets a caller pass an allowlist with a run. The documented composition that gets
there uses route auth plus a tool `approval` policy.**

What the docs rule out first:

- `defineAgent` has no per-call tool field. `$EVE/dist/src/shared/agent-definition.d.ts` offers
  `defaultTools?: boolean` (line 316) and `tool?: boolean` (line 338) — both authored, both
  compile-time.
- `SendTurnOptions` (`$EVE/dist/src/client/types.d.ts`) carries `turnPolicy`, `clientContext`,
  `outputSchema`, `streamReconnectPolicy`, `signal`, `headers`. **No tool field.**
- Dynamic tool resolvers (`$EVE/docs/guides/dynamic-capabilities.md`) are authored files under
  `agent/tools/`. They can return a different tool set per session or turn, but their inputs are
  `ctx.session` (auth, turn, parent), `ctx.channel`, and — at `turn.started` — `ctx.messages`.
  They receive no caller-supplied policy object.
- Hooks cannot block. `$EVE/docs/guides/hooks.md`: "Handlers are observe-only … Hooks always run
  **after** the event is durably recorded." A hook that throws surfaces as `turn.failed`, but the
  installed docs do not establish that a throw on `actions.requested` prevents the tool from
  executing. **Do not build an enforcement mechanism on that.**

### What does work, and is fully documented

Two documented features compose into a per-run policy:

**(a) The caller's identity reaches tool code.** `$EVE/docs/guides/auth-and-route-protection.md`
§"The ordered auth walk": a custom `AuthFn` on `agent/channels/eve.ts` verifies the request and
returns a `SessionAuthContext` with arbitrary `attributes`:

```ts
return {
  authenticator: "app",
  principalId: session.userId,
  principalType: "user",
  attributes: { email: session.email, teamId: session.teamId },
};
```

§"What reaches `ctx.session.auth`": "`ctx.session.auth` carries the result of the channel's route
auth forward as the caller snapshot … Use the principal on `auth.current` … to scope tools, resolve
dynamic capabilities per principal, or enforce tenant boundaries." `eve/channels/auth` ships
`jwtHmac()` / `verifyJwtHmac()` for exactly this shape (`issuer`, `audiences`, `secret`, plus
`subjects` / `claims` matchers), so the harness can mint a short-lived per-run token whose claims
carry the job's grants.

**(b) A tool approval policy can deny.** `$EVE/docs/tools/human-in-the-loop.md` §"Approvals": a
policy "receives the same session context as tool execution, plus `{ toolName, toolInput,
approvedTools, callId, abortSignal }`", and the worked example denies outright:

```ts
approval: ({ session, toolInput }) => {
  const callerTenant = session.auth.current?.attributes.tenantId;
  if (callerTenant === undefined || callerTenant !== toolInput?.tenantId) {
    return { type: "denied", reason: "Caller cannot access this tenant." };
  }
  return (toolInput?.amount ?? 0) > 1000 ? "user-approval" : "not-applicable";
},
```

"Policies can also return `"approved"` or `"denied"` to decide automatically. Use `{ type:
"approved" | "denied", reason }` when the model should receive a reason." Types are exported from
`eve/tools/approval`. The denial reaches the caller as an `action.result` with
`status: "rejected"` (`ActionResultStatus`, `$EVE/dist/src/protocol/message.d.ts`: "`rejected`
marks a tool call the user (or a policy) denied").

So: **grants ride in a signed token the harness mints per run; an authored approval policy reads
`ctx.session.auth.current.attributes` and denies ungranted tools.** Both halves are documented and
this is exactly what AD-012 / ADR-0012 asks for — reuse eve's approval machinery rather than
cloning it.

### The M1 fallback

The composition above needs a real `agent/channels/eve.ts` with a custom `AuthFn` and an approval
policy on every authored tool. That is more authored surface than M1-T6 needs, and it enforces
policy **inside the agent**, where the harness cannot prove it happened.

For M1 the documented, cheap fallback is the one the scaffold note already anticipated:

1. **Shrink the surface by file.** `defineAgent({ defaultTools: false })` turns off every optional
   default in one line (`$EVE/docs/concepts/built-in-tools.md` §"Disable optional default tools":
   "Optional default tools are enabled unless you set `defaultTools: false` in `agent/agent.ts`"),
   leaving only authored tools plus `connection_search` when connections exist. `disableTool()`
   per slot is the per-tool form.
2. **Enforce grants where the harness can see them.** The adapter reads `ExecutionContext.permissions`
   and inspects every `actions.requested` / `action.result` event. A tool call with no matching
   `ToolGrant` fails the run with `PermissionDeniedError({ toolId, requested })`
   (`docs/contracts/errors.md`) and cancels the turn through `response.cancel()`.

This is detection-after-the-fact, not prevention, and the note says so plainly. Record it as a
known M1 limitation, with the auth-plus-approval composition as the M2/M5 upgrade path.

---

## 7. Sessions, state, and where a run writes

**Answer: every run is a durable workflow with on-disk state; a fresh session per job is one call;
there is no documented in-memory mode.**

`$EVE/docs/concepts/execution-model-and-durability.mdx`: "Every session runs as one durable
workflow, built on the open-source Workflow SDK (Vercel Workflow when you deploy on Vercel) … In
local development and in a self-deployed `eve start` process, eve uses the SDK's local world by
default; **that world persists workflow runs on disk under `.eve/.workflow-data`** and dispatches
through the same Nitro-hosted workflow routes."

`$EVE/docs/guides/deployment/self-hosting.md` repeats it: "The default local Workflow world stores
run state under `.eve/.workflow-data`. Mount that directory on persistent storage so runs survive
process and container replacement."

### A fresh, isolated session per job

`client.sessions.create({ message, outputSchema })` creates a new durable session and starts its
first turn in one request (`$EVE/docs/guides/client/overview.mdx`, `$EVE/dist/src/client/sessions.d.ts`).
The docs are explicit that it never reuses: `client.sessions` "stores only the session ID and
stream cursor. Every method calls an ID-addressed route. Sending through a handle for an unknown or
terminal ID fails instead of creating a replacement." A client can own many independent sessions
concurrently, which is how the harness would run jobs in parallel.

A first turn on a new session starts with clean history. `$EVE/docs/concepts/state.md`: `defineState`
values are per session, "durable by default and do not reset between turns", and "Every subagent
starts with its own fresh state". A brand-new session therefore gets fresh state without any
teardown.

`session.reset({ reason })` "terminally retires the exact session ID. A reset ID never becomes a new
session" (`$EVE/docs/concepts/sessions-runs-and-streaming.md`). Useful as an explicit end-of-job
marker, but not required.

### What persists after a job

- Workflow run state under `.eve/.workflow-data` (local world).
- Sessions last 30 days by default (`limits.sessionTimeoutMs`, `$EVE/docs/agent-config.md`).
  Expiration "does not delete stored session data."
- Local traces under `.eve/traces/v1` during `eve dev`, bounded by `EVE_TRACES_MAX_AGE_MS`
  (7 days), `EVE_TRACES_MAX_TOTAL_BYTES` (512 MB) and `EVE_TRACES_RETAIN_COUNT` (20), all
  disableable with `EVE_TRACES=off` (`$EVE/docs/reference/cli.md` §Retention).
- `eve dev` runtime generations under `.eve/dev-runtime/snapshots/`.

### The nearest thing to an ephemeral mode

`experimental.workflow.retention: 0` (`$EVE/docs/agent-config.md` §"Run data retention") has the
runtime delete each run's data "as soon as the run finishes instead" of keeping it. The docs carry
a loud warning: "**At `0`, a finished session's output is usually gone before you can read it.**
Since data is deleted immediately before it can be read back, results and transcripts become
unreadable and a client polling for a finished session's output can see it disappear."

**That is not an in-memory test mode, and the harness must not use it.** The `EveAgentRuntime`
reads its result from the turn's own live stream rather than by polling afterwards, so it might
survive — but "usually gone before you can read it" is not a contract, and the M1 acceptance
criteria do not need it. The practical isolation for tests is a throwaway app root (or a temporary
`cwd`), so `.eve/` lands somewhere disposable.

---

## 8. Execution-model implications for the adapter

- **The Workflow runtime is bundled; no extra install, no Node flag.**
  `$EVE/docs/concepts/execution-model-and-durability.mdx`: "The Workflow SDK is not inherently tied
  to Vercel. In local development and in a self-deployed `eve start` process, eve uses the SDK's
  local world by default." Selecting another world (`experimental.workflow.world`) is an
  opt-in for self-hosting and needs a package pinned to the `5.0.0-beta` `@workflow/*` line.
  Nothing in the installed docs requires a Node flag.
- **`eve build` is a prerequisite for `eve start`, not for `eve dev`.** `eve start` "Serves the
  previously built output" (`$EVE/docs/reference/cli.md`), and `eve/next`'s production path throws
  "eve production output is missing at …/.output/server/index.mjs. Run eve build … before starting
  Next.js." `eve dev` compiles on the fly and keeps generations under `.eve/dev-runtime/snapshots/`.
  For the harness that is a build-ordering constraint: if `EveAgentRuntime` targets a built server,
  `eve build` must run first, which `apps/example-agent`'s `build` script already does.
- **Both route prefixes must be reachable.** `$EVE/docs/guides/deployment/self-hosting.md`:
  "`/eve/` serves health, sessions, streams, channels, tools, and subagents" and
  "`/.well-known/workflow/` receives workflow callbacks. A proxy restricted to `/eve/` lets a
  session start, but **the run stalls when its callback can't reach eve**." Not an issue for a
  directly-addressed local server, but a real trap for any future proxying.
- **Steps retry, up to four times**, so a re-run step re-emits events (§5 caveat 2) and any
  non-idempotent tool must be idempotent or approval-gated
  (`$EVE/docs/concepts/execution-model-and-durability.mdx` §"Resuming after a crash").
- **Startup is asynchronous.** Session creation returns `202` "as soon as Workflow accepts the run.
  The command inbox can still be starting at that point. An immediate follow-up can return
  `409 session_not_ready`" — the client already retries that "for up to 20 seconds and respects
  the caller's abort signal" (`$EVE/docs/concepts/sessions-runs-and-streaming.md`,
  `$EVE/docs/guides/client/messages.mdx`). The adapter should not add its own retry.
- **A turn can park instead of finishing.** HITL approvals and `ask_question` park the run at
  `session.waiting` with `input.requested` on the stream, "durably, for as long as it takes"
  (`$EVE/docs/tools/human-in-the-loop.md`). `MessageResult.status` is then `"waiting"` and
  `inputRequests` is non-empty. The M1 harness has no human in the loop, so it must treat a
  populated `inputRequests` as a terminal `AgentExecutionError` rather than hanging.

---

## 9. The `agent` default tool, with zero subagents

**Answer: it is not inert, and M1 should disable it by file.**

`eve info` reports `agent` in the example agent's tool set today (§10). `$EVE/docs/subagents/index.mdx`
§"The built-in `agent` tool" says what it does, and it does not depend on any declared subagent:

> The root session receives `agent` by default. The model calls it to delegate a task to a new copy
> of the root agent or continue an existing copy … The copy uses the root's instructions,
> connections, auth, and sandbox. It receives the same tools except for the root-only `agent`, and
> starts with fresh conversation history and fresh state … The built-in `agent` always runs in the
> background and needs no configuration: each call returns `{ status: "working", taskId, agentId }`,
> then task notifications wake the parent.

With zero declared subagents it therefore still spawns **a second full copy of the example agent**,
in its own durable session, with its own sandbox and its own model spend. For the harness that is
three problems at once: a second session whose events are on a different stream (the parent only
sees `subagent.called` with a `childSessionId`), usage the parent's `step.completed` events do not
account for, and a turn that returns a task receipt and then completes later via a task
notification instead of settling cleanly.

Two documented ways to remove it:

```ts
// agent/agent.ts
export default defineAgent({ model: …, tool: false });
```

`$EVE/docs/agent-config.md`: "`tool` … On the root agent, controls the built-in `agent` tool."
`$EVE/docs/subagents/index.mdx`: "To prevent the root session from delegating to a fresh copy of
itself, set `tool: false` on the root agent."

```ts
// agent/tools/agent.ts
import { disableTool } from "eve/tools";
export default disableTool();
```

Note the precedence rule: "Any authored tool at that path replaces the model-facing framework tool
and **takes priority over `tool: false`**." Pick one, not both.

**Recommendation: `defaultTools: false` on the root agent** (§6), which removes `bash`,
`read_file`, `write_file`, `todo`, `load_skill`, `ask_question`, `task_cancel` and `agent` in one
authored line, leaving `lookup_vendor_evidence` and nothing else. The vendor-triage fixture needs
no sandbox, no file access, no human question and no delegation. If `load_skill` turns out to be
required for `agent/skills/triage-vendor.md` to be loadable on demand, add it back with the
documented one-line re-export (`export { default } from "eve/tools/load_skill";`) — it "adds no
execution surface by itself" (`$EVE/docs/concepts/built-in-tools.md`).

This is an M1-T6 authored-file change to `apps/example-agent`, so it belongs to the implementer,
not to this note.

---

## 10. Commands run, and what they produced

All run from the repository root on 2026-09-19 with Node 24.21.0 and pnpm 12.4.2 on `PATH`.

```sh
$ node -e "console.log(require('$EVE/package.json').version)"
0.63.0
$ node -e "console.log(require('$AI/package.json').version)"
7.0.107
```

```sh
$ pnpm --filter @internal/example-agent exec eve info --json    # tools array only
["bash","read_file","write_file","todo","load_skill","ask_question","task_cancel","agent","lookup_vendor_evidence"]
```

Unchanged from M1-T2: nine tools, eight of them eve defaults. `eve info --json` also reports the
HTTP surface, which is the contract `eve/client` speaks:

```text
POST /eve/v1/session
POST /eve/v1/session/:sessionId
POST /eve/v1/session/:sessionId/cancel
POST /eve/v1/session/:sessionId/compact
POST /eve/v1/session/:sessionId/clear
POST /eve/v1/session/:sessionId/reset
GET  /eve/v1/session/:sessionId/stream
GET  /eve/v1/session/:parentSessionId/subagents/:callId/:childSessionId/stream
GET  /eve/v1/info
GET|HEAD /eve/v1/health
POST /eve/v1/callback/:token
POST /eve/v1/task-input/:token
GET|POST|PUT|PATCH|DELETE /.well-known/workflow/v1/webhook/:token
```

Build output from the M1-T2 `eve build`, still present:

```sh
$ ls apps/example-agent/.output apps/example-agent/.output/server
.output:        eve-cache.json  nitro.json  public  server
.output/server: _libs  _runtime.mjs  index.mjs
```

```sh
$ ls apps/example-agent/.eve
agent-summary.json  builds  cache  compile  discovery  locks
```

Note what is **absent**: `.eve/.workflow-data` does not exist yet, because no session has ever run
in this repository. It will appear the first time a server executes a turn.

### Not verified by execution

**No eve server was started and no turn was run for this note.** The task scope was read-only
commands plus `eve info` / `eve build`, and a model-calling run needs `AI_GATEWAY_API_KEY`, which
is deliberately unset. The M1-T6 implementer should verify the following before writing the
adapter, because the whole design in §12 rests on it:

```sh
# 1. a fixture agent whose model is mockModel() boots and serves a turn with no credential
cd apps/example-agent && pnpm exec eve dev --no-ui --port 0     # note the printed URL
curl -s <url>/eve/v1/health
curl -s -X POST <url>/eve/v1/session -H 'content-type: application/json' \
  -d '{"message":"ping"}'
curl -s "<url>/eve/v1/session/<sessionId>/stream?startIndex=0&includeTailIndex=1"
```

If that round trip works offline against a `mockModel` agent, the adapter and its unit tests are
credential-free. If it does not, §14 open question 3 becomes a blocker.

---

## 11. Not documented, and therefore harness-owned

Under the no-assumption stop condition in `AGENTS.md`, these are recorded as open technical
decisions rather than guessed:

1. **No in-process execution.** Nothing public embeds the eve runtime. The harness owns the
   decision of *how* to obtain a server (spawn, reuse, or require a URL) and owns its lifecycle.
   This is the largest harness-owned surface in M1-T6.
2. **No caller-supplied tool policy.** `SendTurnOptions` has no tool field and no documented
   equivalent exists. Per-run permission enforcement is harness-owned; §6 gives the documented
   composition and the M1 fallback.
3. **No caller-supplied model.** `defineAgent({ model })` is authored. Injecting `mockModel` means
   authoring a fixture agent, not passing an object at run time.
4. **No aggregate usage.** eve reports usage per `step.completed`; the roll-up into
   `{ modelCalls, toolCalls, durationMs, costUsd? }` is entirely harness arithmetic, and
   `durationMs` has no eve source at all.
5. **Retry double-counting is unresolved by eve.** "no field records which attempt finished". The
   harness must pick a counting rule and document it. Recommended: sum every `step.completed` and
   label the figure as *provider-attempted* usage, since over-reporting cost is the safe error.
6. **No documented budget enforcement per run.** `limits.maxInputTokensPerSession`,
   `maxOutputTokensPerSession` and `maxTokenCostUsdPerSession` exist in `agent.ts`
   (`$EVE/docs/agent-config.md`) but are authored, per session, and token/cost only — there is no
   `maxModelCalls` or `maxToolCalls`. Worse, the documented behaviour on hitting one is a **human
   continuation prompt** ("Approve grants a fresh window … Stop cancels the in-flight turn"), which
   a headless harness cannot answer; only "sessions that cannot reach a human — task-mode runs such
   as schedules and delegated runs" fail outright with `SESSION_TOKEN_LIMIT_REACHED`. `Job.budget`
   enforcement is therefore harness-owned: watch the live stream, and call `response.cancel()` plus
   raise `BudgetExceededError` when a dimension is exceeded.
7. **No mapping from eve failure codes to the harness taxonomy.** `step.failed`, `turn.failed` and
   `session.failed` carry `{ code, message, details? }`, and the installed docs name only a handful
   of codes in passing (`MODEL_CALL_FAILED`, `SUBAGENT_UNAVAILABLE`, `SESSION_TOKEN_LIMIT_REACHED`,
   `SESSION_TOKEN_COST_LIMIT_REACHED`). There is no published catalogue. The adapter must wrap
   whatever it gets in `AgentExecutionError` and put the eve `code` in the error's context rather
   than trying to switch on it.
8. **`eve invoke`'s result shape is undocumented as a type.** `--json-schema` prints it at runtime,
   but no `.d.ts` describes it. Another reason to prefer `eve/client`.

---

## 12. Recommended `EveAgentRuntime` design

The shape to implement is build plan section 5 (`docs/milestones/build-plan.md` ~line 878):

```ts
interface AgentRuntime {
  run<TInput, TOutput>(
    job: Job<TInput, TOutput>,
    context: ExecutionContext
  ): Promise<AgentExecution<TOutput>>;
}
```

`AgentExecution<TOutput>` is named by the build plan but never defined there; M1-T5 owns its shape
and M1-T6 implements it. Below, every step is labelled **documented** with its path, or
**harness-owned**.

### Construction

```ts
new EveAgentRuntime({ host, auth?, headers? })   // harness-owned
```

- **harness-owned.** The adapter takes a base URL and does **not** manage a server process. Nothing
  in eve supports embedding one (§1), and a runtime that spawns children is far harder to reason
  about inside `createHarness()`. Whoever runs the harness supplies a URL — from `eve dev --no-ui
  --port 0`, from `eve start` after `eve build`, or from a deployment. A thin, separate test helper
  may spawn one for `live:eve` tests; the adapter itself stays a client.
- **documented** (`$EVE/docs/guides/client/overview.mdx`): construct one `Client({ host, auth?,
  headers?, redirect? })` and reuse it. Pass `redirect: "manual"` whenever credentials are
  configured, per the same page.

### `run(job, context)`, in order

1. **Preflight (optional, documented).** `await client.health()` returns `{ ok: true, status:
   "ready", workflowId }`. Fail fast with `AgentExecutionError` when the server is not up, rather
   than surfacing a transport error mid-run.
2. **Compose the input message — harness-owned.** eve's turn input is a string or AI SDK
   `UserContent` (`$EVE/docs/guides/client/messages.mdx`). There is **no documented context slot**
   for a job's objective. The closest documented thing is `clientContext`, which is "ephemeral
   context for the current turn … Objects are JSON-serialized into one context message … available
   to every model call in the turn, then disappears before the next turn" and is "never persisted
   to durable session history". Recommended split:
   - `message` ← `job.objective`, the instruction the model must act on.
   - `clientContext` ← `{ jobId: job.id, domain: job.domain, jobType: job.jobType, input: job.input }`,
     the data it acts on.
   This is a harness-owned convention. It is the right one because `objective` is a sentence and
   `input` is a record, and because `clientContext` is explicitly non-persisted, which suits a
   one-shot job. Document it in the `EveAgentRuntime` contract so a domain author knows where their
   input lands. Do **not** put secrets in either: both reach the model.
3. **Create the session and start the turn — documented**
   (`$EVE/docs/guides/client/overview.mdx`, `$EVE/dist/src/client/sessions.d.ts`):

   ```ts
   const { session, response } = await client.sessions.create<TOutput>({
     message: job.objective,
     clientContext: { jobId: job.id, domain: job.domain, input: job.input },
     outputSchema,                 // documented, §2
     signal: context.signal,       // documented: cancels the HTTP request only
   });
   ```

   One fresh session per job (§7). Keep `session` for cancellation and cleanup.
4. **Obtain structured output — documented** (`$EVE/docs/guides/client/output-schema.mdx`).
   `outputSchema` comes from the domain's output schema, lowered by M1-T3's `Schema<T>` to either a
   Standard Schema value or a JSON Schema object — both accepted. The payload arrives as
   `MessageResult.data` and as the `result.completed` event.
5. **Propagate `signal` — documented** (`$EVE/docs/guides/client/streaming.mdx`,
   `$EVE/dist/src/client/message-response.d.ts`). Two propagations:
   - pass `context.signal` into every client call that accepts one (`create`, `send`, `cancel`), and
   - register `context.signal.addEventListener("abort", () => { void response.cancel(); })`.

   Start consuming the stream **before** cancelling, as the streaming guide requires. Treat both
   `"accepted"` and `"no_active_turn"` as success.
6. **Consume the stream live — documented** (`$EVE/docs/guides/client/streaming.mdx`, "Stream
   events live"). Iterate `for await (const event of response)` rather than calling `result()`,
   because the harness needs per-event work as the run proceeds:
   - **trace — harness-owned mapping.** Emit a `TraceEvent` to `context.trace` per interesting
     event. Use `event.meta.id` (documented ULID) as the event identity so M2 can dedupe.
   - **permissions — harness-owned (§6).** On `actions.requested`, check each action's tool name
     against `context.permissions`. On the first ungranted tool, `response.cancel()` and reject with
     `PermissionDeniedError`.
   - **budget — harness-owned (§11 item 6).** Accumulate usage and elapsed time; on a breach,
     `response.cancel()` and reject with `BudgetExceededError`.
   - **usage — harness-owned arithmetic over documented fields.** Sum
     `step.completed.data.usage.{inputTokens,outputTokens,costUsd}`; count `step.completed` for
     `modelCalls`; count `action.result` for `toolCalls`; measure `durationMs` with the harness
     clock. `costUsd` stays optional (§5).
   Collect the events into an array so the terminal handling below can also use `result()`-style
   aggregation, or call `result()` on a second adapter path when no live policing is needed.
7. **Settle — documented boundaries** (`$EVE/docs/concepts/sessions-runs-and-streaming.md`),
   discriminated on **events**, not on `MessageResult.status`.

   > **Corrected by §15.** `MessageResult.status` looked like the discriminator when this section
   > was first written. It is not. The spike in §15 observed `status: "waiting"` for a successful
   > turn, for a turn that failed with `OUTPUT_SCHEMA_NOT_FULFILLED`, **and** for a cancelled turn.
   > It reports where the *session* ended up, not how the *turn* ended. Branch on the turn boundary
   > event instead, and use the exported narrowing helper `isTurnFailureEvent` from `eve/client`
   > (`$EVE/dist/src/protocol/message.d.ts`), which covers `session.failed | step.failed |
   > turn.failed`.

   | Observed in `events` | Adapter behaviour |
   | --- | --- |
   | `turn.completed`, `data` present | success; validate `data` against the domain schema (§2) and return `AgentExecution` |
   | `turn.completed`, schema requested, `data` absent | `ValidationError` — the turn settled without fulfilling the schema |
   | any event matching `isTurnFailureEvent` | `AgentExecutionError`, carrying eve's `{ code, message }` as context (§11 item 7) |
   | `turn.cancelled` | not a failure; surface whichever harness error caused the cancel (`PermissionDeniedError`, `BudgetExceededError`) or an abort error when `context.signal` fired |
   | `inputRequests` non-empty | `AgentExecutionError` — M1 has no human in the loop (§8) |

   Note also that `MessageResult.message` is `undefined` on a structured turn (§15), so the adapter
   must read `data` and must not fall back to `message` when a schema was requested.

8. **Do not leak eve types.** M1-T6's stated constraint
   (`docs/milestones/m1-local-agent-and-public-harness-boundary.md`). `sessionId`, `turnId`,
   `MessageStreamEvent` and `MessageResult` stay inside `packages/runtime-eve`; the ids may travel
   out only inside `TraceEvent` payloads and error context, as opaque strings.

### How a unit test injects a fake model

**Do not.** [ADR-0003](../../decisions/0003-ai-sdk-is-the-lowest-agent-runtime-contract-eve-is-the-default-runtime-adapter.md)
already names the acceptance criterion that matters — "a fake `AgentRuntime` can replace
`EveAgentRuntime` in a unit test" — so most harness tests never construct this adapter at all.
For the tests that do exercise it, there are two layers:

- **Unit (`*.test.ts`, no server, no credential).** Fake the *transport*, not the model. The
  adapter's only dependency is `eve/client`, so the constructor should take an injectable client
  (or a `fetch`) and the test feeds a scripted NDJSON event sequence. That exercises every piece of
  adapter logic that matters — usage arithmetic, permission checks, budget breach, cancellation,
  error mapping, the terminal-state table — with no process. This is the layer that must be
  complete.
- **Contract / live (`*.contract.test.ts` or a `live:eve`-tagged test).** Author a fixture agent
  whose `agent.ts` is `defineAgent({ model: mockModel(…), defaultTools: false })`
  (**documented**, `$EVE/docs/evals/overview.mdx`), spawn `eve dev --no-ui --port 0`, and run the
  adapter end to end. Deterministic and credential-free, but it costs a process, so keep it out of
  `pnpm test:unit`.

The fixture agent should be a separate app root from `apps/example-agent`, so the example keeps its
Gateway model and its `.eve/` stays clean. That is a harness-owned choice and worth an explicit
decision (§14).

---

## 13. Draft `Implementation references` block for the M1-T6 implementer

Paste into the `started` WORKLOG entry and extend with anything the implementation actually reads.

```text
### Implementation references
- package/version: eve 0.63.0, ai 7.0.107, zod 4.6.5 (pinned by packages/runtime-eve/package.json
  and apps/example-agent/package.json; resolved via
  require.resolve('eve/package.json', { paths: ['apps/example-agent'] })).
- installed docs read: $EVE/docs/README.md; concepts/sessions-runs-and-streaming.md;
  concepts/execution-model-and-durability.mdx; concepts/default-harness.md;
  concepts/built-in-tools.md; concepts/context-control.md; concepts/state.md;
  concepts/security-model.md; reference/typescript-api.md; reference/cli.md; agent-config.md;
  guides/client/{overview,messages,output-schema,streaming,continuations}.mdx;
  guides/session-context.md; guides/hooks.md; guides/dynamic-capabilities.md;
  guides/auth-and-route-protection.md; guides/instrumentation/{instrumentation,otel}.mdx;
  guides/deployment/self-hosting.md; guides/dev-tui.md; evals/{overview,targets,running}.mdx;
  tools/human-in-the-loop.md; subagents/index.mdx.
- official docs/repos/examples read: none beyond the installed package. The installed docs and
  declaration files settled every question, and the source-of-truth protocol puts them first.
- public types/exports inspected: $EVE/dist/src/index.d.ts; public/index.d.ts;
  public/local-dev.d.ts; public/definitions/agent.d.ts; shared/agent-definition.d.ts
  (PublicAgentStaticModelDefinition = string | LanguageModel; defaultTools; tool; outputSchema);
  client/index.d.ts; client/types.d.ts (ClientOptions, SendTurnOptions, StreamOptions,
  MessageResult); client/session.d.ts; client/sessions.d.ts; client/message-response.d.ts;
  protocol/message.d.ts (StepCompletedStreamEvent.usage, ActionsRequested/ActionResult,
  ResultCompleted, MessageStreamEventMeta); evals/index.d.ts; evals/mock-model.d.ts;
  evals/types.d.ts (EveEvalTarget); public/hooks/index.d.ts; public/instrumentation/index.d.ts;
  public/context/index.d.ts; public/ai/index.d.ts; public/models/index.d.ts;
  public/{next,vercel,nuxt,sveltekit}/index.d.ts; runtime/local-dev-capability.d.ts;
  $AI/dist/index.d.ts (ToolLoopAgent, generateText, streamText, Output, abortSignal);
  $AI/dist/test/index.d.ts (MockLanguageModelV3/V4).
- selected documented pattern: eve/client over HTTP against a running eve server. One fresh
  session per job via client.sessions.create({ message, clientContext, outputSchema, signal });
  structured result from MessageResult.data / the result.completed event; cancellation via
  MessageResponse.cancel(); usage aggregated from step.completed.data.usage across the turn's
  events. eve exposes no in-process run API: its own Next/Nuxt/SvelteKit adapters spawn
  `eve dev --no-ui --port 0` or `.output/server/index.mjs` as a child process
  ($EVE/dist/src/public/next/server.js), and evals target an HTTP URL ($EVE/docs/evals/targets.mdx).
  Research note: docs/research/vercel/2026-09-19-m1-eve-programmatic-execution.md.
- not documented / harness-owned: obtaining and owning the server URL; presenting job.objective
  and job.input as a turn (no documented context slot for either); per-run tool permission
  enforcement (no caller-supplied tool policy exists; §6); Job.budget enforcement (eve's own
  limits are authored, per session, token/cost only, and prompt a human on breach); the
  { modelCalls, toolCalls, durationMs, costUsd? } roll-up; the counting rule for retried steps;
  mapping eve failure codes to AgentExecutionError.
```

---

## 14. Open questions for the orchestrator

1. **Who owns the eve server process?** The recommendation in §12 is that `EveAgentRuntime` takes a
   URL and never spawns. The alternative is an adapter that manages a child process, which makes
   `harness.run()` a one-liner for a domain author but puts process lifecycle, port allocation and
   zombie cleanup inside a runtime adapter. **Recommended: URL-only, with a separate test helper
   that spawns.** Confirm before implementation, because it changes the adapter's constructor and
   the M1 acceptance demo.
2. **Structured output or text?** §2 says eve's per-turn `outputSchema` is documented, server-
   enforced and typed, so the harness should use it and parse nothing. This couples M1-T6 to
   M1-T3's `Schema<T>` producing a Standard Schema value or a JSON Schema object. If M1-T3 lands on
   something that produces neither, M1-T6 needs a lowering step. Worth confirming the two tasks
   agree.
3. **Can a `mockModel` agent serve a turn offline? — ANSWERED: yes. See §15.** Verified by
   execution on 2026-09-19 with every model credential unset: six turns, including structured
   output with both schema forms and a real mid-flight cancellation, in 58-141 ms each. The
   adapter's contract-level tests are credential-free and need no `live:eve` tag. Two prerequisites
   the docs do not state came out of it, and they feed questions 4 and 5: the fixture must be its
   own package whose `package.json` declares `eve` (§15.1), and it must set an agent-level
   `modelContextWindowTokens`, because `mockModel` has no AI Gateway catalog entry and compaction
   refuses to compile without one (§15.2). §15.7 lists three corrections the spike forced on
   earlier sections, the important one being that `MessageResult.status` cannot discriminate
   success from failure.
4. **Disable `bash` / `write_file` / `agent` by file in the example?** §9 recommends
   `defaultTools: false` on `apps/example-agent`, leaving one authored tool. It shrinks the M1
   attack surface to almost nothing and removes the subagent-spawning `agent` tool. The cost is
   that the example stops demonstrating eve's default tool set, and `load_skill` may need adding
   back for `agent/skills/triage-vendor.md`. Confirm the trade, and confirm it belongs to M1-T6
   rather than a follow-up to M1-T2.
5. **One example agent or two?** §12 suggests a separate fixture app root with a `mockModel` so the
   example keeps its Gateway model. §15.1 settles the cost: a fixture **must** be its own package
   with a `package.json` declaring `eve`, so it cannot hide inside `packages/runtime-eve`. That
   makes it a workspace package under `apps/`, needing one entry in `BOUNDARY_RULES`
   (`tests/architecture/boundaries.ts`) under the ADR-0025 allowlist. The alternative is making the
   example's model itself environment-switchable (`mockModel()` when `EXAMPLE_AGENT_MODEL` is
   unset), which keeps one app root but makes the example's behaviour depend on an env var and
   forces `modelContextWindowTokens` into the shipped example.
6. **Does permission enforcement by observation satisfy M1?** §6's M1 fallback detects an
   ungranted tool call and fails the run *after* the call was requested — and, depending on event
   ordering, possibly after it executed. North-star invariant 7 ("Every external write has explicit
   permission semantics") is satisfied in spirit only because the example's one tool is read-only.
   If that is not good enough, the auth-plus-approval composition has to land in M1 rather than M2,
   which adds `agent/channels/eve.ts` and a per-tool approval policy to M1-T6's scope.
7. **Should a run `reset()` its session when it ends?** It terminally retires the ID and makes job
   isolation explicit, at the cost of one extra round trip and of destroying the session a human
   might want to inspect afterwards with `eve dev <url>`. Leaving it parked at `session.waiting`
   costs nothing and keeps the evidence. **Recommended: do not reset**, and revisit when M2 owns
   evidence retention.
8. **Does consuming the `eve/client` stream satisfy ADR-0012's "MUST go through `eve/hooks`"?**
   §5 argues yes: it is the same documented event stream with the same envelope, eve's own docs say
   so, and a hook physically cannot reach the caller's `TraceWriter`. But the ADR's Decision
   sentence names `eve/hooks` specifically. Either confirm the reading in the M1-T6 WORKLOG entry,
   or amend ADR-0012 to say "the documented eve event stream, through `eve/hooks` or `eve/client`".
   **Recommended: amend**, because the current wording will trip the next reader too. The
   implementer should not resolve this alone.

---

## 15. Verified by execution: a `mockModel` turn offline

§10 left open question 3 unverified: can an agent whose model is `mockModel(...)` serve a full turn
with no credential? **Yes.** Run on 2026-09-19 from a throwaway fixture at
`packages/runtime-eve/.tmp-mock-agent/`, deleted afterwards. `AI_GATEWAY_API_KEY`,
`VERCEL_OIDC_TOKEN`, `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` were all confirmed unset in the
shell, and the server was additionally started under `env -u AI_GATEWAY_API_KEY -u
VERCEL_OIDC_TOKEN`. Six turns ran, including structured output with both schema forms and a real
mid-flight cancellation. Nothing reached a model provider.

This section corrects three things the earlier sections got wrong or left vague. They are called
out inline and at §15.7.

### 15.1 An app-root `package.json` is required, and it must declare `eve`

Answering the orchestrator's question directly: **`agent/` alone under a directory is not enough.**
Three attempts, each with the identical `agent/agent.ts` and `agent/instructions.md`:

| App root contents | `eve info` result |
| --- | --- |
| `agent/` only, no `package.json` | `Invalid eve project at …/packages/runtime-eve: found no agent files.` |
| `agent/` + `package.json` with no dependencies | `No eve project contains …/packages/runtime-eve/.tmp-mock-agent.` |
| `agent/` + `package.json` declaring `eve` (and `ai`, `zod`) | `Compile ready`, `0 errors, 0 warnings` |

The first result is the informative one: with no `package.json` in the fixture directory, eve walked
**up** to `packages/runtime-eve` — the nearest ancestor with a `package.json` — and reported that
*that* directory had no agent files. So the app root is the nearest enclosing package, and an agent
directory that is not itself a package root is invisible to eve. The second result shows that a bare
`package.json` is not sufficient either; eve only recognizes the project once `eve` appears in its
dependencies.

This matches how every layout in `$EVE/docs/concepts/project-structure.mdx` and
`$EVE/docs/reference/agent-files.md` is drawn — `package.json` always sits beside `agent/` — but
those pages never state it as a requirement, and they never mention the dependency check.

**Consequence for the permanent fixture (open question 5).** A mock-model fixture agent must be its
own package with its own `package.json` declaring `eve`. It cannot be a subdirectory of
`packages/runtime-eve`. That makes it a workspace package under `apps/`, which means extending
`BOUNDARY_RULES` in `tests/architecture/boundaries.ts` so the new app is covered by the
`appPackagesMayDependOn` allowlist (ADR-0025). Cost is now known and small; the decision is still
the orchestrator's.

Note the fixture needed **no `pnpm install`**: it declared `eve`, `ai` and `zod` but resolved them
through `packages/runtime-eve/node_modules` by ordinary upward Node resolution. A real workspace
package would be installed normally.

### 15.2 `mockModel` alone does not compile: `modelContextWindowTokens` is required

`$EVE/docs/evals/overview.mdx` presents this as a working one-liner:

```ts
export default defineAgent({
  model: mockModel("A deterministic reply"),
});
```

Verbatim, it fails at compile:

```text
Cannot compile agent compaction because the primary compaction trigger model "eve-mock/model" does not have known AI Gateway context window metadata.
```

Compaction needs a context-window size, eve resolves it from the AI Gateway catalog, and a mock
model is not in the catalog. The fix is an **agent-level** `modelContextWindowTokens`, which exists
on the definition type but is absent from the `$EVE/docs/agent-config.md` "Other defineAgent fields"
table:

```ts
// $EVE/dist/src/shared/agent-definition.d.ts, PublicAgentDefinition (line 355)
readonly modelContextWindowTokens?: number;   // "Optional context-window override for the static model."
```

Line 101 of the same file calls it "the agent-level `modelContextWindowTokens`", and
`agent-config.md` mentions the name only for the *dynamic* selection object. **Recorded as a
docs-vs-installed-package discrepancy** per the source-of-truth protocol §1: the installed
declaration wins, and any harness fixture using a non-catalog model must set this field.

### 15.3 The fixture

```jsonc
// packages/runtime-eve/.tmp-mock-agent/package.json
{ "name": "tmp-mock-agent", "version": "0.0.0", "private": true, "type": "module",
  "dependencies": { "ai": "7.0.107", "eve": "0.63.0", "zod": "4.6.5" } }
```

```ts
// agent/agent.ts  (responder abridged: diagnostics writer omitted)
import { defineAgent } from "eve";
import { mockModel } from "eve/evals";

export default defineAgent({
  defaultTools: false,
  modelContextWindowTokens: 128_000,
  model: mockModel({
    modelId: "fixture",
    provider: "harness-spike",
    respond: (request) => {
      const last = request.lastUserMessage ?? "";
      const called = new Set(request.toolResults.map((r) => r.name));

      const structured = request.tools.find((t) => t.name === "final_output");
      if (structured !== undefined && !called.has("final_output")) {
        return { toolCalls: [{ name: "final_output", input: { category: "software", risk: 2 } }] };
      }
      if (last.includes("TOOLCALL")) {
        if (!called.has("echo_fixture")) {
          return { toolCalls: [{ name: "echo_fixture", input: { token: "spike-42" } }] };
        }
        return `Tool returned: ${JSON.stringify(request.toolResults[0]?.output)}`;
      }
      if (last.includes("SLOW")) {
        return { toolCalls: [{ name: "echo_fixture", input: { token: "slow", delayMs: 8000 } }] };
      }
      return "Hello from the fixture agent.";
    },
  }),
});
```

```ts
// agent/tools/echo_fixture.ts
import { defineTool } from "eve/tools";
import { z } from "zod";

export default defineTool({
  description: "Echo a token back. Deterministic fixture tool, no side effects.",
  inputSchema: z.object({ token: z.string(), delayMs: z.number().optional() }),
  async execute({ token, delayMs }) {
    if (delayMs !== undefined && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return { echoed: token, at: "fixture" };
  },
});
```

The `mockModel` options used are exactly those in `$EVE/dist/src/evals/mock-model.d.ts`:
`MockModelOptions { modelId?, provider?, respond? }`, with `respond` a `MockModelResponder`
receiving `MockModelRequest { messages, userMessages, lastUserMessage, userMessageCount, tools,
toolResults }` and returning `MockModelResponse { text?, toolCalls?, usage? }` or a string. The
options form is what `$EVE/docs/evals/overview.mdx` calls for "when a fixture also needs a custom
model identity"; the `toolCalls` return is its documented "deterministic tool loops" form.

`eve info` on the fixture reported `Compile ready`, `0 errors, 0 warnings`, `1 tool`.
**`defaultTools: false` removed all eight defaults**, including `agent`, `bash` and `write_file`,
leaving only the authored `echo_fixture`. That is §9's recommendation confirmed by execution.

### 15.4 Commands

```sh
cd packages/runtime-eve/.tmp-mock-agent
node "$EVE/bin/eve.js" info
nohup env -u AI_GATEWAY_API_KEY -u VERCEL_OIDC_TOKEN \
  node "$EVE/bin/eve.js" dev --no-ui --port 0 > dev.log 2>&1 &
# dev.log:
#   ☰eve  v0.63.0
#   [DEV] server listening at http://127.0.0.1:49277/
node spike.mjs http://127.0.0.1:49277
```

`client.health()` returned `{"ok":true,"status":"ready","workflowId":"workflow//eve//workflowEntry"}`.
`client.info()` reported the model as `harness-spike/fixture` with
`"endpoint":{"kind":"external","provider":"harness-spike"}` and `contextWindowTokens: 128000` —
so eve records a mock as an external-provider model and never consults the Gateway.

Editing `agent/agent.ts` while the server ran produced
`[eve:dev] change detected … rebuilding authored artifacts` / `[eve:dev] authored artifacts
updated` in about 12 seconds, and the next turn used the new responder. Useful for iterating a
fixture; irrelevant to the adapter.

### 15.5 Event sequences observed

Plain text turn, no schema — **141 ms**:

```text
session.started -> turn.started -> message.received -> step.started ->
message.appended -> message.completed -> step.completed -> turn.completed -> session.waiting
```

`message` was `"Hello from the fixture agent."`, `data` was `undefined`, `inputRequests` was empty,
and the single `step.completed` carried
`{"inputTokens":118,"outputTokens":8,"cacheReadTokens":0,"cacheWriteTokens":0}` — **no `costUsd`**,
confirming §5's claim that cost appears only when AI Gateway served the call. `clientContext`
produced a second user-role message (`roles: system,user,user` versus `system,user` without it),
confirming how it reaches the model.

Authored tool call — **80 ms**, two steps:

```text
session.started -> turn.started -> message.received -> step.started ->
actions.requested -> action.result -> step.completed ->
step.started -> message.appended -> message.completed -> step.completed ->
turn.completed -> session.waiting
```

So **a mocked tool call does round-trip as `actions.requested` / `action.result`**, which is what
the harness's permission check and `toolCalls` count depend on. The tool result reached the second
model call as `toolResults: [{ id: "mock-tool-call-1-0-1", isError: false, name: "echo_fixture",
output: { echoed: "spike-42", at: "fixture" } }]`.

Structured output, zod — **125 ms**; plain JSON Schema — **58 ms**; identical sequences:

```text
session.started -> turn.started -> message.received -> step.started ->
step.completed -> result.completed -> turn.completed -> session.waiting
```

Both produced `data: {"category":"software","risk":2}`, matching
`result.completed.data.result` exactly. **Both schema forms work.** Event ids looked like
`evt_01M2XTKMJYHCJEPZ3DRKQEVVB9` with `at: 2026-09-19T21:54:23.966Z`, as §5 describes.

Cancellation of a genuinely in-flight turn (the tool slept 8 s), cancel issued at 1576 ms:

```text
session.started@110ms -> turn.started@112ms -> message.received@112ms ->
step.started@112ms -> actions.requested@112ms ->
turn.cancelled@1620ms -> session.waiting@1620ms
```

`cancel()` returned `{ status: "accepted", sessionId: … }` and the turn ended **44 ms later**, with
the 8-second tool still running and **no `action.result`** — the incomplete tool state was
discarded exactly as `$EVE/docs/concepts/sessions-runs-and-streaming.md` says. Total 1622 ms
against a tool that would have taken 8000 ms. Cancellation is real and fast.

Two contrasts worth keeping:

- Cancelling a turn that is already effectively done still returns `"accepted"`, but the turn
  completes normally (`turn.completed`, not `turn.cancelled`). With an instant mock model there is
  nothing left to interrupt. **A test that asserts on `turn.cancelled` must make the turn slow.**
- `SendTurnOptions.signal` aborted with `DOMException: AbortError: This operation was aborted`,
  thrown out of the client — a different mechanism and a different failure mode from `cancel()`,
  exactly as §4 predicted.

### 15.6 How a per-turn `outputSchema` actually reaches the model

Undocumented, and discovered by recording what the mock saw. On a turn with an `outputSchema`, eve
adds **a synthetic tool named `final_output`** whose `inputSchema` is the lowered JSON Schema, and
the model satisfies the schema by calling it. For the zod schema above, the mock was offered:

```json
{ "name": "final_output",
  "inputSchema": { "$schema": "http://json-schema.org/draft-07/schema#", "type": "object",
    "properties": { "category": { "type": "string" },
                    "risk": { "type": "integer", "minimum": -9007199254740991, "maximum": 9007199254740991 } },
    "required": ["category", "risk"], "additionalProperties": false } }
```

which also shows the client's zod-to-JSON-Schema lowering (§2) working, integer bounds and all.

Returning plain text on such a turn fails:

```text
{"code":"OUTPUT_SCHEMA_NOT_FULFILLED",
 "message":"The agent could not produce a result matching the requested schema.",
 "sequence":0,"stepIndex":0,"turnId":"turn_0"}
```

emitted as `step.failed` and then `turn.failed`, with the full sequence
`… message.completed -> step.completed -> step.failed -> turn.failed -> session.waiting`.

Two rules follow, and they point in opposite directions:

- **A fixture may script `final_output`.** It is the only way to make a mock satisfy a schema, the
  fixture is ours, and a rename would break a test rather than production.
- **The adapter must never mention `final_output`.** The name is not in any doc or declaration file;
  it is an internal that the source-of-truth protocol §2 forbids depending on. The adapter reads
  `MessageResult.data` and `result.completed`, both documented. Note also that `final_output` is
  **not** projected onto the stream as `actions.requested` / `action.result` — consistent with
  "Excluded internal actions never publish their input stream" — so it does not pollute the tool
  count or trip a permission check.

### 15.7 Corrections to earlier sections

1. **§12, step 7 — `MessageResult.status` is not a discriminator.** It was `"waiting"` for the
   successful turn, the `OUTPUT_SCHEMA_NOT_FULFILLED` turn, and the cancelled turn alike. It
   describes where the session ended, not how the turn ended. The table in §12 has been rewritten to
   branch on turn boundary events and to use `isTurnFailureEvent`, which `eve/client` exports for
   exactly this (`$EVE/dist/src/protocol/message.d.ts`: "Narrows a stream event to the failure
   events that terminate or poison a turn", covering `session.failed | step.failed | turn.failed`).
2. **§2 — `MessageResult.message` is `undefined` on a structured turn.** When the model answers
   through the schema there is no terminal assistant text at all. An adapter that falls back to
   `message` when `data` is missing would silently return nothing useful.
3. **§10 / §14 question 3 — answered: yes.** A `mockModel` fixture serves turns offline, so the
   adapter's contract-level tests are credential-free. The cost is an app-root package (§15.1) and
   the `modelContextWindowTokens` field (§15.2), neither of which was visible from the docs alone.

### 15.8 Teardown

`packages/runtime-eve/.tmp-mock-agent/` was deleted in full, including its 20 MB `.eve/` directory
and the diagnostics file under `/tmp`. The dev server was stopped and `pgrep -fl "eve.js dev"`
confirmed no process remained. `eve info` had also reported a workflow build cache inside the
installed package (`$EVE/.eve/workflow-cache/…`); it was absent after teardown, and anything under
`node_modules/` is git-ignored regardless.

---

## 16. What the implementation found that this note did not

Appended 2026-09-19 by the M1-T6 implementer, after building `EveAgentRuntime`
(`packages/runtime-eve`), `apps/eve-fixture-agent`, and `pnpm example:run` / `example:run:mock`.
Everything above held except where noted. Three findings are new, and the first two would each
have cost a later reader a day.

### 16.1 `SendTurnOptions.outputSchema` is narrower than §2 reads it

§2 says "Both schema forms are accepted … the client also accepts Standard Schema implementations
such as Zod", and §12 concludes the harness can hand its `Schema<T>` straight to the client. The
prose is eve's, and it is about `zod`. **The type is about a different interface.**

```ts
// $EVE/dist/src/client/types.d.ts
readonly outputSchema?: StandardJSONSchemaV1<unknown, TOutput> | JsonObject;
```

`StandardJSONSchemaV1` (`$EVE/dist/src/compiled/@standard-schema/spec/index.d.ts`, line 78)
requires `~standard.jsonSchema`, a `{ input, output }` converter pair. ADR-0027's `Schema<T>` is
Standard **Schema** v1, which requires `~standard.validate` and says nothing about `jsonSchema`.
They are siblings in one specification family, not the same interface, and neither is assignable
to the other.

eve's runtime agrees with its type. `$EVE/dist/src/tools/schema.js` `serializeOutputSchema` reads
`~standard.jsonSchema[direction]` and, when it is not a function, throws
`Zod 3 cannot emit an output JSON Schema. Upgrade to Zod 4 or provide a plain JSON Schema object.`
for a `zod` vendor, and `Standard Schema vendor "<v>" does not support JSON Schema conversion.`
for anything else.

Verified that `zod@4.6.5` does publish it: `z.object({...})["~standard"]` has keys
`validate, vendor, version, jsonSchema`, and `jsonSchema.output({ target: "draft-07" })` on the
vendor-triage output schema emits `minLength`, `minItems`, `enum`, `required` and
`additionalProperties: false`, with a `$schema` key eve strips.

**What the adapter does.** It lowers the domain schema itself through the converter and sends a
plain JSON Schema object, which the same field accepts as `JsonObject`
(`packages/runtime-eve/src/eve-schema.ts`). A domain whose schema publishes no converter fails
before a turn starts, with a message saying so. Recorded in ADR-0028.

### 16.2 eve silently replaces authored models when `NODE_ENV=test`

**Not in any document.** `$EVE/dist/src/runtime/agent/mock-model-adapter.js`:

```js
function shouldMockAuthoredRuntimeModels() {
  return process.env.NODE_ENV === "test" || process.env.EVE_MOCK_AUTHORED_MODELS === "1";
}
```

When it is true, eve swaps **every** authored model, including a `mockModel` from `eve/evals`, for
its own internal `MockLanguageModelV3` (`provider: "eve-runtime-mock"`). That mock satisfies a
turn's `outputSchema` from `$EVE/dist/src/runtime/agent/mock-structured-output.js`
`createJsonSchemaSample()`, whose string leaf is the literal `"structured-output"`, and it
**never calls the authored `respond` callback**.

Vitest sets `NODE_ENV=test` in the process that spawns the server, so a fixture agent's scripted
responder is ignored inside `pnpm test:contract` and only inside it. The symptom is the worst
kind: the turn succeeds, the structured output validates against the domain schema, and every
scripted branch, tool call, permission denial and cancellation, is silently unreachable. It was
found by instrumenting the responder, seeing the file it wrote stay empty while turns succeeded,
and then grepping eve's `dist` for the string `"structured-output"` that appeared in the output.

`startEveDevServer()` therefore strips `NODE_ENV` and `EVE_MOCK_AUTHORED_MODELS` from the child,
alongside `AI_GATEWAY_API_KEY` and `VERCEL_OIDC_TOKEN`.

The silver lining for §15.6: a fixture does **not** need to script eve's synthetic `final_output`
tool by name. `apps/eve-fixture-agent` finds it by eliminating its own authored tools from
`request.tools`, which needs no internal name and survives a rename.

### 16.3 `eve/bin/eve.js` is not a declared subpath

`require.resolve("eve/bin/eve.js")` fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`. `eve/package.json`
**is** exported, and its `bin` field is `{"eve": "./bin/eve.js"}`, so the helper resolves the
manifest and joins. That stays inside the public surface, which `require.resolve` on the binary
path would not.

### 16.4 Confirmations

Everything else in §§1-15 held in implementation:

- `MessageResult.status` is useless as a discriminator; branching on turn boundary events and
  `isTurnFailureEvent` is correct (§15.7).
- `response.cancel()` is real and fast. A contract test against a tool sleeping 30 s resolves
  `aborted` in well under a second of the abort.
- `clientContext` arrives as a second user-role message and is excluded from
  `MockModelRequest.userMessages`' authored view but present in `messages`.
- A mocked tool call does round-trip as `actions.requested` / `action.result`, and the synthetic
  output tool does not, so it pollutes neither the tool count nor the permission check.
- No `costUsd` appears for a mock model, confirming cost is a Gateway artefact.
- `defaultTools: false` leaves exactly the authored tools; `eve info --json` reported 2 for the
  fixture and 2 for the example agent after `load_skill` was re-added by one-line re-export.

### 16.5 Outside eve: Node 24 does not rewrite `.js` to `.ts`

Not an eve finding, but it shaped `pnpm example:run`. Node 24.21.0 strips types, and does **not**
resolve a relative `./a.js` specifier to a sibling `./a.ts`:

```sh
$ printf 'export const a = 1;\n' > a.ts
$ printf 'import { a } from "./a.js";\nconsole.log(a);\n' > b.ts
$ node b.ts
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/tmp/a.js'
```

Every module in this repository uses the `.js` extension, as `module: nodenext` requires, so
`node src/run.ts` cannot resolve its own imports. `apps/example-agent` compiles `src/` with the
already-pinned `tsc` before `eve build` rather than the repository adding `tsx` or `vite-node`.

### 16.6 Teardown

No `eve dev` process remained (`pgrep -fl "eve dev"` empty), and no `.tmp` directory was left. The
`.eve/` and `.output/` directories under both app roots are git-ignored build artefacts.
