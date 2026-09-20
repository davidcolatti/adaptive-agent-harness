---
status: accepted
date: 2026-09-20
deciders: core
related: [0028, 0031, 0035, 0038, 0039]
supersedes: null
superseded_by: null
---

# ADR-0040: The local workflow runtime interprets a `CompiledWorkflow`, records into the run's trace, and escalates rather than fails

## Context

Milestone 4 splits into three parts that were built in parallel against one IR: the validator
(M4-T4/M4-T9, [ADR-0039](0039-workflow-validation-is-a-graph-model-with-one-owner-per-node.md)),
the typed DSL (M4-T5, [ADR-0041](0041-the-typed-dsl-is-a-wiring-front-end-that-parses-its-own-ir.md))
and this one: the local deterministic runtime (M4-T6), with the idempotency rules (M4-T7) and the
tool grants (M4-T8) that only mean something once something executes. Together they also complete
the *execution* half of M4-T3 (six node types) and M4-T4 (five control shapes), whose type half
[ADR-0038](0038-workflow-ir-lives-in-core-behavior-lives-in-the-workflow-package.md) already fixed.

The build plan is specific about what the runtime does and terse about how. M4-T6 lists eight
obligations — validate node input, execute node, validate node output, emit trace events, enforce
timeout, enforce budget, follow edges, persist node result — and one prohibition, "do **not** build
durability yet". M4-T7 gives the idempotency key as a formula, "run + workflow version + node +
logical item + attempt", and requires that non-idempotent writes declare explicit protection. M4-T8
gives three sentences: node permissions are explicit, an `agent` node receives only its granted
tools, a `code` node does not inherit agent tools.

What none of them settles, and what this ADR does:

- what the runtime is handed, and therefore what it may assume;
- how a workflow run appears in a trace that already has one owner of ordering (ADR-0031) and an
  identity-only payload rule;
- what "persist node result" means in a milestone that forbids durability;
- which key protects a side effect, given that the plan's one formula contains the attempt number
  and a retry is by definition a different attempt;
- what a node that runs out of retries does, given that north-star invariant 1 is "a domain can
  always fall back to its full agent" and M5's router does not exist yet;
- how the thing gets exercised at all, given that `harness.run()` drives exactly one `AgentRuntime`
  and M5 is what adds a router.

Three collaborators do not exist yet. M3 owns the `DecisionEngine` a `jev` node needs; M5 owns the
artifact store an `artifact` node writes to and the router that consumes a fallback envelope. The
runtime has to be buildable and testable without any of them.

## Decision

### 1. The runtime interprets a `CompiledWorkflow` and nothing else

`createWorkflowRuntime({ registry, ... }).run(workflow, job, context)` accepts a `CompiledWorkflow`
(`packages/workflow/src/compiled.ts`) and MUST assume every guarantee that type's doc comment lists:
the definition parsed, the graph is valid, every capability reference resolved, and the node-level
rules hold. It MUST NOT re-check any of them. That is what makes M4-T9's "a workflow with a missing
capability MUST fail validation before any node executes" a type-level fact rather than a
discipline.

It does resolve capability **values** itself, against the `CapabilityRegistry` it was constructed
with, because a `CompiledWorkflow` carries metadata and the interpreter needs the executable
handler, tool, policy, agent and `Schema`. A reference that fails to resolve against *this* registry
is reported as a `WorkflowError`, not the `ValidationError` the registry throws, so it does not
masquerade as a schema failure.

### 2. Run state is the contract's two things, plus the current `map` element

Run state is exactly what `docs/contracts/workflow-ir.md` says — the job's input and a map from node
id to that node's output — plus the current element and its index while execution is inside a `map`
body. Evaluating a node's `input` binding against that state is a closed five-case `switch` with no
operators, no functions and no conditionals, matching the IR's deliberate refusal to be an
expression language.

Two runtime rules the contract leaves open:

- **A `path` that does not resolve yields `undefined`, and the node's `inputSchema` decides.**
  Reading an absent key, or reading through anything that is not a plain object, is `undefined`
  rather than an error. Schemas stay the single arbiter of a node's input, which is what "every node
  validates inputs and outputs" means, and an optional field behaves the way an author expects.
