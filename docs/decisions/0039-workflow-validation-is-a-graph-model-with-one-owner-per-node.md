---
status: accepted
date: 2026-09-20
deciders: orchestrator (Claude Fable 5.1) with repository owner constraints; recorded during M4-T4/M4-T9
related: [0013, 0015, 0029, 0038]
supersedes: null
superseded_by: null
---

# ADR-0039: Workflow validation is a graph model with one owner per node, and schema compatibility is reference equality

## Context

[ADR-0038](0038-workflow-ir-lives-in-core-behavior-lives-in-the-workflow-package.md) split the
workflow IR in two: `@internal/core` owns the contract and the strict
`parseWorkflowDefinition()` boundary, `@internal/workflow` owns behavior over it. Parse answers
"is this a well-formed value?" and deliberately stops, because the remaining questions are about a
graph and a registry it cannot see. M4-T4 names six of them — unreachable nodes, missing nodes,
incompatible schemas, cycles not declared as bounded loops, a missing escalation target, duplicate
IDs — and M4-T9 adds capability resolution and the canonical bytes, with one normative sentence:
"a workflow with a missing capability MUST fail validation before any node executes."

Answering them needs a model the IR does not state outright. The IR is a flat map of nodes; `chain`,
`map` and `loop` name their sub-graphs by id, and every other node names its successors by id. So
"is this node inside a `map` body?" — which is exactly the question `{ kind: "item" }` depends on —
and "has this node's output already been produced?" — which is what a `{ kind: "node" }` binding
depends on — are both questions the validator has to *derive*. Three further forces shaped the
answer:

- **"Duplicate IDs" cannot mean what it says.** Nodes are keys of an object, so a duplicate key is
  impossible by construction and parse already rejects a node whose `id` disagrees with its key.
  Whatever M4-T4 meant, the thing that can still be duplicated is a node's *place in the graph*.
- **Schemas are opaque.** [ADR-0027](0027-standard-schema-is-the-harness-schema-contract.md) makes a
  schema a Standard Schema validator, and neither `@internal/core` nor `@internal/workflow`
  declares a schema library, so nothing in the harness can compare two schemas structurally or
  decide that one is assignable to another.
- **A grant may legitimately name a tool the registry has never heard of.** A runtime's own
  framework tools — eve's `load_skill`, which `@internal/runtime-eve` already exports as
  `LOAD_SKILL_TOOL_ID` and which jobs already grant — are not domain capabilities and are
  registered nowhere.

## Decision

`compileWorkflow(definition, registry)` in `packages/workflow/src/compile.ts` is the only way to
obtain a `CompiledWorkflow`. It runs M4-T9's six steps in order: parse, graph and node rules,
capability resolution, canonicalize, fingerprint. `validateWorkflow(definition, registry)` is the
middle two as a pure function returning `readonly ValidationIssue[]`, which **MUST NOT** throw for
a validation problem, so the DSL and the run inspector can report without catching.

### The graph model

The graph has two kinds of edge, and they mean different things:

- **successor edges** — `next` on `code`, `call`, `jev`, `agent`, `artifact`, `chain`, `map`,
  `reduce` and `loop`; `cases[*]` and `default` on `branch`;
- **containment** — `chain.steps[*]`, `map.body`, `loop.body`.

A **region** is the top-level graph (rooted at `entry`) or one container child slot and everything
its successor edges reach. **Every node has exactly one owner**: it is reached from `entry`, or it
is the child of exactly one container, never both and never two containers. Violating that is what
M4-T4's "duplicate IDs" MUST reject in this IR, and it is what makes `{ kind: "item" }` scoping
well defined — "inside a `map` body" becomes a property of the node rather than of whichever path
happened to reach it.

Three consequences follow and are enforced:

1. **Every node MUST be reachable** from `entry` through edges and containment.
2. **Any cycle is invalid.** Bounded repetition is expressed by `map` or `loop` containment and
   never by a back edge, so there is no legitimate cycle to distinguish from an illegitimate one.
   The message says so: `` cycle `a` -> `b` -> `a`; repetition must be a `loop` or `map` node,
   never a back edge ``.
3. **A container child's subgraph MUST end inside itself.** Because every successor edge stays in
   its region, a subgraph's terminal nodes necessarily have `next: null` or are `escalate` nodes,
   and an edge leaving the region is reported with its own message rather than as a generic
   ownership conflict.

### `{ kind: "node" }` bindings are checked by dominance

