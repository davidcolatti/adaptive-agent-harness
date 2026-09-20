---
status: accepted
date: 2026-09-20
deciders: coding agent (M5-T3 through M5-T7); project owner constraints via build plan
related: [0025, 0028, 0031, 0036, 0040, 0043]
supersedes: null
superseded_by: null
---

# ADR-0044: The router is an `AgentRuntime`, and a fallback envelope travels in the execution context

## Context

Milestone 5's first acceptance criterion is that "the same harness call can execute either
workflow or full agent". M4 left two things in the way of it.

The first is `WorkflowRuntime.asAgentRuntime()`. It presents one compiled workflow to
`createHarness()`, which is what let M4 demonstrate a compiled run at all, but it has no full
agent to hand a job back to, so it maps an escalation to a `FailedAgentExecution` carrying the
envelope in a `WorkflowError`'s `details`. ADR-0040 recorded that as an explicit stopgap: "M5's
router replaces its escalated-to-failed mapping." Under it, a job that the compiled path
deliberately declined was reported as a failed run, which is the opposite of north-star
invariant 1.

The second is the fallback vocabulary. `FallbackReason` in `packages/core/src/workflow-ir.ts`
named **six** mechanical ways the interpreter stops — `escalate-node`, `node-failed`,
`budget-exceeded`, `validation-failed`, `decision-failed`, `timeout`. The build plan's M5-T4
names **eight** typed reasons instead — `low_confidence`, `unsupported_case`, `missing_evidence`,
`budget`, `tool_failure`, `schema_mismatch`, `policy`, `workflow_error` — and the two lists do not
name-match one for one. The M5 status file called this out before the work began: M4's list
answers "what did the runtime hit?" and the plan's answers "why could the compiled path not be
trusted with this job?", so reconciling them is a decision rather than a rename.

Three more questions had no recorded answer. Where does the envelope reach the full agent, given
that `Job` is immutable and M5-T6 requires "the full-agent adapter receives the fallback envelope
through its documented runtime boundary"? What links the compiled run span to the fallback agent
execution in one trace? And what does M5-T7's circuit breaker actually do, given AD-005 puts a
human in front of every status change?

## Decision

**1. `FallbackReason` is the build plan's eight, and the interpreter maps onto them.** The union
in `@internal/core` MUST be exactly `low_confidence | unsupported_case | missing_evidence |
budget | tool_failure | schema_mismatch | policy | workflow_error`, in that order.
`escalationReasonFor()` in `@internal/workflow` maps the interpreter's causes:

| Cause in the interpreter | `FallbackReason` |
| --- | --- |
| an `escalate` node | `unsupported_case` |
| `BudgetExceededError`, a node timeout | `budget` |
| `ValidationError`, at a node or at the workflow's own contract | `schema_mismatch` |
| `PermissionDeniedError` | `policy` |
| a `call` node that exhausted its retries | `tool_failure` |
| any other node that exhausted its retries | `workflow_error` |
| a `jev` node whose engine produced no usable answer (`DecisionError`) | `workflow_error` |

`low_confidence` and `missing_evidence` MUST NOT be raised by the interpreter. They are policy
outcomes: a judgment that was made and is not confident enough to act on, and evidence a route
needed and did not get. M3's policy layer is what raises them, and a decision that could not be
obtained at all is a `workflow_error`, because no judgment was made and `low_confidence` would
claim one was.

**2. `FallbackContext` gains `detail: string`, `nodeId: NodeId | null`, and an inline
`output: JsonValue | null` on every completed node.**

The inline output is a **deviation from build plan section 5**, which names only `outputRef`. That
shape assumes the fallback's recipient can dereference a pointer. It cannot: the only channel a
fallback has is the runtime adapter's documented context surface — a turn's `clientContext` for eve
— and what receives it is a model, not a process holding a `Storage` handle. `node:research`
resolves to nothing on the far side of that boundary, so an envelope of references alone would make
M5-T5's "the full agent should not blindly repeat completed research" unachievable in principle
rather than merely unimplemented. The evidence therefore travels **with** the reference, not
instead of it: `outputRef` remains, and remains the durable pointer for a reader that does have the
trace or the store.

`output` is carried for **every** node in `completedNodes`, including untrusted ones, and not only
for `trusted: true` ones. Every entry in that list validated, or it would not be listed, so
M5-T6's "failed/partial node output is not automatically reusable" is enforced by the list's
membership — a failed node is absent, not present with a null output. Withholding an untrusted
node's value would withhold precisely what a full agent most needs to see: an `agent` or `jev`
result is the expensive part of what the compiled path established. `trusted` continues to govern
how the value may be *used*, which is what "the agent is told which is which rather than being
handed a flat list it has to take on faith" has always meant.

**2a. The envelope has a size budget.** The closed reason is
what is stored, aggregated and compared; the free text that a particular stop deserves — an
`escalate` node's authored prose, the message of the error that exhausted a node — lives in
`detail`, which nothing compares. `nodeId` is `null` when the workflow itself stopped rather than
a node. A node whose type is `escalate` MUST NOT appear in `completedNodes`: it produces a
`FallbackContext` rather than a value, so it has no output for `outputRef` to point at.