- **An `item` binding with no `map` element, and a `node` binding naming a node that has not run,
  are `WorkflowError`s that fail the run.** They are graphs the validator is expected to have
  rejected, so they are defects rather than fallbacks (see 6).

An `object` binding **omits** a field whose binding resolved to `undefined`, so the in-memory value
and its serialized form agree before a schema or a trace sees it.

### 3. The runtime records into the run's existing recorder, and `node.*` payloads carry input and output

The runtime records through `context.trace`, the run's `TraceRecorder`, and never creates one. A run
has one total order and one owner of `sequence` (ADR-0031); a workflow is part of a run, not a
second run beside it. It emits no `run.*` events, because those belong to `createHarness()`.

Per node execution it opens a `node.started` span, closes it with `node.completed` or `node.failed`,
and sets `TraceEvent.node` to the node id on every event it emits — the field ADR-0031 typed and
left `null` until this milestone. A node's `tool.*`, `decision.*` and `artifact.created` events are
children of its node span.

**This ADR amends ADR-0031's identity-only payload rule for `node.*` events only.** A `node.started`
payload carries the node's evaluated `input` and a `node.completed` payload carries its validated
`output`, alongside the identity fields (`nodeId`, `type`, `version`, `attempt`, `idempotencyKey`,
`itemIndex`). Three reasons, and the amendment is scoped to these events:

- M4-T6 requires the runtime to "persist node result", and in a milestone that forbids durability
  the trace is the only thing that persists;
- M6's replay compares node outputs, and a trace that recorded only that a node completed could not
  support it;
- redaction is a `TraceWriter` decorator placed **above** the buffer (ADR-0035), so a secret in a
  node's input or output is stripped before anything is written, exactly as it is for a job.

A value JSON cannot represent is recorded as `{ unserializable: <typeof> }` rather than failing the
event: a trace must not break because the thing it describes was odd.

### 3a. A `branch` is pass-through, and its label lives in the trace

A `branch` reads a string label — from a field path over its validated input, or from a registered
policy called with that input — and continues at `cases[label] ?? default`. Its **output is the
value it routed, unchanged**.

