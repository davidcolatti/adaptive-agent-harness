# Milestone 4, Workflow IR, DSL, and Local Deterministic Runtime

**Status:** all ten tasks are `completed` (M4-T1 and M4-T2 in commit `4c03e2e`; M4-T3 through
M4-T9 in `0d12b43`; M4-T10 not yet committed), and all eight acceptance criteria are verified with
dated evidence below. Milestone close-out — the `docs/progress/milestones/m4.md` snapshot and the
`current-state.md` rewrite — is the only thing left.

**Goal (from the build plan):** create the inspectable compiled representation before attempting
automatic compilation. Humans should be able to author workflows first.

**Blocked by:** M2 (complete). M4-T3's `jev` node additionally depends on M3 for the node to be
able to *execute*; a fake decision port stands in for M3 until then.

**Parallel work:** runtime, validator, DSL and fixture workflow can be split after the IR
stabilizes.

**Deliverable:** the first inspectable compiled workflow.

## Before starting

These prerequisites come from the current state of the code and from the build plan's own notes
about this milestone. Read them before opening any M4 task.

- The trace taxonomy in `packages/core/src/trace.ts` already reserves `node.started`,
  `node.completed`, `node.failed`, `artifact.created`, `fallback.started` and
  `fallback.completed`, and `TraceEvent.node` is typed `string | null` and is always `null` today.
  M4-T6 is what fills `node` and starts emitting the `node.*` events; no new event types are
  needed for this milestone.
- The capability registry (`packages/core/src/capabilities.ts`, M1-T9) already has the five kinds
  (`schema`, `agent`, `tool`, `handler`, `policy`), a `resolve()` method, a `has()` method and a
  fingerprinted manifest. M4-T9 resolves capability references against this registry and must not
  create a second one. A Jev *question* is not a capability kind — M3 owns questions — so a `jev`
  node names a question rather than resolving a capability.
- `packages/workflow` is listed as planned (M4) in `docs/architecture/system-map.md`, but it has
  no entry in `BOUNDARY_RULES` in `tests/architecture/boundaries.ts` yet. It must be added there
  when the package is created, the same way `@internal/trace` and `@internal/observability` were
  reserved ahead of their milestones: as a non-adapter carrying core's bans (it is not an adapter
  package).
- The IR is fingerprinted with the existing canonical JSON plus `sha256:` scheme
  (`packages/core/src/fingerprint.ts`, ADR-0029). `BehaviorDescriptor` already has a `workflowIr`
  component slot (`packages/core/src/behavior.ts`), typed to accept a JSON value or `null` until a
  compiled workflow exists. No new hashing scheme is needed for this milestone.
- The build plan's parallel-work note fixes this milestone's orchestration: Phase 1 is M4-T1 and
  M4-T2 (the IR in core, and the `packages/workflow` scaffold); Phase 2, run in parallel once
  Phase 1 stabilizes, is the validator (M4-T4 and M4-T9), the runtime (M4-T6, M4-T7 and M4-T8) and
  the DSL (M4-T5); Phase 3 is the hand-authored vendor workflow (M4-T10) and acceptance
  verification.
- `harness.run()` (`packages/core/src/harness.ts`) drives exactly one `AgentRuntime`; M5 is what
  adds the router. In M4, the workflow runtime can be exercised through the existing harness by
  exposing it as an `AgentRuntime`, so trace, storage and `pnpm harness run show` keep working
  unchanged. This is a design option for the runtime task, not a decision made yet.
- M4-T3's `jev` node cannot *execute* until M3 lands a `DecisionEngine`. M4's own tests use a fake
  decision port instead. The build plan states this directly: "Jev node completion additionally
  depends on M3."
- Pre-assigned ADR numbers for this milestone: **0038** (IR shape and placement, M4-T1/M4-T2),
  **0039** (validation and canonicalization, M4-T4/M4-T9), **0040** (local runtime, idempotency
  and grants, M4-T6/M4-T7/M4-T8), **0041** (DSL, M4-T5). `pnpm check:handoff` fails on a WORKLOG
  entry referencing an ADR that does not yet have a file under `docs/decisions/`, so each task
  writes its own ADR before its WORKLOG entry is marked `completed`.
- Every framework-facing task needs an "Implementation references" checkpoint in the WORKLOG
  before code, per AD-011. M4 is expected to touch no third-party framework — the runtime is a
  local interpreter — so this applies only if a task ends up touching `eve`, `ai`, Supabase or the
  Workflow SDK.

## Tasks

### M4-T1, Serializable IR

**Status:** completed (2026-09-20).

Define versioned IR.

Example:

```ts
type WorkflowDefinition = {
  schemaVersion: 1;
  id: string;
  domain: string;
  jobType: string;
  inputSchema: string;
  outputSchema: string;
  entry: NodeId;
  nodes: Record<NodeId, WorkflowNode>;
};
```