`FALLBACK_ENVELOPE_MAX_BYTES` is **64 KiB, harness-chosen**. eve documents no limit for
`clientContext`, in its guides or in its types, and an undocumented limit is not an absent one; a
`clientContext` also becomes a context message on every model call of the turn, so an unbounded
envelope is paid for repeatedly in tokens even where it is accepted. When the serialized envelope
exceeds the budget the router drops the **largest** outputs to `null`, largest first, until it
fits: one large drop saves what many small ones would, and the small ones are likelier to be the
deterministic intermediates an agent can act on. `outputRef` and `trusted` survive every drop, and
`detail` names what was dropped, because an agent silently given less than it asked for would
conclude the work was never done.

**3. The router is an `AgentRuntime`.** `createRouter()` in `@internal/registry` returns something
that satisfies `AgentRuntime` and additionally exposes `route(job)`. `createHarness()` is
unchanged and takes no `router` option. Routing MUST be deterministic and MUST make no model
call: it is `registry.resolve(job, env)` over `selectCompatibleWorkflow()`. The active version
MUST be re-resolved on every run; compilation may be cached by version id, routing may not.

**4. The envelope travels in `ExecutionContext`, not in the `Job`.** `ExecutionContext` gains an
optional `fallback?: FallbackContext`. A `Job` is immutable and describes *what* to do; a context
describes *this particular attempt*, which is the same reason `attempt`, `budget` and `signal`
live there. The router builds the fallback attempt's context with the envelope set and with the
budget **recalculated at the moment of handoff** — the job's budget minus what the workflow
actually spent, floored at zero per dimension, with an absent dimension left absent.

**5. An adapter presents the envelope on its framework's own documented surface.**
`EveAgentRuntime` puts it in the turn's `clientContext`, under a `harness.fallback` key, beside
the job it already sends there. eve's shipped docs establish that surface: an object
`clientContext` is "JSON-serialized into one context message", "remains available to every model
call in the turn, then disappears before the next turn", and "isn't persisted to durable session
history" (`eve/docs/guides/client/messages.mdx`; the type is
`string | readonly string[] | JsonObject` in `eve/dist/src/protocol/message.d.ts`). The key name
and the shape under it are **harness-owned**, because eve documents the transport and imposes no
schema on it. The envelope MUST carry references and flags only — node ids, output references,
trust bits, artifact ids, the remaining budget — and never node output, because everything in
`clientContext` reaches the model.

**6. The trace links the two halves through one span.** The interpreter records
`fallback.started` as it already did and now returns its event id on `EscalatedWorkflowRun` as
`fallbackSpanId`. The router runs the full agent against a recorder whose `rootId` is that id, so
the agent's own `agent.*` subtree hangs under the escalation rather than beside it, and then
records `fallback.completed` as a child of the same span. There is still exactly one
`TraceRecorder` and one sequence per run (ADR-0031).

**7. `trusted` keeps ADR-0040's rule.** A completed node's output is trusted when it was produced
deterministically — `code`, `artifact` and every control shape — or by a `read-only` `call`. An
`agent` or `jev` node's output is **not** trusted, however well it validated, and a write `call`'s
is not either. M5-T6's "only successfully validated node outputs may be marked `trusted`" is a
necessary condition; this is the sufficient one.

**8. `AgentExecution` carries the two ledger columns.** It gains optional `workflowVersionId` and
`fallbackCount`, which `createHarness()` copies into `RunFinish`. They are not in `metadata`,
because `metadata` is adapter vocabulary and these are harness columns that two runtimes must not
be free to spell differently. `RunFinish.workflowVersionId` is optional and an absent field leaves
the column as `startRun` wrote it.

**9. The circuit breaker reads, and a human trips it.** `createCircuitBreaker()` evaluates the
last N **finished** runs of one version through `listRuns({ workflowVersionId })` — a new
`RunFilter` field — and reports `{ tripped, fallbackRate, failureRate, sample }`. An empty sample
never trips. `trip()` retires the version through the registry and therefore takes an `actor`.
Nothing calls `trip()` on a timer. Disabling routing needs no cache invalidation, because the
router re-resolves per run.

## Consequences

### Positive

- North-star invariant 1 is now a code path rather than a promise: a domain with a router can
  always fall back, and the escalation arrives informed.
- A job the compiled path declines completes. `pnpm example:run:mock -- --workflow --vendor
  "Aurelia Freight"` exits 0 where it exited 1 under M4, with `fallback_count = 1` and a
  `workflow_version_id` on the ledger row.
- The ledger can answer "is this workflow carrying its weight?" by `group by` over
  `workflow_version_id`, `fallback_count` and `status`, which is what M6 and M7 need.
- `createHarness()` did not change, so every M1-M4 caller still works and the inspector's
  `route:` line shows a version id with no inspector change.
- The eight reasons are the vocabulary a human reads in an aggregate, and `detail` keeps the
  specific case without polluting it.

### Negative