A `{ kind: "node"; node: X }` binding on node `N` is valid only when `X` **dominates** `N` in the
flow graph: `X` runs on every path from `entry` to `N`, and `X !== N`. The alternative — "`X` is an
ancestor along *some* path" — would accept a binding that reads the output of a sibling `branch`
case, which is exactly the mistake a compiler proposal is most likely to make and exactly the one
that only shows up at run time, as a `WorkflowError` in production rather than an issue at compile
time.

The flow graph is not the edge graph, because containment carries execution and the containers
differ:

- a `chain` always runs every step in order, so it flows into its first step, each step's region
  terminals flow into the next step, and the last step's terminals flow into the chain's own
  `next`. Nothing flows from the chain straight to its `next`, because nothing skips a chain's
  steps;
- a `map` body may run zero times and a `loop`'s `until` may stop it, so both flow **into their
  body and straight on to their `next`**. A node after a `map` is therefore not told that a node
  inside the body ran.

### Schema compatibility is reference equality on `id@version`

Five pairings are checked, by string equality of the capability reference and nothing else:

1. a node whose `input` is `{ kind: "input" }` has `inputSchema === workflow.inputSchema`;
2. a node whose `input` is `{ kind: "node"; node: X }` with **no `path`** has
   `inputSchema === nodes[X].outputSchema`;
3. every terminal node of the top-level graph other than `escalate` has
   `outputSchema === workflow.outputSchema`;
4. a `chain`'s `outputSchema` equals its last step's;
5. a `branch`'s `outputSchema` equals its own `inputSchema`, because a branch routes rather
   than computes and the runtime records its validated input as its output, so a successor
   bound to the branch by `{ kind: "node" }` receives the routed value.

Everything else is a run-time check performed by the runtime (M4-T6) against the resolved
validator: a binding narrowed by `path`, a `literal`, an `object`, an `item`, and the outputs of
`map`, `reduce` and `loop`. None of them has a registered schema reference that could be derived
from `id@version`.

### Node rules

- **Only `agent` and `call` nodes may declare tool grants.** M4-T8 states the `code` case; the IR
  puts `permissions` on every node, so something has to say where it means anything. Every other
  type runs a registered handler or policy, asks a question, writes an artifact or routes control,
  and a grant on one would be permission nothing reads.
- A `call` node MUST declare a grant for the tool it calls. A `read-only` call is satisfied by a
  `read` or a `write` grant; an `idempotent-write` or `non-idempotent-write` call requires
  `mode: "write"`, matching `ToolGrantMode`'s rule that `read` never satisfies a write.
- A `non-idempotent-write` call MUST declare `protection` (M4-T7).
- **A `call` node's grants MUST name a registered `tool` id; an `agent` node's need not.** The
  exception is the framework-tool case above, and it is confined to `agent` nodes because a `call`
  node calls exactly one registered tool by reference and has no such excuse. A grant carries no
  version, so registration is checked by id at any version.