**Result.** `packages/core/src/workflow-ir.ts` holds `WorkflowDefinition`, `WORKFLOW_SCHEMA_VERSION`,
`FallbackReason`/`FALLBACK_REASONS`/`FallbackContext`, the strict parse boundary
`parseWorkflowDefinition()` (the `parseJob()` sibling), the pure predicate `isWorkflowDefinition()`,
`canonicalWorkflowIr()` and `workflowFingerprint()`. Placement follows ADR-0038: the contract lives
in `@internal/core`, which stays zero-dependency, and behavior over it (validation, the DSL, the
runtime) lives in the new `@internal/workflow` (`packages/workflow`), scaffolded in this task with
one export, the `CompiledWorkflow` interface. The definition carries two deliberate departures from
the build plan's example, both recorded in ADR-0038: a `version: string` field (exact
`major.minor.patch`, required by M4-T7's idempotency-key formula and `FallbackContext.workflow.version`),
and `domain` staying a plain id rather than a version-pinned `DomainRef`, so a domain version bump
does not silently unmatch every workflow at the router (M5). Nodes live in a flat map keyed by id
rather than a tree, so reachability and duplicate-id checks are questions about one object.
`canonicalWorkflowIr()`/`workflowFingerprint()` parse first, then canonicalize with the existing
`canonicalJson()`/`fingerprint()` (ADR-0029); `workflowFingerprint()` hashes the parsed definition
rather than the canonical string, so the digest is over the same bytes without an extra layer of
JSON-string escaping. `tests/architecture/boundaries.ts` gained `@internal/workflow` in
`forbiddenByPackage` with core's bans, plus a comment that the npm package named `workflow`
(Vercel's durable primitive) stays a separate, adapter-only thing. Documented in
[`../contracts/workflow-ir.md`](../contracts/workflow-ir.md) and recorded in
[ADR-0038](../decisions/0038-workflow-ir-lives-in-core-behavior-lives-in-the-workflow-package.md).
Verification: `pnpm check` PASS (935 passed, 43 skipped across 54 files). Commit `4c03e2e`.

### M4-T2, Node contracts

**Status:** completed (2026-09-20).

Each node defines:

```text
id
type
input schema
output schema
timeout
retry policy
budget
permissions
version
```

**Result.** `packages/core/src/workflow-nodes.ts` holds the node half: `NodeId`/`isNodeId`,
`NODE_TYPES` (eleven), `CONTROL_NODE_TYPES` (five), `RESERVED_NODE_TYPES` (`human`, `subworkflow`),
`CALL_EFFECTS`, `JEV_QUESTION_KINDS`, `BINDING_KINDS`, `MAX_BINDING_DEPTH`, the five-case `Binding`
union, `RetryPolicy`, `NodeProtection`, `NodeCapabilityRef`, `WorkflowNodeBase` (the plan's eight
fields plus a ninth, `input`, a `Binding` naming where a node's input comes from), the eleven node
interfaces and the `WorkflowNode` discriminated union, `BranchSelector`, `LoopCondition`, and the
per-node validate-and-rebuild pass. `Binding` is a closed five-case union over the run state
(`{ input, nodes }`) — `input`, `node` (with an optional `path`), `item`, `literal`, `object` — with
no operators, functions, conditionals, wildcards or array indices, because an expression language in
the IR would be executable content a compiler could invent and a fingerprint could not distinguish
from data (AD-013, ADR-0038). `human` and `subworkflow` are reserved and rejected by name with a
distinct message from "unknown node type." A `jev` node names a question (`{ id, version }` plus
`questionKind`) rather than resolving a capability, because a question is not a `CapabilityKind` and
M3 owns the question contract. The IR stores no idempotency key; the runtime (M4-T6) derives one per
execution from the formula below. Covered by 59 tests in
`packages/core/src/workflow-ir.test.ts` across all eleven node types, every binding kind, both
selector forms, the round trip and deep-freeze, and canonical-JSON key-order independence.
Verification: `pnpm check` PASS (935 passed, 43 skipped across 54 files). Commit `4c03e2e`.

### M4-T3, Node types

**Status:** completed (2026-09-20).

Implement initially:

- `code`
- `call`
- `jev`
- `agent`
- `artifact`
- `escalate`

Reserve but do not implement until needed:

- human
- subworkflow

**Result.** The *type* half of the six executable node types landed with M4-T2; this task is
their **execution** half, in `packages/workflow/src/runtime/`. `code` calls its registered handler
with exactly one argument, its validated input. `call` checks its grants, consults its protection
key, calls its registered tool and emits `tool.*` as children of the node span. `jev` goes through
a `WorkflowDecisionPort` — M3's `DecisionEngine` seen from M4, one verb — and emits `decision.*`;
a runtime built without one reports `decision-failed` rather than refusing to be constructed, since
a workflow with no `jev` node has no use for an engine. `agent` runs a sub-execution through the
supplied `AgentRuntime` under the node's own permissions and budget, emitting no `agent.*` of its
own because every adapter already emits its pair. `artifact` writes through an `ArtifactStorePort`,
emits `artifact.created` and outputs `{ artifactId, name, contentType? }`. `escalate` is terminal
and is **not** a failure: it closes its span as completed and ends the run with a `FallbackContext`.
`human` and `subworkflow` remain reserved and unimplemented, rejected by name at parse.

The five control shapes execute through **one** traversal function that serves the top-level graph
and every container's sub-graph, so "a container child's sub-graph ends with `next: null` and
control returns to the container" is true by construction. A `branch` reads its label from a field
path or a registered policy, continues at `cases[label] ?? default`, and is **pass-through**: it
outputs the value it routed, with the label and target it chose recorded in its `node.completed`
payload, which is what the validator's "a `branch`'s `outputSchema` is its own `inputSchema`" rule
assumes and what lets the next node bind the thing being decided about rather than a wrapper. A `map` is bounded by
`maxItems` and `concurrency`; a `loop` that reaches `maxIterations` without satisfying `until`
fails, because `until` is the intent and the bound is the guarantee.

### M4-T4, Control shapes

**Status:** completed (2026-09-20).

Implement:

- chain
- branch
- map
- reduce
- bounded loop

Validation rejects:

- unreachable nodes
- missing nodes
- incompatible schemas
- cycles not declared as bounded loops
- missing escalation target
- duplicate IDs

**Result.** The *type* half of the five control shapes landed with M4-T2; this task is their
**validation** half, plus the node rules parse deliberately skips, as `validateWorkflow()` in
`packages/workflow/src/validate/` and `compileWorkflow()` in `packages/workflow/src/compile.ts`.
Recorded in
[ADR-0039](../decisions/0039-workflow-validation-is-a-graph-model-with-one-owner-per-node.md) and
documented in the new "Validation and compilation" section of
[`../contracts/workflow-ir.md`](../contracts/workflow-ir.md), which states every rule in one table.

**The graph model is the decision.** Successor edges (`next`, `cases[*]`, `default`) and
containment (`chain.steps[*]`, `map.body`, `loop.body`) are different relations, and a **region**
is the top-level graph or one container child slot plus everything its successor edges reach.
**Every node has exactly one owner**: reached from `entry`, or the child of exactly one container,
never both and never two containers. That is what "duplicate IDs" can mean in an IR whose nodes are
object keys — parse already rejects a key/`id` disagreement — and it is what makes
`{ kind: "item" }` scoping decidable, since "inside a `map` body" becomes a property of the node
rather than of whichever path reached it. Two rules fall straight out: every node must be
reachable, and a container child's subgraph must end with `next: null` (or an `escalate`) rather
than continue into a node it does not own, which is reported with its own message.

**Any cycle is invalid**, and that is the Milestone 4 acceptance criterion "validation rejects an
intentional unbounded cycle" (covered by a test of that name). Repetition is expressed by `map` or
`loop` containment, never by a back edge, so there is no legitimate cycle to distinguish from an
illegitimate one and no judgment call in the one place that must not have one. The message says so.

**"Incompatible schemas" is reference equality on `id@version`.** A schema is an opaque Standard
Schema validator (ADR-0027) and neither core nor this package declares a schema library, so nothing
can compare two structurally. Four pairings are ref-checked — a node reading the whole job input, a
node reading another node's whole output, a top-level terminal node against the workflow's output,
and a `chain` against its last step — and the rest (a binding narrowed by `path`, a `literal`, an
`object`, an `item`, and `map`/`reduce`/`loop` outputs) are the runtime's per-node validation,
because no registered reference can be derived for them.

**A `{ kind: "node" }` binding is checked by dominance**, not by "is an ancestor somewhere": the
referenced node must run on **every** path to the reader. The weaker rule accepts a binding that
reads a sibling `branch` case's output, which is the mistake authors and compiler proposals
actually make and the one that otherwise only appears at run time. Dominance is computed over a
flow graph in which a `chain` enters its first step and each step's terminals flow into the next
(nothing skips a chain's steps), while a `map` and a `loop` flow both into their body and straight
on to their `next` (a body may run zero times).

**Node rules.** Only `agent` and `call` nodes may declare tool grants — M4-T8 states the `code`
case and the IR puts `permissions` on every node, so something had to say where it means anything;
a `call` must grant the tool it calls, with `mode: "write"` for a write effect; a
`non-idempotent-write` must declare `protection` (M4-T7); every `branch` must declare a `default`,
which is M4-T4's "missing escalation target"; and the workflow must contain at least one `escalate`
node reachable from `entry`, which is north-star invariant 1 made checkable.

Verification: `pnpm vitest run --project unit packages/workflow packages/core` passes, 596 tests
across 17 files, 51 of them this task's.

### M4-T5, Typed DSL

**Status:** completed (2026-09-20).

Example:

```ts
export default workflow({
  id: "vendor-triage-v1",
  input: VendorInput,
  output: VendorResult,
})
  .jev("initial-classification", ...)
  .branch(...)
  .agent("research", ...)
  .code("apply-policy", ...)
  .escalate("full-agent");
```

The DSL compiles to IR.

The IR, not builder object identity, is fingerprinted.

**Result.** `workflow()` in `packages/workflow/src/dsl/` is a fluent builder with one method per IR
node type, and it has no runtime meaning of its own: it applies defaults, wires edges, derives
schemas and emits a `WorkflowDefinition`. Nothing downstream ever sees a builder, which is how "the
IR, not builder object identity, is fingerprinted" became a fact about the code rather than a rule
someone has to remember. `build()` returns `parseWorkflowDefinition(ir)`, so a value that leaves the
DSL is already shape-valid and deep-frozen; `toIr()` is the unparsed escape hatch. It never resolves
a capability and never imports `compileWorkflow()` — a DSL that resolved references would need a
registry at import time, which would make a workflow module unloadable without one.

**The common case is correct by construction.** There is no `next` option at all. Nodes added to the
builder form one chain, each node's `next` being the node added after it; `branch` and `escalate`
carry no `next` and therefore end it. A node's `input` defaults to its predecessor's output, its
`inputSchema` is derived from that binding, and a node that ends the main graph takes the workflow's
output schema. Sub-graphs — a branch case, a branch default, a `map` body, a `loop` body, a
`chain`'s steps — are nested builder callbacks that must return the `SubGraphEnd` marker, so
forgetting to terminate one is a type error rather than a dangling edge. A `chain`'s steps are wired
as containment (each terminal on its own) because a step reachable from a sibling's `next` *and*
listed in `steps` would have two owners, which ADR-0039's graph model forbids. `.goto(nodeId)` is
the one way to point at a node another part of the graph owns: it sets an edge, never ownership, it
is allowed only from a branch case or default, and its target may be a forward reference checked at
`build()`.

**The M4-T10 shape needs no wiring written down.** The vendor-triage graph — jev classify, branch to
{clear -> code finalize; research -> agent research -> jev verify -> code decide; default -> escalate}
— is authored in about thirty lines with no `input` binding, no `inputSchema` and no `next`
anywhere. Seven nodes; three state an `outputSchema` because they genuinely introduce one. Handed to
`compileWorkflow()` with the five schemas, two handlers, one agent and one tool registered, it
produces a `CompiledWorkflow` with zero issues, which is the first end-to-end proof that the DSL and
the validator agree.

The five defaults the build plan leaves open are chosen and exported rather than hidden:
`timeoutMs: 60_000`, `retry: { maxAttempts: 1 }`, `budget: {}`, `permissions: []`,
`version: "1.0.0"`. Four are overridable per workflow and per node; `permissions` is the exception,
offered only on `.agent()` and `.call()` and absent from the workflow-level block, so M4-T8's "a
`code` node does not inherit agent tools" is unwritable rather than merely rejected — a
workflow-level default would otherwise have granted a tool to every `code` node. A `call` node that
states none is granted its own tool at the mode its effect needs, which is exactly the grant the
validator requires. A duplicate node id throws from the
method that caused it, naming the id; every other problem is collected and thrown from `build()` as
one `ValidationError` listing all of them. Fifty-seven tests cover the emitted IR field by field,
determinism across two builds, invariance to the order independent settings were written in, a
changed fingerprint when a node's configuration changes, and a JSON round trip — the acceptance
criteria "DSL output can be serialized to canonical IR" and "same IR produces same workflow
fingerprint". Recorded in
[ADR-0041](../decisions/0041-the-typed-dsl-is-a-wiring-front-end-that-parses-its-own-ir.md) and
documented in `docs/contracts/workflow-dsl.md`.

### M4-T6, Local runtime

**Status:** completed (2026-09-20).

Implement a local interpreter for IR.

Do **not** build durability yet.

The runtime must:

- validate node input
- execute node
- validate node output
- emit trace events
- enforce timeout
- enforce budget
- follow edges
- persist node result

**Result.** `createWorkflowRuntime()` in `packages/workflow/src/runtime/`, an interpreter over a
`CompiledWorkflow` **and nothing else**: every guarantee that type's doc comment lists is assumed
rather than re-checked, which is how M4-T9's "a workflow with a missing capability MUST fail
validation before any node executes" becomes a type-level fact. All eight obligations hold — the
node's `input` binding is evaluated against run state, the input is validated, the node executes
under an `AbortSignal.timeout`/`AbortSignal.any` deadline, the output is validated, `node.*` spans
are emitted with `TraceEvent.node` finally filled, budgets are enforced as a nested stack of scopes,
edges are followed, and the result is kept. **No durability**, as the task requires: a node result
lives in run state, in the returned `WorkflowRunResult` and in the trace.

Two decisions beyond the task text, both in
[ADR-0040](../decisions/0040-the-local-workflow-runtime-interprets-a-compiled-workflow-and-escalates-rather-than-fails.md).
First, **`node.*` payloads carry the node's input and output**, amending ADR-0031's identity-only
rule for those three event types only: "persist node result" has nowhere else to go in a milestone
that forbids durability, M6's replay needs the values, and redaction sits above the buffer
(ADR-0035) so secrets are still stripped. Second, **a node that exhausts its retries escalates
rather than failing**; `failed` is reserved for defects the validator should have prevented, because
north-star invariant 1 is that a domain can always fall back to its full agent. `asAgentRuntime()`
presents a workflow as an `AgentRuntime` so `createHarness()` runs one unchanged, with trace,
storage and `pnpm harness run show` working as they did; M5's router replaces its escalated-to-failed
mapping. Documented in [`../architecture/workflow-runtime.md`](../architecture/workflow-runtime.md),
which includes the worked event list one six-node run produces.

### M4-T7, Idempotency

**Status:** completed (2026-09-20).

Every node execution gets an idempotency key:

```text
run + workflow version + node + logical item + attempt
```

External `call` nodes must declare whether they are:

- read-only
- idempotent write
- non-idempotent write

Non-idempotent writes require explicit protection.

**Result.** The runtime derives **two** keys per node execution, and one is the other's prefix.
The per-attempt key is the build plan's formula verbatim,
`${runId}:${workflowId}@${workflowVersion}:${nodeId}:${itemIndex ?? "-"}:${attempt}`, and it rides on
every `node.started` payload so two attempts at one node are distinguishable. The **protection** key
is the same string without the attempt. That split is the task's own logic followed through: a retry
is by definition a different attempt, so a protection key containing the attempt would differ on
every retry and would never match, and "a retry does not duplicate a protected side effect" would be
false. A `call` node declaring `protection` looks the logical key up before calling; a hit returns
the recorded value, charges no tool call, and records a `tool.*` pair marked `replayed`, so a reader
sees protection fire and the ledger never counts a call that did not happen. A miss calls the tool
and records the result **before** the output is validated, because the store answers "did this side
effect happen?" and by then it has. Inside a `map` the item index is part of both keys, so each
element is protected separately. The store is a `ProtectedEffectStore` port defaulting to memory,
which is the honest default for a milestone that forbids durability.

### M4-T8, Tool grants

**Status:** completed (2026-09-20).

Node permissions are explicit.

An `agent` node receives only its granted tools.

A `code` node does not inherit agent tools.

**Result.** Two checks, both before anything executes and both failing closed. Every node's own
`permissions` must be a **subset of the job's**, whatever the node's type: a workflow may not widen
what the job was allowed to do, and a node granting a tool the job does not, or `write` where the job
granted `read`, is a `PermissionDeniedError` with nothing executed. A `call` node may call only a
tool its **own** grants cover, at the mode its `effect` requires — `read-only` needs `read`, both
writes need `write`, a `write` grant satisfies a `read` request and a `read` grant never satisfies a
`write` one — and the check runs before the tool is resolved, so a denied call leaves a record of
being refused and never of being attempted. An `agent` node's sub-run receives a derived job and
context carrying the **node's** permissions and budget rather than the job's, which is "an `agent`
node receives only its granted tools" made true at the one boundary that enforces it. A `code` node
is called with a single argument, its validated input: no context, no registry, no tool table, no
signal, which is a stronger statement than a grant list it is trusted to respect. A permission
denial is never retried, because asking again does not grant it.

### M4-T9, IR canonicalization and capability resolution

**Status:** completed (2026-09-20).

Before fingerprinting or execution:

1. parse the IR with its versioned schema;
2. resolve every capability ID/version against `CapabilityRegistry`;
3. verify node input/output schemas against referenced capabilities;
4. normalize object/key ordering for canonical serialization;
5. reject unknown fields where the IR schema requires strictness;
6. produce the canonical IR bytes used for the workflow fingerprint.

A workflow with a missing capability MUST fail validation before any node executes.

**Result.** All six steps are `compileWorkflow(definition, registry)` in
`packages/workflow/src/compile.ts`, in that order, and it is the **only** way to obtain a
`CompiledWorkflow`. Steps 1 and 5 are `parseWorkflowDefinition()` from M4-T1, whose
`ValidationError` propagates unchanged; steps 2 and 3 are
`packages/workflow/src/validate/capabilities.ts`; steps 4 and 6 are `canonicalWorkflowIr()` and
`workflowFingerprint()`, and they run **only after everything else passes**, so canonical bytes and
a digest never exist for a workflow that cannot run. That is what turns the task's last sentence
into a type-level fact rather than a discipline: the runtime takes a `CompiledWorkflow`, and there
is no other way to make one. A test named for it holds the line.

**Resolution is exact-version-only.** `registry.has()` is asked for the reference as written; there
is no "latest", no range and no fallback, because AD-015 requires a promoted workflow to pin exact
capability versions and a validator that resolved loosely would be the thing that unpinned them.
Resolved: every `inputSchema`/`outputSchema` (workflow and node) as a `schema`, `code.handler` and
`reduce.handler` as a `handler`, `call.tool` as a `tool`, `agent.agent` as an `agent`,
`branch.on.policy` and `loop.until.policy` as a `policy`. Step 3 is more than an existence check:
when a resolved manifest entry declares an `inputSchema` or `outputSchema`, the node's must equal
it, because a handler registered for one schema and a node declaring another both resolve and the
workflow is still wrong.

**Two things are deliberately not resolved.** A `jev` node's `question` is not a capability kind —
M3 owns the question contract and the `DecisionEngine`, and validating that a named question exists
is M3's boundary applied at registration (M5) — which is exactly what lets M4 and M3 run in
parallel (ADR-0038). And an `agent` node's tool grants may name an unregistered tool, because a
runtime's own framework tools (eve's `load_skill`, already exported as `LOAD_SKILL_TOOL_ID` and
already granted by real jobs) are not domain capabilities and are registered nowhere; a `call`
node's grants have no such excuse and must resolve.

`validateWorkflow(definition, registry)` is exported beside `compileWorkflow()` as the same checks
without the throw, returning `readonly ValidationIssue[]` and never throwing for a validation
problem, so the typed DSL (M4-T5) and the run inspector can report a list without catching an
exception. Every pass runs and every issue is collected into one
`ValidationError`, `compileWorkflow: workflow definition is invalid`; nodes are walked in sorted id
order so the list is a function of the workflow, not of its literal's key order. Recorded in
[ADR-0039](../decisions/0039-workflow-validation-is-a-graph-model-with-one-owner-per-node.md).

Verification: `pnpm vitest run --project unit packages/workflow packages/core` passes, 596 tests
across 17 files. The suite covers the same IR fingerprinting identically and a reordered literal
fingerprinting identically, both through `compileWorkflow()`, and compiles a realistic
vendor-triage-shaped workflow (jev classify -> branch {clear -> code finalize, research -> agent
research -> jev verify -> code decide, uncertain -> escalate}) against a registry built the way
`apps/example-agent` builds its own.

### M4-T10, Hand-authored compiled example

**Status:** completed (2026-09-20).

Create vendor workflow:

```text
Jev classify
    |
    +-- clear -> code finalize
    |
    +-- research -> agent research
                       |
                       v
                   Jev verify
                       |
                       v
                   code decide
    |
    +-- uncertain -> full-agent escalation
```

**Result.** The workflow is `apps/example-agent/src/workflow/vendor-triage-workflow.ts`, authored
with the typed DSL (M4-T5) and compiled against the domain's **own** capability registry (M1-T9)
rather than a test fixture. That is the difference from
`packages/workflow/src/dsl/vendor-triage.test.ts`, which proved the DSL could express the shape
with placeholder references: this one resolves every reference to a schema, handler, agent or tool
the example agent actually ships, so it is the milestone's deliverable, "the first inspectable
compiled workflow". Seven nodes, fingerprint
`sha256:27da4abdb90051185735663c32ea8767abe56d70bd30bcba0f626b6e0cbf612a`.

**Three bindings are stated rather than derived, and each one is a rule being obeyed.** The
`research` node runs the registered `vendor-triage-agent@1.0.0`, whose manifest entry declares both
its schemas, and the validator requires a node's schemas to equal the ones its resolved capability
declares — so it binds `{ kind: "input" }` and is handed the original request, which is also what a
vendor triage agent needs. `finalize` and `decide` each read a `{ kind: "object" }` binding with a
composite schema, because a `code` node bound to its predecessor would see half of what it needs:
finalizing needs the request as well as the classification, and applying the policy needs the
agent's triage as well as the verification *of* that triage. Both name nodes that **dominate** the
reader, which is ADR-0039's rule and the one an author gets wrong most easily.

**Six capabilities were added to `src/capabilities.ts`**, beside Milestone 1's six and leaving
those byte-identical: four schemas (`vendor-triage.classification`, `.verification`,
`.finalize-input`, `.decision-input`), authored as real `zod` schemas in
`src/domain/schemas.ts`, and two handlers, `finalize-clear-triage` (the whole `clear` triage in
deterministic code: category, SOP gaps, the existing payment-change detector, evidence, and a
recommendation that is never an unconditional `proceed` while anything is unestablished) and
`decide-verified-triage` (the existing `noProceedWithOpenRiskFlags` policy applied to the agent's
triage and the verification). Both handlers **declare** the schemas they are registered for, so the
validator's step-3 equality check has something to compare; both are pure and total, and both have
their own unit test. A compiled workflow types every edge (north-star invariant 5), which is why a
classification and a verification need schemas at all.

**The Jev questions are answered by a documented placeholder**,
`src/workflow/fixture-decision-port.ts`. It is **not Jev** and does not approximate it: M3 owns
questions, the engine and the answer shape, and a question is deliberately not a capability kind,
which is what lets the two milestones be built in parallel (ADR-0038). It answers `classify` from
the frozen fixture evidence — `clear` for a vendor on file with nothing that needs reading,
`research` for one whose evidence carries an indicator, `uncertain` for anything else — and
`verify` from whether the triage cites a source, which it says out loud is the most a pure function
can honestly claim. It refuses any question it does not recognize rather than answering by default.
When M3 lands, an adapter over the real `DecisionEngine` replaces it and this file is deleted;
nothing in the workflow definition changes. It is kept in `apps/example-agent` rather than in
`@internal/workflow` because it is this domain's fixture, not a harness capability, so no ADR was
needed.

**`src/run.ts` gained `--workflow`** (or `EXAMPLE_RUN_MODE=workflow`), which swaps the harness's
`AgentRuntime` for `WorkflowRuntime.asAgentRuntime(compiled)` and hands the workflow's one `agent`
node the **same** `EveAgentRuntime` the agent path would have used — so `--mock --workflow` still
needs no credential, and the ledger records `target = <agent>+workflow`. It also gained
`--vendor <name>` (or `EXAMPLE_RUN_VENDOR`), because the workflow routes on the vendor's own
evidence and without it only one of the three routes could be demonstrated from the command line.
Neither flag changes anything about `pnpm example:run` without them.

**The behavior fingerprint now names the workflow.** `loadVendorTriageBehavior()` takes an optional
`workflowIr`, `createVendorTriageDomain({ workflowIr })` supplies it, and `--workflow` passes the
compiled workflow's canonical IR — so a compiled run and a full-agent run of the same domain are
different behaviors and fingerprint differently, which is what ADR-0034's `workflowIr` component
was reserved for. `vendorTriage` is unchanged and still means the full agent. Measured on two real
runs of the same domain against the same agent: `pnpm example:run:mock`
(`01a0bfad-b44f-7001-afd1-cfa5aafa72ac`) has `workflowIr = sha256:74234e98…`, the digest of `null`,
and composite `sha256:d3fd7841…`; `pnpm example:run:mock -- --workflow`
(`01a0bfa7-4484-7000-9060-dcba9756a378`) has `workflowIr = sha256:27da4abd…`, which is the compiled
workflow's own fingerprint, and composite `sha256:4f57ec9a…`. `workflowIr` is the only component
that moved.

Documented in [`../examples/README.md`](../examples/README.md) (the workflow, its files, and how to
run all three routes) and [`../runbooks/inspecting-a-run.md`](../runbooks/inspecting-a-run.md)
(what a workflow run looks like in `pnpm harness run show`, and the four things it does not yet
show). One **one-line fix** was made outside this app: the inspector's decision-identity key list
(`packages/observability/src/inspect-run.ts`) now tries `questionId` first, because a `jev` node
names a *question* (M4-T2) and the Jev call rows printed `(none)` without it.

Verification: `pnpm check` PASS (1197 passed, 43 skipped across 67 files), and the three routes run
end to end against the real eve fixture agent and real Supabase; run ids and event sequences are in
the acceptance criteria below.

## Acceptance criteria

From the build plan. Every criterion is verified against code in the tree on 2026-09-20; where a
criterion is proven by a test another task wrote, that test is named by file and title and was
re-run for this record.

- A human-authored workflow runs locally. **verified 2026-09-20** (M4-T10, M4-T6): all three
  routes of the real vendor workflow, through `createHarness()` on
  `WorkflowRuntime.asAgentRuntime()`, against the credential-free eve fixture agent and local
  Supabase. `pnpm example:run:mock -- --workflow` (run `01a0bfa7-4484-7000-9060-dcba9756a378`)
  completed the `clear` route with `modelCalls: 1`, `toolCalls: 0` and **no agent call at all**,
  and its trace is `run.started`, `node.started(classify)`, `decision.started`,
  `decision.completed`, `node.completed(classify)`, `node.started(route)`,
  `node.completed(route)`, `node.started(finalize)`, `node.completed(finalize)`, `run.completed`.
  `-- --workflow --vendor "Tessellate Analytics"` (run
  `01a0bfa7-71aa-7001-8d36-e62ee08c5bae`) completed the `research` route with `modelCalls: 3`,
  its trace adding `node.started(research)`, `agent.started`, `model.started`, `model.completed`,
  `agent.completed`, `node.completed(research)`, then `verify` and `decide`.
  `-- --workflow --vendor "Aurelia Freight"` (run `01a0bfa7-9ce9-7001-8075-74110e84dce6`)
  escalated: `node.completed(full-agent)`, `fallback.started`, `run.failed`, exit 1. All three
  wrote a `runs` row with `target = @internal/eve-fixture-agent+workflow` and
  `runtime_name = @internal/workflow`. In unit tests the same three routes are
  `apps/example-agent/src/workflow/vendor-triage-run.test.ts`, whose thirteen cases cover the
  clear, research and default routes, the branch label recorded in the trace, the ledger row and
  the run's `runtime` metadata. The runtime's own version of the criterion is
  `packages/workflow/src/runtime/workflow-runtime.test.ts` > "A human-authored workflow runs
  locally" (re-run, PASS).
- Every node validates inputs and outputs. **verified 2026-09-20** (M4-T6, M4-T10): the
  interpreter validates a node's bound input against its `inputSchema` before executing and its
  result against its `outputSchema` after, for every node type, which is
  `packages/workflow/src/runtime/workflow-runtime.test.ts` > "Every node validates inputs and
  outputs" (re-run, PASS). Against the real domain it is
  `vendor-triage-run.test.ts` > "validates every node's input and output, with `node` set on each
  event": every `node.*` event of a real run carries a non-null `node` and a `nodeId` payload
  field, and `node.started`/`node.completed` carry the validated `input`/`output` (ADR-0040's
  amendment to ADR-0031). Two of those schemas are composites the workflow builds with
  `{ kind: "object" }` bindings, so the check is over a value nothing else in the run produces.
  The strongest end-to-end evidence is `finalize-clear-triage.test.ts` > "produces a valid
  `vendor-triage.output` for every fixture vendor and for an unknown one", because a `code` node
  whose handler can produce an invalid output turns a deterministic route into an escalation.
- Workflow validation rejects an intentional unbounded cycle. **verified 2026-09-20** (M4-T4):
  `packages/workflow/src/compile.test.ts` > "rejects an intentional unbounded cycle" (re-run,
  PASS). ADR-0039 records why the rule is "any cycle is invalid" rather than "any cycle that is
  not a declared loop": repetition is expressed by `map` or `loop` **containment**, never by a
  back edge, so there is no legitimate cycle to distinguish from an illegitimate one and no
  judgment call in the one place that must not have one.
- An agent node cannot call an ungranted tool. **verified 2026-09-20** (M4-T8, M4-T10): two
  checks, both failing closed, both before anything executes.
  `packages/workflow/src/runtime/grants.test.ts` > "An agent node cannot call an ungranted tool"
  (re-run, PASS) is the unit form. Against the real workflow,
  `vendor-triage-run.test.ts` > "refuses to run a node granting a tool the job does not, before
  anything executes" narrows the job's permissions to `lookup_vendor_evidence` alone while the
  `research` node still grants `load_skill`: the run comes back `failed` with
  `code: "PERMISSION_DENIED"` naming `load_skill`, the fake agent runtime was **never called**,
  and the trace shows the `research` node never started. The positive half is "hands the agent
  node exactly its own grants and never the job's wider list": with three grants on the job and
  two on the node, the sub-run's `ExecutionContext.permissions` is exactly the node's two. A
  `code` node needs no such check, because the interpreter calls its handler with one argument —
  its validated input — and no context, registry, tool table or signal.
- A failed node is visible in the trace. **verified 2026-09-20** (M4-T6, M4-T10):
  `packages/workflow/src/runtime/workflow-runtime.test.ts` > "A failed node is visible in the
  trace" (re-run, PASS). Against the real workflow,
  `vendor-triage-run.test.ts` > "is visible in the trace, and the run escalates rather than
  reporting success" registers a deliberately throwing variant of the `finalize-clear-triage`
  handler in the test's own registry and runs the `clear` route: the trace carries a
  `node.failed` event with `node: "finalize"` and the thrower's message in its serialized error,
  followed by `fallback.started` with `reason: "node-failed"` and `nodeId: "finalize"`, and the
  harness result is `failed` rather than a silently degraded success.
- A retry does not duplicate a protected side effect in tests. **verified 2026-09-20** (M4-T7):
  `packages/workflow/src/runtime/idempotency.test.ts` > "A retry does not duplicate a protected
  side effect" (re-run, PASS). The mechanism is the two keys the runtime derives per node
  execution: the per-attempt key is the build plan's formula verbatim, and the **protection** key
  is the same string without the attempt, because a retry is by definition a different attempt and
  a protection key containing it would never match. A replayed effect records a `tool.*` pair
  marked `replayed` and charges **no** tool call. The vendor workflow has no `call` node, so it
  cannot exercise this itself; that is a property of the graph the milestone asked for, not a gap
  in the evidence.
- DSL output can be serialized to canonical IR. **verified 2026-09-20** (M4-T5, M4-T10):
  `packages/workflow/src/dsl/builder.test.ts` > "survives a JSON round trip, which is the
  acceptance criterion" (re-run, PASS). Against the real workflow,
  `apps/example-agent/src/workflow/vendor-triage-workflow.test.ts` > "survives a JSON round trip
  with the same canonical bytes and the same fingerprint" takes
  `JSON.parse(JSON.stringify(compiled.definition))` and asserts that `canonicalWorkflowIr()` of it
  equals `compiled.canonicalJson` **and** that `workflowFingerprint()` of it equals
  `compiled.fingerprint`. The same bytes are what `--workflow` puts in the behavior
  fingerprint's `workflowIr` component, so the serialization is exercised by every workflow run,
  not only by a test.
- Same IR produces same workflow fingerprint. **verified 2026-09-20** (M4-T5, M4-T9, M4-T10):
  `packages/workflow/src/dsl/builder.test.ts` > "gives the same fingerprint to two builds of the
  same workflow" (re-run, PASS). Against the real workflow, three cases in
  `vendor-triage-workflow.test.ts`: two independent compiles give the same
  `sha256:27da4abdb90051185735663c32ea8767abe56d70bd30bcba0f626b6e0cbf612a`; a definition whose
  top-level key order is reversed fingerprints identically, because `canonicalJson` sorts keys
  (ADR-0029); and changing one node's `timeoutMs` changes it, which is the half that makes the
  property worth having. Observed end to end: the `workflowIr` component digest printed by all
  three demo runs equals the compiled workflow's own fingerprint.
- **Beyond the eight**, M4-T9's "a workflow with a missing capability MUST fail validation before
  any node executes" is a type-level fact rather than a check —
  `createWorkflowRuntime().run()` takes a `CompiledWorkflow`, and `compileWorkflow()` is the only
  way to make one — held by `compile.test.ts` and, for the real workflow, by
  `vendor-triage-workflow.test.ts` > "fails to compile against a registry that does not hold its
  capabilities".