- Node outputs now reach a model. They already passed a domain-authored schema and are the same
  values the workflow's own `agent` node was handed, so this adds no class of content the turn
  would not otherwise see — but it does mean a tool result that reached a node output reaches a
  prompt, and the size budget rather than redaction is what bounds it. A domain whose node outputs
  carry secrets must not put them in a node output, which was already true of the job input.
- The six M4 reason strings are gone. Any stored `FallbackContext` from an M4 run would not parse
  against the new union; none exists outside a test, because M4 persisted no envelope.
- The router reads the registry on every run. That is one indexed query per job, and it is the
  price of a retirement taking effect immediately.
- An adapter that cannot present `ExecutionContext.fallback` on any documented surface silently
  ignores it, and its fallback run is merely no cheaper than a cold one. The contract cannot
  force a framework to have a context slot.
- `fallbackSpanId` widens `EscalatedWorkflowRun`, so the interpreter now hands out a trace
  identifier as part of a run result.

### Neutral

- `asAgentRuntime()` keeps its escalated-to-failed mapping for standalone use, now documented as
  the honest record of a fallback with nowhere to go rather than as a stopgap.
- `low_confidence` and `missing_evidence` are unreachable until M3's policy layer raises them.
  That is a stated reservation, not a gap: an unreachable member of a closed vocabulary is
  cheaper to add now than to add later to stored data.

## Alternatives considered

- **A `router` option on `createHarness()`.** Rejected. It would put routing into the core
  contract every domain depends on, and `registry` sits *below* `core` in the dependency diagram,
  so core would have to learn about workflow versions to use it. An `AgentRuntime` composition
  needs no new core surface and keeps the harness's one-runtime contract intact.
- **Keeping M4's six reasons and adding the plan's eight beside them.** Rejected. Two closed
  vocabularies for one field is the text-matching problem the closed union exists to prevent, and
  M6 would have to compare across both.
- **Renaming M4's six to the plan's words one for one.** Rejected because they do not correspond:
  `node-failed` is two of the plan's reasons depending on whether the node was a `call`, and
  `escalate-node` is a mechanism rather than a reason at all.
- **Carrying `outputRef` alone, as build plan section 5 writes it.** Rejected: nothing on the
  receiving side of any adapter boundary can follow the pointer, which would leave the envelope
  describing evidence the agent cannot reach and the instructions telling it to use what it cannot
  see.
- **Carrying `output` only for `trusted: true` nodes.** Rejected: in the one worked example the
  expensive completed node is `research`, an `agent` node, which ADR-0040 makes untrusted. That
  rule would withhold exactly the result the fallback exists to reuse, while `trusted` already
  tells the agent not to take it on faith.
- **Persisting node outputs and giving the agent a retrieval tool.** Rejected for M5: it is a
  second round trip, a new tool grant and a store the artifact port does not yet have (M4-T6
  explicitly defers durability). The inline envelope needs none of those and is bounded.
- **Putting the envelope in the message text.** Rejected. It would mix the instruction the model
  must act on with the data it acts on, which is the split `jobClientContext()` already makes, and
  a prose rendering of a structured envelope is a second format to keep in sync with the type.
- **Putting the envelope in the `Job`.** Rejected: M5-T6 requires the original job to remain
  immutable, and a job is serialized into the trace and the ledger, where an attempt-scoped value
  does not belong.
- **Letting the runtime emit `fallback.completed` too.** Rejected. The interpreter does not know
  what happens after it gives up, and an event it emitted before the agent ran would have to lie
  about the outcome.
- **A time-based circuit-breaker window.** Rejected. A workflow that runs twice a day and one that
  runs twice a minute need the same number of observations before anyone should conclude anything
  about either.
- **A breaker that retires a version automatically.** Rejected under AD-005: that is the harness
  promoting and demoting its own workflows, which the status model exists to prevent. The router's
  optional `breaker` refuses *traffic* without changing status, which is the reversible half.

## References

- `docs/milestones/build-plan.md` — Milestone 5 (M5-T3 through M5-T7); §5 "Core Contracts",
  the fallback envelope; AD-005, AD-011, AD-015.
- Related ADRs: ADR-0040 (amended: the router, not `asAgentRuntime()`, is the fallback path),
  ADR-0043 (the registry model and the selector), ADR-0031 (the trace taxonomy and the one
  recorder), ADR-0036 (the `runs` ledger), ADR-0028 (the URL-only eve adapter), ADR-0025
  (applications are domain consumers).
- Related code paths: `packages/registry/src/router.ts`,
  `packages/registry/src/circuit-breaker.ts`, `packages/core/src/workflow-ir.ts`,
  `packages/core/src/context.ts`, `packages/core/src/agent-runtime.ts`,
  `packages/core/src/harness.ts`, `packages/core/src/storage.ts`,
  `packages/workflow/src/runtime/workflow-runtime.ts`,
  `packages/runtime-eve/src/eve-agent-runtime.ts`, `apps/example-agent/src/run.ts`.
- Installed dependency evidence:
  `docs/research/vercel/2026-09-20-m5-eve-client-context-for-fallback.md`.
