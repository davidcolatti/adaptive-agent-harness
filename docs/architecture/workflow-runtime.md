---
status: active
owner: core
last_verified: 2026-09-20
related:
  - docs/contracts/workflow-ir.md
  - docs/contracts/trace-event.md
  - docs/contracts/execution-context.md
  - docs/contracts/agent-runtime.md
  - docs/contracts/harness.md
  - docs/contracts/capability-registry.md
  - docs/architecture/runtime.md
  - docs/architecture/system-map.md
  - docs/decisions/0040-the-local-workflow-runtime-interprets-a-compiled-workflow-and-escalates-rather-than-fails.md
  - docs/decisions/0038-workflow-ir-lives-in-core-behavior-lives-in-the-workflow-package.md
  - docs/decisions/0039-workflow-validation-is-a-graph-model-with-one-owner-per-node.md
  - docs/decisions/0031-trace-event-taxonomy-recorder-owned-sequencing-and-the-buffered-writer.md
  - docs/decisions/0035-redaction-is-a-trace-writer-decorator-placed-before-buffering.md
  - docs/milestones/build-plan.md
implementation:
  - packages/workflow
---

# Workflow runtime: how a compiled workflow executes locally

[`workflow-ir.md`](../contracts/workflow-ir.md) is the contract for what a workflow *is*. This page
is how `@internal/workflow`'s local interpreter runs one: what it assumes, what a run looks like in
a trace, and what it does when something goes wrong. The decisions behind it are
[ADR-0040](../decisions/0040-the-local-workflow-runtime-interprets-a-compiled-workflow-and-escalates-rather-than-fails.md).

It is the sibling of [`runtime.md`](runtime.md), which describes how `EveAgentRuntime` runs a *job*
through a full agent. The two meet at `AgentRuntime`: a workflow can present itself as one.

## What it is handed, and what it therefore assumes

```ts
const runtime = createWorkflowRuntime({ registry, agentRuntime, decisionEngine });
const result = await runtime.run(compiled, job, context);
```

`compiled` is a [`CompiledWorkflow`](../contracts/workflow-ir.md), and it is the only thing `run()`
accepts. Holding one means the definition parsed, the graph is valid, every capability reference
resolved and the node-level rules hold, so the interpreter assumes all of it and re-checks none of
it. That is how M4-T9's "a workflow with a missing capability MUST fail validation before any node
executes" is a type-level fact rather than a discipline.

The interpreter does resolve capability **values** against the `CapabilityRegistry` it was
constructed with, because a compiled workflow carries metadata and execution needs the handler, the
tool, the policy, the agent and each node's `Schema`. A reference that does not resolve against
*this* registry is a `WorkflowError`, not a schema failure.

Three ports stand in for milestones that have not happened. Each defaults to an in-memory
implementation, because M4-T6 says not to build durability yet:

| Port | Stands in for | Default |
| --- | --- | --- |
| `WorkflowDecisionPort` | M3's `DecisionEngine`, which answers a `jev` node's question | none; a `jev` node without one fails |
| `ArtifactStorePort` | M5's artifact store | a list in memory, ids from a sortable UUIDv7 |
| `ProtectedEffectStore` | M4-T7's protection record | a map in memory, one run's lifetime |

## How a run proceeds

Run state is exactly what the contract says it is — the job's input and a map from node id to that
node's output — plus the current element while execution is inside a `map` body.

The traversal starts at `entry` and follows edges until one ends the segment. **One function serves
the top-level graph and every container's sub-graph**, which is what makes "a container child's
sub-graph ends with `next: null` and control returns to the container" true by construction rather
than by special case.

Per node, per attempt, in this order:

1. **Evaluate the `input` binding** against run state. This happens before the span opens, so the
   started event can carry the input. A binding that cannot be evaluated is a graph defect and fails
   the run (see "When something goes wrong").
