---
status: accepted
date: 2026-09-19
deciders: project owner (orchestrator); recorded during M1-T6
related: [0003, 0010, 0012, 0024, 0025, 0026, 0027]
supersedes: null
superseded_by: null
---

# ADR-0028: `EveAgentRuntime` is a URL-only client that observes the eve event stream

## Context

M1-T6 implements `EveAgentRuntime`, the first `AgentRuntime` (ADR-0003). The research
checkpoint for it is
[`docs/research/vercel/2026-09-19-m1-eve-programmatic-execution.md`](../research/vercel/2026-09-19-m1-eve-programmatic-execution.md),
which established from `eve` 0.63.0's own docs and declaration files that the harness faces
four problems the framework does not solve for it.

**There is no in-process run API.** `eve`'s root entrypoint exports four `define*` helpers and
nothing that runs a turn. The documented programmatic surface is `eve/client`, a typed HTTP
client that talks to a running server, and `eve/evals` is not an alternative: "An eval target is
always an HTTP URL" (`$EVE/docs/evals/targets.mdx`). eve's own Next, Nuxt and SvelteKit adapters
spawn `eve dev --no-ui --port 0` as a child process. So something must own a server, and the
harness owns the choice of what.

**There is no caller-supplied tool policy.** `SendTurnOptions` carries `turnPolicy`,
`clientContext`, `outputSchema`, `streamReconnectPolicy`, `signal` and `headers`, and no tool
field. Dynamic tool resolvers are authored files whose inputs are session auth, channel metadata
and messages, never a caller's grants. Hooks are observe-only and run after an event is durably
recorded.

**There is no per-run budget.** `agent.ts` has `limits.maxInputTokensPerSession`,
`maxOutputTokensPerSession` and `maxTokenCostUsdPerSession`, all authored, all per session, all
token or cost only. There is no `maxModelCalls` or `maxToolCalls`, and the documented behaviour on
breach is a human continuation prompt, which a headless harness cannot answer.

**There is no aggregate usage.** eve reports usage per `step.completed`, and exposes no turn
duration at all.

Two further facts came out of running a real server offline against a `mockModel` fixture
(research note §15). `MessageResult.status` was `"waiting"` for a successful turn, a failed turn
and a cancelled turn alike, so it describes where the session ended rather than how the turn
ended. And a turn's `outputSchema` is served by a synthetic tool whose name appears in no document
and no declaration file.

## Decision

`EveAgentRuntime` MUST be constructed with a base URL (or an injected client-like object) and MUST
NOT spawn, supervise or terminate any process. Obtaining a server is the caller's responsibility.
A separate helper, `startEveDevServer()`, MUST live behind the `@internal/runtime-eve/testing`
subpath rather than in the package's main entrypoint, and is the supported way for a test or a
demonstration to obtain one.

The adapter MUST observe a run through the `eve/client` event stream, consumed live with
`for await` rather than through `MessageResponse.result()`.