- Every `branch` MUST declare a `default` (M4-T4's "missing escalation target"), and every workflow
  MUST contain at least one `escalate` node reachable from `entry` (north-star invariant 1).

### Capability resolution

Every `inputSchema`/`outputSchema` (workflow and node) resolves as a `schema`; `code.handler` and
`reduce.handler` as `handler`; `call.tool` as `tool`; `agent.agent` as `agent`;
`branch.on.policy` and `loop.until.policy` as `policy`. **Exact versions only** — there is no
"latest", no range and no fallback, because AD-015 requires a promoted workflow to pin exact
versions and a validator that resolved loosely would be the thing that unpinned them. When a
resolved manifest entry declares an `inputSchema` or `outputSchema`, the node's MUST equal it.

**A `jev` node's `question` is not resolved.** A question is not one of the five capability kinds;
M3 owns the question contract and the `DecisionEngine`, and validating that a named question exists
is M3's boundary applied at registration (M5). This is what lets M4 and M3 proceed in parallel.

### Reporting

Every pass runs and every issue is collected, then `compileWorkflow()` throws one
`ValidationError` — `compileWorkflow: workflow definition is invalid` — carrying all of them, with
each `ValidationIssue.path` rooted at the definition (`["nodes", "research", "next"]`). Nodes are
iterated in sorted id order, so the list of issues is a function of the workflow rather than of the
order its literal happened to be written in. Canonicalization and the fingerprint happen only after
everything passes, so canonical bytes and a digest never exist for a workflow that cannot run.

## Consequences

### Positive

- "A workflow with a missing capability MUST fail validation before any node executes" is a
  type-level fact: the runtime takes a `CompiledWorkflow`, and the only way to make one is to pass.
- North-star invariant 6 is structural twice over: the IR has no way to express an unbounded loop,
  and the validator rejects every cycle rather than trying to classify one.
- A `{ kind: "node" }` binding that would have failed at run time on one branch of a `branch` fails
  at compile time on every path, before anything is spent.
- The one-owner rule gives `{ kind: "item" }` a scope that can be decided statically, and gives the
  runtime (M4-T6) an unambiguous answer to "which container is this node executing under?".
- Issue lists are complete and deterministic, so fixing a workflow is one pass rather than one
  exception at a time.

### Negative

- **Dominance rejects some workflows that would in fact work.** A node reachable only through one
  `branch` case cannot be read by a node reachable only through the same case if the graph does not
  make that guarantee explicit; the author restructures, or moves the value through the node that
  does dominate. Recorded rather than relaxed: the alternative accepts the bug.
- **Reference equality cannot see a genuine type error** between two different schema ids that
  happen to describe compatible shapes, nor a mismatch behind a `path`, a `literal` or an `object`
  binding. The runtime's per-node validation is what catches those, one run later than a structural
  check would.
- **Only `agent` and `call` may carry grants** is stricter than M4-T8's literal text. A future node
  type that uses a tool has to be added to that list deliberately.
- `compileWorkflow()` parses the definition three times: once itself, once inside
  `canonicalWorkflowIr()` and once inside `workflowFingerprint()`, because both core functions
  parse first by design. Workflows are small and compilation is not on a run's hot path, so the
  cost was accepted rather than adding a second, unchecked entry point to core.

### Neutral

- The graph model lives in `packages/workflow/src/validate/`, five small modules behind one
  `validateWorkflow()`, so the runtime and the DSL consume a list of issues rather than the model.
  `analyzeGraph()` is exported for whoever needs the relations themselves.
- `validateWorkflow()` takes an already-parsed `WorkflowDefinition`. Shape rules stay in
  `parseWorkflowDefinition()` and are not repeated.

## Alternatives considered

- **"Some path" instead of dominance for `{ kind: "node" }` bindings.** Cheaper and simpler, and
  the brief offered it. Rejected: the binding it would wrongly accept — reading a sibling `branch`
  case's output — is the common authoring mistake and the one a compiler proposal will make, and
  it degrades into a run-time `WorkflowError` instead of a compile-time issue.
- **Structural schema compatibility.** Would catch more. Rejected: it requires a schema library in
  `@internal/core` or `@internal/workflow`, which ADR-0027 deliberately avoided, and Standard
  Schema publishes a validator rather than a description, so there is nothing to compare.
- **Treating a cycle as legal when it passes through a `loop` node.** Rejected: a `loop` already
  expresses repetition by containing its body, so a back edge would be a second way to say the same
  thing, with no bound attached, and "is this cycle declared?" would become a judgment call in the
  one place that must not have one.
- **Allowing any node to declare grants, and checking them only where they are used.** Rejected:
  permission nothing reads is the worst kind of permission to have, and invariant 7 is about
  external writes having *explicit* semantics, not merely declared ones.
- **Requiring every grant, including an `agent` node's, to resolve.** Rejected: it makes a
  legitimate agent unexpressible, since eve's `load_skill` and its siblings are granted by real
  jobs today and registered nowhere. The allowance is confined to `agent` nodes and recorded here
  rather than discovered later.
- **Validating a `jev` node's question against the registry.** Rejected: a question is not a
  capability kind (ADR-0038), M3 owns it, and adding a sixth kind now would put a permanent id
  under a wrong owner.

## References

- `docs/milestones/build-plan.md` — Milestone 4 (M4-T4, M4-T7, M4-T8, M4-T9), AD-013, AD-015,
  AD-016; north-star invariants 1, 3, 4, 5, 6, 7.
- Related ADRs: ADR-0013, ADR-0015, ADR-0027, ADR-0029, ADR-0038.
- Related code paths: `packages/workflow/src/compile.ts`, `packages/workflow/src/validate/`,
  `packages/core/src/workflow-ir.ts`, `packages/core/src/workflow-nodes.ts`,
  `packages/core/src/capabilities.ts`.
- Contract: `docs/contracts/workflow-ir.md`, section "Validation and compilation (M4-T4, M4-T9)".