2. **Open a `node.started` span** on the run's recorder, with `node` set to the node id.
3. **Validate the input** against the node's resolved `inputSchema`.
4. **Execute**, under a deadline of the node's `timeoutMs`.
5. **Validate the output** against the node's resolved `outputSchema`.
6. **Close the span** with `node.completed` (carrying the output) or `node.failed` (carrying the
   serialized error).
7. **Store the output** in run state and record a `NodeExecutionRecord`.

The workflow's own `inputSchema` is validated before the entry node, and its `outputSchema` after the
terminal one.

### What each node type does

| Type | Executes | Charges | Child events |
| --- | --- | --- | --- |
| `code` | the registered handler, called with **one argument**: its validated input | nothing | none |
| `call` | the registered tool, after the grant check and the protection lookup | one tool call | `tool.started` / `tool.completed` / `tool.failed` |
| `jev` | `decisionEngine.decide({ node, input, context })` | one model call | `decision.started` / `decision.completed` / `decision.failed` |
| `agent` | `agentRuntime.run(derivedJob, derivedContext)` | whatever the sub-execution reported | whatever the adapter emits |
| `artifact` | `artifacts.save(...)`, outputting `{ artifactId, name, contentType? }` | nothing | `artifact.created` |
| `escalate` | nothing; it ends the run with a fallback envelope | nothing | none |
| `chain` | each step in order; outputs the last step's output | its children's | its children's |
| `branch` | reads a label, continues at `cases[label] ?? default`, and outputs **its own validated input unchanged** | nothing | none |
| `map` | the body once per element, bounded by `maxItems` and `concurrency` | its children's | its children's |
| `reduce` | folds the items with the registered handler, from `initial` | nothing | none |
| `loop` | the body until `until` holds, bounded by `maxIterations` | its children's | its children's |

A `branch` label is either a field path read out of the node's validated input, or the return value
of a registered policy called with that input. Either way it must be a string; anything else is a
workflow error. A label with neither a case nor a default is a defect, which the validator's
"a `branch` must have a `default`" rule already prevents.

**A `branch` is pass-through**: it routes rather than computes, so its output is the value it routed,
unchanged. That is why the validator requires a `branch`'s `outputSchema` to be its own
`inputSchema`, and it is what lets the node after a branch bind the branch's output and receive the
thing being decided about rather than a wrapper around a label. The label it chose and the node it
chose (`label` and `target`) appear in the node's `node.completed` payload, which is the only place
they are needed: that is what makes the route visible in a trace and in `pnpm harness run show`.

A `loop`'s `until` is evaluated against the **body's latest output**. A loop that reaches
`maxIterations` without satisfying its condition fails: `until` is the intent and `maxIterations` is
the guarantee, so reporting the last iteration as the answer would be a success the workflow never
earned.

## The trace a workflow run produces

The interpreter records through the run's **existing** `TraceRecorder` (`context.trace`) and never
creates one. A run has one total order and one owner of `sequence`
([ADR-0031](../decisions/0031-trace-event-taxonomy-recorder-owned-sequencing-and-the-buffered-writer.md));
a workflow is part of a run, not a second run beside it. It emits no `run.*` events, because those
belong to `createHarness()`.

Every event it emits carries `TraceEvent.node` — the field ADR-0031 typed and left `null` until this
milestone.

A workflow that classifies with `jev`, routes on the label, researches with an `agent`, stores the
notes, checks them with a read-only `call` and finalizes with `code` produces exactly this, under a
`run.started` the harness opened:

```text
seq  type                node       parent
0    node.started        classify   run.started
1    decision.started    classify   node.started(classify)
2    decision.completed  classify   decision.started
3    node.completed      classify   node.started(classify)
4    node.started        route      run.started
5    node.completed      route      node.started(route)
6    node.started        research   run.started
7    node.completed      research   node.started(research)
8    node.started        keep       run.started
9    artifact.created    keep       node.started(keep)
10   node.completed      keep       node.started(keep)
11   node.started        check      run.started
12   tool.started        check      node.started(check)
13   tool.completed      check      tool.started
14   node.completed      check      node.started(check)
15   node.started        finalize   run.started
16   node.completed      finalize   node.started(finalize)
```