**This ADR amends ADR-0012.** That decision's wording is "agent-runtime observation MUST go
through `eve/hooks`". It is amended to read: *agent-runtime observation MUST go through the
documented eve event stream, via `eve/hooks` in-process or via `eve/client` from a caller.* The
underlying rule, normalize the documented event stream rather than parse console logs, is
unchanged; `eve`'s own documentation states that the two surfaces carry the same envelope
("Authored hooks receive the same envelope, but observe each event as it is emitted rather than as
it is read"). A hook cannot do this job in any case: it runs inside the server process, so it
holds no reference to the caller's `TraceWriter`, and it fires for every session on the server
rather than for one job.

Structured output MUST be requested per turn with the domain's `outputSchema`, and the result MUST
be read from the structured payload. The adapter MUST NOT fall back to the assistant message when
the payload is absent, and MUST NOT name eve's synthetic output tool anywhere in its code. A
completed turn that produced no payload is a `ValidationError`.

Because `SendTurnOptions.outputSchema` is typed `StandardJSONSchemaV1 | JsonObject` while
ADR-0027's `Schema<T>` is Standard **Schema** v1, the adapter MUST lower the domain schema to a
plain JSON Schema object itself, through the Standard JSON Schema converter the schema publishes.
A domain whose schema publishes no converter fails before a turn starts.

A job MUST be presented as `message` = `job.objective` and `clientContext` =
`{ jobId, domain, jobType, input }`. Neither may carry a secret; both reach the model.

Terminal state MUST be decided on turn boundary events and `isTurnFailureEvent`, never on
`MessageResult.status`.

Per-run permission enforcement MUST be performed by observation: on `actions.requested`, each
tool name is compared with `ExecutionContext.permissions`, and an ungranted tool cancels the turn
and fails the run with `PermissionDeniedError`. **This is detection, not prevention**, and MUST be
documented as an M1 limitation wherever it is described. The upgrade path is M2/M5: a channel
`AuthFn` minting a short-lived per-run token whose claims carry the job's grants, plus a per-tool
`approval` policy that denies an ungranted call before it executes.

`Job.budget` enforcement MUST live in the adapter, counting `step.completed` as model calls and
`action.result` as tool calls, measuring duration with the harness clock, and enforcing cost only
when a cost was reported. Retried steps are counted; the figure is provider-attempted usage,
because eve records no attempt identity and over-reporting cost is the safe error.

`context.signal` MUST be propagated twice: passed to the client calls, and used to trigger
`response.cancel()` so the durable run stops rather than only the transport.

Each run MUST use one fresh session and MUST NOT reset it afterwards.

The adapter MUST emit one `TraceEvent` per stream event, typed `eve.<event type>`, whose payload
is a whitelisted projection carrying the event's identity, coordinates, model id, usage, tool
names, action status and failure code, and **no message content, tool input, tool output or
structured result**. M2-T9 owns redaction; until it exists the adapter carries nothing that would
need it.

The `mockModel` fixture agent MUST be its own workspace package under `apps/`, because an eve app
root is the nearest enclosing `package.json` and eve only recognizes the project once `eve` is in
its dependencies.

## Consequences

### Positive

- `createHarness()` never acquires a process lifecycle, port allocation or zombie cleanup, and a
  caller pointing the harness at a deployed agent uses the same adapter as one pointing it at a
  local dev server.
- Every enforcement point the harness cares about (permissions, budget, cancellation, usage,
  trace) is in the harness's own process, synchronous with the run, and unit-testable by faking
  the transport alone. The adapter's unit suite needs no server and no credential.
- `apps/eve-fixture-agent` makes the contract suite credential-free, so `pnpm check` exercises the
  real adapter against a real eve server on any machine.
- Nothing from `eve` crosses the package boundary: session and turn ids travel as opaque strings
  inside `RuntimeInfo.metadata` and trace payloads, which is the boundary ADR-0003 draws.

### Negative

- Permission enforcement is after the fact. An ungranted tool may have executed by the time the
  run fails. North-star invariant 7 is satisfied in spirit only, and is genuinely satisfied only
  once the auth-plus-approval composition lands.
- Somebody must run an eve server. `pnpm example:run` therefore starts one, and a domain
  repository adopting the harness has to decide where its server comes from.
- The lowering step ties the harness to schema libraries that implement Standard JSON Schema v1.
  `zod@4.6.5` does; a Standard Schema implementation that only validates does not.
- Usage over-reports for a retried step, and `durationMs` is the harness's own wall clock rather
  than anything eve measured.

### Neutral

- `startEveDevServer()` strips `NODE_ENV` and `EVE_MOCK_AUTHORED_MODELS` from the child, because
  eve silently replaces every authored model with its own runtime mock when either is set. That is
  undocumented behaviour the helper has to defend against; see the research note and the helper's
  own comment.
- The trace projection is deliberately thin. M2-T3 owns the event taxonomy and the full schema, so
  nothing may branch on these payloads yet.

## Alternatives considered

- **An adapter that spawns and supervises its own `eve dev`**: rejected. It would make
  `harness.run()` a one-liner for a domain author, at the cost of putting process lifecycle, port
  allocation and zombie cleanup inside a runtime adapter, and it would make the adapter useless
  against a deployed agent, which is the case ADR-0002 cares about.
- **`eve invoke` as the programmatic path**: rejected. It is documented, but it is a subprocess
  with a JSON stdout contract, it publishes no TypeScript type for its result, and it offers no
  per-event stream, so the harness could neither trace nor police a run.
- **Parsing the assistant message instead of requesting structured output**: rejected. eve's
  per-turn `outputSchema` is documented and server-enforced, and ADR-0012 requires reusing a
  documented capability rather than rebuilding it.
- **Landing the auth-plus-approval composition in M1**: rejected for scope. It needs
  `agent/channels/eve.ts` with a custom `AuthFn` and an approval policy on every authored tool,
  and it enforces policy inside the agent, where the harness cannot prove it happened. Recorded as
  the M2/M5 upgrade path instead of built early.
- **Making the example agent's model environment-switchable instead of adding a fixture app**:
  rejected. It would keep one app root at the cost of making the shipped example's behaviour
  depend on an environment variable, and it would force `modelContextWindowTokens` into an example
  that otherwise has no reason to carry it.
- **Deriving the output schema from `Job.contracts`**: not yet possible. Those are string
  references and M1-T9's capability registry is what resolves them; the adapter takes the domains
  directly and that option is expected to be replaced.

## References

- `docs/milestones/build-plan.md` §5 (`AgentRuntime`, `Job`), §8 (contract tests), Milestone 1
  (M1-T6)
- [`docs/research/vercel/2026-09-19-m1-eve-programmatic-execution.md`](../research/vercel/2026-09-19-m1-eve-programmatic-execution.md),
  §§1-2, 4-9, 11-12, 15
- [`docs/architecture/runtime.md`](../architecture/runtime.md)
- Related ADRs: 0003, 0010, **0012 (amended by this ADR)**, 0024, 0025, 0026, 0027
- Related code paths: `packages/runtime-eve`, `apps/eve-fixture-agent`,
  `apps/example-agent/src/run.ts`