That is the reading [ADR-0039](0039-workflow-validation-is-a-graph-model-with-one-owner-per-node.md)
encodes as a validation rule ("a `branch`'s `outputSchema` must be its own `inputSchema`, because a
branch routes rather than computes"), and the two halves have to agree or a compiled workflow could
not run. It is also the better semantics: a node placed after a branch binds the branch's output and
receives the thing being decided about, rather than a wrapper around a label it would then have to
route around to reach the real value.

Neither the label nor the chosen target is in the output at all, so both go into the node's
`node.completed` payload as `label` and `target`. That is the only place they are needed: a reader of
a trace, or of `pnpm harness run show`, can see which way the run went, and nothing downstream has to
carry them.

### 4. Two idempotency keys, one of which is the other's prefix

The runtime derives **both**:

```text
attempt:    ${runId}:${workflowId}@${workflowVersion}:${nodeId}:${itemIndex ?? "-"}:${attempt}
protection: ${runId}:${workflowId}@${workflowVersion}:${nodeId}:${itemIndex ?? "-"}
```

The first is build plan M4-T7's formula verbatim, and it identifies **one attempt**: it is what the
`node.started` payload carries, so two attempts at the same node are distinguishable in a trace.

The second is what a protected `call` node looks a side effect up under, and it deliberately drops
the attempt. Protection exists so that *retrying* a node does not send the same email twice; a key
containing the attempt number differs on every retry and would therefore never match. What must be
stable across the retries of one logical execution is everything except the attempt.

`protection + ":" + attempt === attempt-key`, so one is literally the other's prefix and the
relationship is visible in a trace. Both parse back unambiguously, because no component may contain
a `:`.

A `call` node with a `protection` declaration looks its logical key up **before** calling. A hit
returns the recorded value, charges **no** tool call, and records a `tool.started`/`tool.completed`
pair carrying `replayed: true`, so a reader sees that protection fired and the ledger does not count
a call that did not happen. A miss calls the tool and records the result **before** the output is
validated, because the store answers "did this side effect happen?" and by that point it has.

The store is a `ProtectedEffectStore` port, defaulting to memory. M4-T6 forbids durability, so the
default survives the retries of one run and nothing more.

### 5. Grants are checked twice, before anything runs

- **Every node**, whatever its type, has its own `permissions` checked against the job's before its
  first attempt. A node granting a tool the job does not, or `write` where the job granted `read`, is
  a `PermissionDeniedError` and the workflow may not widen what the job was allowed to do. Scope is
  compared conservatively: an unnarrowed job grant covers any node scope, a narrowed one covers only
  the identical scope, because interpreting a scope string is the tool's job.
- **A `call` node** may call only a tool its own grants cover, at the mode its `effect` requires
  (`read-only` needs `read`; both writes need `write`; a `write` grant satisfies a `read` request and
  never the reverse). The check happens before the tool is resolved and before any `tool.started`
  event exists, so a denied call leaves a record of being refused, never of being attempted.
- **An `agent` node** runs through `options.agentRuntime.run(derivedJob, derivedContext)`, where both
  carry the **node's** permissions and budget rather than the job's. That is M4-T8's "an `agent` node
  receives only its granted tools" made true at the only boundary that enforces it, the adapter.
- **A `code` node** is called with one argument, its validated input. No context, no registry, no
  tool table, no signal: there is nothing for it to reach through, which is stronger than a grant
  list it is trusted to respect.

`PermissionDeniedError` and `BudgetExceededError` are the only two failures that are **not** retried,
for the same reason: retrying cannot change the answer.

### 6. A node that exhausts its retries escalates; `failed` is reserved for defects

`WorkflowRunResult` has four cases, not three:

| Status | When |
| --- | --- |
| `completed` | The graph reached a terminal node and its output satisfied the workflow's `outputSchema`. |
| `escalated` | An `escalate` node was reached, a node exhausted its retries, a budget ran out, or the workflow's own contract failed. Carries a `FallbackContext`. |
| `aborted` | `context.signal` fired. |
| `failed` | A **defect**: a binding that reads a node which has not run, an `item` binding outside a `map`, a `branch` label with neither case nor default, a node id no node answers to. |

Escalating rather than failing is north-star invariant 1 — a domain can always fall back to its full
agent — and a node that could not do its job is precisely the case the fallback exists for. Reporting
a defect as a fallback would hide a bug behind a working system, which is why `failed` exists and is
narrow.

The `FallbackReason` is chosen from the closed six: `escalate-node` for an `escalate` node,
`budget-exceeded` for a budget, `timeout` when the last failure was the node's deadline,
`validation-failed` for a schema, `decision-failed` for a `jev` node, `node-failed` otherwise. An
escalation raised inside a container node passes through it unchanged rather than being re-wrapped,
so the reason the node that actually gave up chose is the one that reaches the envelope.

`trusted` on a completed node is decided by **who produced the value**, not by whether it validated —
everything in `completedNodes` validated, or it would not be there. `code`, `artifact` and every
control shape are trusted, because they are deterministic harness-side computation over
already-validated inputs. A `read-only` `call` is trusted, because it observed the world and changed
nothing. A write `call` is not, because a retry, a partial write or a protected replay all mean the
world and the recorded value may disagree. `agent` and `jev` are not, because they are probabilistic:
a schema says an answer is well shaped, not that it is right, and claiming otherwise is exactly the
over-trust ADR-0005 and north-star invariant 2 exist to prevent.

`evidenceRefs` is empty. M5 persists node outputs and evidence as artifacts; an invented reference
would be worse than none, because the agent would follow it.

### 7. Budgets nest; timeouts interrupt, durations are checked

The run's budget (`ExecutionContext.budget`) and every enclosing node's budget are in play at once,
as a stack of scopes. A charge is applied to every open scope and then checked against every open
scope, so a node budget measures what that node's execution consumed **including** anything nested
inside it. That is the reading that makes a container's budget mean something: a `map` with
`maxToolCalls: 10` limits the whole fan-out, not the zero calls the `map` node itself makes.

A `call` node charges one tool call, a `jev` node charges one model call, and an `agent` node charges
whatever its sub-execution reported. Charges happen **before** the work, so a budget prevents a call
rather than reporting it afterwards. `costUsd` stays `null` until something reports one, because a
local handler genuinely has no cost and `0` would be a measurement.

The hard, interrupting deadline is the node's `timeoutMs`, implemented with Node 24's
`AbortSignal.timeout` folded together with `context.signal` by `AbortSignal.any`. Because a handler
or a tool is a plain function under no obligation to watch a signal, the runtime races rather than
cancels: it stops *waiting*, it cannot stop the work. `Budget.maxDurationMs` is checked at node
boundaries rather than enforced as a mid-node deadline, which is the honest behaviour for a runtime
that cannot interrupt code it did not write.

### 8. `asAgentRuntime(workflow)` is how M4 runs a workflow, and M5 replaces its escalation mapping

`WorkflowRuntime.asAgentRuntime(workflow)` returns an `AgentRuntime`, so
`createHarness({ agentRuntime })` runs a workflow unchanged and trace, storage and
`pnpm harness run show` keep working with no router. It reports
`runtime: { name: "@internal/workflow", version, metadata: { workflowId, workflowVersion, workflowFingerprint } }`.

`completed`, `failed` and `aborted` map across directly. **`escalated` maps to a
`FailedAgentExecution` carrying a `WorkflowError` whose `details.fallback` is the envelope as JSON.**
That is a deliberate stopgap and it is wrong in one way that M5 fixes: an escalation is not a
failure, it is the compiled path saying "hand this to the full agent, and here is what I already
established". `AgentRuntime` has no such status because in M4 there is nothing to hand it to. M5's
router calls `WorkflowRuntime.run()` directly, reads `result.fallback`, and invokes the full agent
with it; nothing else has to change.

### 9. Three ports, all defaulting to memory

`WorkflowDecisionPort` (M3's engine seen from M4, one verb: answer this node's question),
`ArtifactStorePort` (M5's store) and `ProtectedEffectStore` (M4-T7's protection) are plain interfaces
with in-memory defaults. A missing decision engine or agent runtime is a **node failure**, not a
construction error, because a workflow with no `jev` node has no use for one and demanding it would
force every caller to supply a stub it never calls.

An artifact id is a plain string, not a branded entity id: ADR-0030 defines twelve brands and an
artifact is not one of them, and minting a thirteenth here would be M5's decision made by M4. The
default store mints a sortable UUIDv7 and discards its brand.

### 10. No durability

A node result lives in run state, in the returned `WorkflowRunResult` and in the trace. A crashed
process loses it. M4-T6 says so, and M5 and M6 are what change it.

## Consequences

### Positive

- The runtime cannot execute an invalid workflow, because the only thing it accepts is the
  validator's output.
- A workflow run is one ordered narrative in the existing trace, so `pnpm harness run show` and every
  M2 sink work on it with no change.
- "A retry does not duplicate a protected side effect" is provable, and the test proves the useful
  version of it: the first attempt reaches the world and *then* fails.
- An `agent` node's grant list is narrower than the job's at the boundary that enforces it, so "an
  agent node cannot call an ungranted tool" holds whichever adapter runs.
- `escalated` as its own status keeps M5's "is this workflow carrying its weight?" question
  answerable, which collapsing it into `failed` would not.
- Every port a later milestone owns is an interface with a default, so M3 and M5 attach without the
  interpreter changing.

### Negative

- **`node.*` payloads now carry content**, so a workflow run's trace is larger than an agent run's
  and depends on redaction (ADR-0035) being configured to stay safe. ADR-0031's rule is no longer
  universal, which is a second thing a reader has to know.
- **The `agent.*` events of an `agent` node's sub-run are parented on the run root, not on the node
  span.** An `AgentRuntime` adapter has no way to know it is inside a node, and the alternative was
  to emit a second `agent.*` pair and double-count. The node span still brackets the sub-run in
  sequence order, so the nesting is recoverable, but it is not expressed in `parentId`.
- **`escalated` maps to `failed` through `asAgentRuntime`,** so until M5 a run ledger records an
  escalation as a failed run. The envelope is in the error's `details`, so nothing is lost, but the
  ledger's `success` column is misleading for that case.
- **`maxDurationMs` is a boundary check, not a deadline.** A single node that runs long overruns a
  duration budget until it finishes or hits its own `timeoutMs`.
- **A node budget is measured per attempt, not per node.** Each attempt opens a fresh node scope, so
  a node with `maxToolCalls: 1` and `maxAttempts: 3` may make three calls across three attempts. That
  is the right reading for a limit on one execution, and it is not the only possible one.
- **A protected replay still records a `tool.*` span.** It is honest — the payload says `replayed` and
  the usage says zero — but a naive count of `tool.started` events overstates the calls made.

### Neutral

- A container node's sub-graph runs through the same traversal function as the top-level graph, so
  "a child's sub-graph ends with `next: null` and control returns to the container" is true by
  construction rather than by special case.
- A `loop`'s `until` is evaluated against the body's latest output, and `LoopUntilField.equals` is
  compared as canonical JSON text so a non-scalar `equals` works.
- A defensive ceiling of 100,000 visited nodes exists in the traversal. It is unreachable for a
  validated graph and is there so a broken guarantee stops with a named error rather than spinning.
- The shared test fixtures live in `src/runtime/test-fixtures.ts`, an ordinary module excluded from
  the package build, so importing them does not re-run another file's suite and test-only code never
  reaches `dist/`.

## Alternatives considered

- **Re-validate the definition inside the runtime.** Rejected: it would duplicate the validator, and
  it would make `CompiledWorkflow`'s guarantees advisory rather than structural. The whole reason
  that type exists ahead of both halves is to make the handoff a type-level fact.
- **One idempotency key, exactly as the build plan writes it.** Rejected after working it through:
  the plan's formula contains the attempt, a retry is a different attempt, so protection keyed on it
  would never match and "a retry does not duplicate a protected side effect" would be false. Keeping
  both, with one as the other's prefix, satisfies the plan's formula where it is about identity and
  fixes it where it is about protection.
- **Keep `node.*` payloads identity-only, per ADR-0031.** Rejected: M4-T6's "persist node result" and
  M6's replay would then have nowhere to read a node output from, in a milestone that forbids
  durability. The alternative was to build a durable node-execution table, which M4-T6 explicitly
  defers.
- **Report an exhausted node as `failed`.** Rejected: north-star invariant 1 is that a domain can
  always fall back to its full agent, and a node that could not do its job is the canonical reason
  to. `failed` stays for defects, where there is nothing to fall back *from*.
- **Add an `escalated` status to `AgentExecution`.** Rejected for M4: it is a core contract change in
  service of a router that does not exist, and M5 is the milestone that knows what the router needs.
  The `WorkflowError` mapping is reversible and carries the whole envelope.
- **A `branch` outputting `{ label }` rather than its input.** That was the shape this task started
  from, and it is wrong in two ways that surfaced together: it contradicts the validator's
  pass-through rule, so a compiled workflow with a branch would not run, and it forces every node
  after a branch to reach around a wrapper to find the value being decided about. The label is
  recorded in the trace instead, with the chosen target beside it, which is the only place that
  wants either.
- **Emit `agent.*` events around an `agent` node's sub-run.** Rejected: every adapter already emits
  its own pair, and a second one would double-count the taxonomy's own accounting.
- **Interrupt work when `maxDurationMs` expires.** Rejected: the runtime cannot interrupt a handler
  that ignores a signal, so it would be a deadline it could not honour. `timeoutMs` is the per-node
  deadline the plan does ask for, and it races rather than pretending to cancel.
- **A structural comparison for `loop.until`.** Rejected as unnecessary: canonical JSON text is exact
  for the scalars that matter and structural for the rest, over a definition that is frozen.

## References

- `docs/milestones/build-plan.md` — Milestone 4 (M4-T3, M4-T6, M4-T7, M4-T8), section 5
  (`Agent runtime`, `Fallback envelope`), AD-013, AD-015
- `docs/contracts/workflow-ir.md` — the data-flow model, the idempotency-key formula, the fallback
  envelope
- `docs/architecture/workflow-runtime.md` — how a run proceeds, with a worked trace
- Related ADRs: ADR-0005, ADR-0009, ADR-0027, ADR-0028, ADR-0030, ADR-0031, ADR-0035, ADR-0038,
  ADR-0039, ADR-0041
- Related code paths: `packages/workflow/src/runtime/`, `packages/workflow/src/compiled.ts`,
  `packages/core/src/workflow-ir.ts`, `packages/core/src/workflow-nodes.ts`,
  `packages/core/src/trace.ts`, `packages/core/src/context.ts`, `packages/core/src/harness.ts`