Three things to read out of it:

- **A node's work hangs off its node span.** `decision.*`, `tool.*` and `artifact.created` are
  children of the node that caused them, so a reader can attribute every call to a node without
  consulting the IR.
- **Top-level node spans are siblings**, parented on the run root. Nesting expresses containment, not
  sequence; sequence is `sequence`.
- **The `agent` node emits nothing of its own.** Every `AgentRuntime` adapter already opens and
  closes its own `agent.started` span, so the interpreter does not emit a second pair. The cost is
  that the adapter parents that span on the run root rather than on the node span, because it has no
  way to know it is inside a node. The node span still brackets the sub-run in sequence order.

### `node.*` payloads carry input and output

ADR-0031 made trace payloads identity-only. **ADR-0040 amends that for `node.*` events**, and for
those three event types only:

```json
{ "nodeId": "classify", "type": "jev", "version": "1.0.0", "attempt": 1,
  "idempotencyKey": "<run>:<workflow>@<version>:classify:-:1", "itemIndex": null,
  "input": { "vendor": "acme" } }
```

`node.completed` carries `output` the same way. The reasons are that M4-T6 requires the runtime to
"persist node result" and nothing else persists one in M4, that M6's replay needs the values, and
that redaction is a `TraceWriter` decorator placed **above** the buffer
([ADR-0035](../decisions/0035-redaction-is-a-trace-writer-decorator-placed-before-buffering.md)), so
a secret is stripped before anything is written. A value JSON cannot represent is recorded as
`{ "unserializable": "<typeof>" }` rather than failing the event.

## Budgets

The run's budget and every enclosing node's budget are in play at once, as a stack of scopes. A
charge is applied to every open scope and then checked against every open scope, so **a node budget
measures what that node's execution consumed including anything nested inside it**. That is what
makes a container's budget mean something: a `map` with `maxToolCalls: 10` limits the whole fan-out,
not the zero calls the `map` node itself makes.

Charges happen **before** the work, so a budget prevents a call rather than reporting it afterwards.
`costUsd` stays absent until something reports one, because a local handler genuinely has no cost and
`0` would be a measurement rather than an absence.

`maxDurationMs` is **checked at node boundaries, not enforced as a mid-node deadline**. The hard,
interrupting deadline is the node's own `timeoutMs`; a duration budget that expires mid-node stops
the run at the end of that node. That is the honest behaviour for a runtime that cannot interrupt a
handler it did not write.

Exceeding any budget escalates with `budget-exceeded` and is never retried, because a budget that
ran out does not refill.

## Timeouts

Each attempt gets `AbortSignal.timeout(node.timeoutMs)`, folded together with `context.signal` by
`AbortSignal.any` (both Node 24 built-ins). The interpreter then **races** the work against that
signal rather than cancelling it: a `code` handler or a tool is a plain function under no obligation
to watch a signal, so the runtime can stop waiting but cannot stop the work. Whether the run's own
signal or the deadline fired decides whether the result is `aborted` or a timed-out attempt.

A timeout is a failed attempt: it is retried like any other, and if it is the last failure the
escalation reason is `timeout` rather than `node-failed`.

## Retries

`retry.maxAttempts` attempts, with `retry.backoffMs` between them through an injectable `sleep`
(`createFakeClock()` schedules nothing, so a deterministic retry test supplies the waiting as well as
the time). **Every** failed attempt closes its own span with `node.failed` and the serialized error,
not just the last one, which is what makes "a failed node is visible in the trace" true of a node
that eventually succeeded.

Two failures are never retried, for the same reason — retrying cannot change the answer:
`BudgetExceededError` and `PermissionDeniedError`.

## Idempotency

Every node execution has **two** keys, and one is the other's prefix:

```text
attempt:    ${runId}:${workflowId}@${workflowVersion}:${nodeId}:${itemIndex ?? "-"}:${attempt}
protection: ${runId}:${workflowId}@${workflowVersion}:${nodeId}:${itemIndex ?? "-"}
```

The first is build plan M4-T7's formula verbatim and identifies one **attempt**; it is what
`node.started` carries. The second drops the attempt and is what protection uses, because protection
exists so that a *retry* does not repeat a side effect — and a retry is by definition a different
attempt, so a key containing it would never match.

A `call` node that declares `protection` looks its logical key up before calling:

- **hit**: the recorded value is returned, **no tool call is charged**, and a
  `tool.started`/`tool.completed` pair is recorded with `replayed: true`, so a reader sees that
  protection fired and the ledger does not count a call that did not happen;
- **miss**: the tool is called and its result is recorded **before** the output is validated, because
  the store answers "did this side effect happen?" and by that point it has.

Inside a `map`, the item index is part of both keys, so each element is protected separately.

## Tool grants

Two checks, both before anything runs and both failing closed:

1. **Every node's own `permissions` must be a subset of the job's**, whatever the node's type. A node
   granting a tool the job does not, or `write` where the job granted `read`, is a
   `PermissionDeniedError` and nothing executes. A workflow may not widen what the job was allowed to
   do. Scope is compared conservatively: an unnarrowed job grant covers any node scope, a narrowed
   one covers only the identical scope.
2. **A `call` node may call only a tool its own grants cover**, at the mode the call's `effect`
   requires: `read-only` needs `read`, both writes need `write`, a `write` grant satisfies a `read`
   request and a `read` grant never satisfies a `write` one. The check happens before the tool is
   resolved and before any `tool.started` exists, so a denied call leaves a record of being refused
   and never of being attempted.

An `agent` node's sub-run receives a derived job and a derived context carrying the **node's**
permissions and budget, not the job's. The adapter is the thing that enforces permissions, and it is
told the narrower truth. A `code` node is called with one argument, its validated input: no context,
no registry, no tool table, no signal.

## When something goes wrong

A run ends in one of four states:

| Status | When | Carries |
| --- | --- | --- |
| `completed` | the graph reached a terminal node and its output validated | the output |
| `escalated` | an `escalate` node, an exhausted node, a budget, or the workflow's own contract | a `FallbackContext` |
| `aborted` | `context.signal` fired | nothing |
| `failed` | a **defect** the validator should have prevented | the serialized error |

**Escalating rather than failing is the point.** North-star invariant 1 is that a domain can always
fall back to its full agent, and a node that could not do its job is exactly the case the fallback
exists for. `failed` is reserved for defects — a binding that reads a node which has not run, an
`item` binding outside a `map`, a node id no node answers to — because reporting one of those as a
fallback would hide a bug behind a working system.

The reason is one of the closed **eight** the build plan names (M5-T4, ADR-0044). The interpreter
maps its own causes onto them: an `escalate` node is `unsupported_case`; a budget or a node timeout
is `budget`; a schema failure, at a node or at the workflow's own contract, is `schema_mismatch`; a
denied permission is `policy`; an exhausted `call` node is `tool_failure`; anything else that
exhausted its retries, including a `jev` node whose engine produced no usable answer, is
`workflow_error`. `low_confidence` and `missing_evidence` are **never** raised here: they are policy
outcomes, and a decision that could not be obtained is not a low-confidence one, because no judgment
was made. An escalation raised inside a container node passes through it unchanged, so the reason the
node that actually gave up chose is the one that reaches the envelope.

Beside the reason the envelope carries `detail`, one line of free text saying what actually happened
— an `escalate` node's authored prose, or the message of the error that exhausted a node — and
`nodeId`, the node that gave up or `null` when the workflow itself did. Nothing compares `detail`,
so it is free to be specific.

`completedNodes[].trusted` is decided by **who produced the value**, not by whether it validated —
everything listed validated, or it would not be there:

| Trusted | Not trusted |
| --- | --- |
| `code`, `artifact`, `chain`, `branch`, `map`, `reduce`, `loop` | `agent`, `jev` |
| a `read-only` `call` | an `idempotent-write` or `non-idempotent-write` `call` |

Deterministic harness-side computation over already-validated inputs is trusted. A read-only call
observed the world and changed nothing. A write call is not trusted because a retry, a partial write
or a protected replay all mean the world and the recorded value may disagree. `agent` and `jev` are
not trusted because they are probabilistic: a schema says an answer is well shaped, not that it is
right.

An `escalate` node is **not** listed in `completedNodes` at all. It completes — it ran, and its span
closed — but it produces a `FallbackContext` rather than a value, so there is no output for
`outputRef` to point at, and a reference that resolved to nothing would be worse than an omission.

`evidenceRefs` holds `artifact:<id>` for every `artifact` node the run completed, read off the node's
own validated output. A workflow with no `artifact` node produces an empty list, which is the honest
answer: an invented reference would be worse than none, because the agent would follow it.

## What happens after an escalation

The interpreter's job ends with the envelope. Who receives it is the **router**'s
(`createRouter()` in `@internal/registry`, M5-T3), and the two halves meet through one trace span.

```text
                    interpreter                      router
                        │                              │
  node gives up ────────▶ build FallbackContext        │
                        │ record `fallback.started` ───▶ fallbackSpanId
                        │ return `escalated` ──────────▶ recalculate remaining budget
                        │                              │ build the agent's context:
                        │                              │   fallback = envelope
                        │                              │   budget   = what is left
                        │                              │   trace    = same recorder, rootId = span
                        │                              ▼
                        │                        fullAgent.run(job, context)
                        │                              │  agent.* / model.* / tool.*
                        │                              │  parented on `fallback.started`
                        │                              ▼
                        │                        record `fallback.completed`
```

The interpreter records `fallback.started` because only it knows **why** the path stopped, and
returns that event's id on `EscalatedWorkflowRun.fallbackSpanId`. The router records
`fallback.completed` because only it knows **what happened next**. Neither emits the other's event,
and there is still exactly one recorder and one sequence for the run (ADR-0031).

The original `Job` is handed to the agent unchanged. Everything the fallback adds lives in the
context, which is why `ExecutionContext` — and not `Job` — is where `fallback` sits. See
[`../contracts/workflow-registry.md`](../contracts/workflow-registry.md) for the router and
[ADR-0044](../decisions/0044-the-router-is-an-agentruntime-and-a-fallback-travels-in-the-execution-context.md).

## Running a workflow through the harness

`harness.run()` drives exactly one `AgentRuntime`, and the one to give it is the **router**:

```ts
const harness = createHarness({
  agentRuntime: createRouter({ registry, capabilities, workflowRuntime: runtime, fullAgent }),
  trace,
  storage,
});
```

Trace, storage and `pnpm harness run show` work unchanged, because from the harness's point of view a
router is just another thing that runs a job — and so is a workflow.

`asAgentRuntime()` presents **one** compiled workflow the same way:

```ts
const harness = createHarness({ agentRuntime: runtime.asAgentRuntime(compiled), trace, storage });
```

The execution reports
`runtime: { name: "@internal/workflow", version, metadata: { workflowId, workflowVersion, workflowFingerprint } }`.
`completed`, `failed` and `aborted` map across directly. **An escalation maps to a failed
execution** carrying a `WorkflowError` whose `details.fallback` is the envelope as JSON, because
this method has no full agent to hand the job to — it presents one workflow and nothing else. That
is the honest record of a fallback with nowhere to go, and such a run shows `fallback.started` with
no `fallback.completed`. Anything that should actually fall back uses the router.

## What it deliberately does not do

- **No durability.** M4-T6 says not to build it. A node result lives in run state, in the returned
  result and in the trace; a crashed process loses it.
- **No routing.** Which workflow handles a job, and who receives the envelope after an escalation,
  belong to the router (`@internal/registry`). The interpreter builds the envelope and records
  `fallback.started`; it never chooses a workflow and never invokes a full agent.
- **No `run.*` events, and no recorder of its own.** Those belong to the harness.
- **No re-validation of the graph.** That is the validator's, and `CompiledWorkflow` is the proof it
  ran.
