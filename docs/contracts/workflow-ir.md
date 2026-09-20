---
status: active
owner: core
last_verified: 2026-09-20
related:
  - docs/milestones/build-plan.md
  - docs/contracts/README.md
  - docs/contracts/job.md
  - docs/contracts/capability-registry.md
  - docs/contracts/behavior-fingerprint.md
  - docs/contracts/execution-context.md
  - docs/contracts/trace-event.md
  - docs/decisions/0038-workflow-ir-lives-in-core-behavior-lives-in-the-workflow-package.md
  - docs/decisions/0039-workflow-validation-is-a-graph-model-with-one-owner-per-node.md
  - docs/decisions/0015-workflow-ir-references-a-typed-versioned-capability-registry.md
  - docs/decisions/0029-canonical-json-and-sha-256-behavior-fingerprints.md
  - docs/decisions/0032-jobs-are-deeply-immutable-and-the-effective-job-is-the-job.md
implementation:
  - packages/core
  - packages/workflow
---

# Workflow IR

The workflow intermediate representation is the **authoritative source of a
compiled workflow's semantics**. The typed DSL (M4-T5) compiles *to* it, the
local deterministic runtime (M4-T6) interprets it, the deterministic code
generator (M8) reads it, and the fingerprint that decides whether two runs are
comparable is taken over it. Generated TypeScript is an artifact of the IR and
never the other way round
([ADR-0006](../decisions/0006-compiled-workflows-are-committed-source-ir-is-authoritative.md),
[ADR-0007](../decisions/0007-typed-typescript-dsl-over-a-serializable-ir.md),
AD-013).

It was created by **M4-T1** (the definition) and **M4-T2** (the node contract),
which together also fixed the *type half* of M4-T3 (node types), M4-T4 (control
shapes), M4-T7 (idempotency declarations) and M4-T8 (per-node tool grants),
because all four are fields of one value and the IR had to stabilize before the
validator, runtime and DSL could be built in parallel.

Where it lives is
[ADR-0038](../decisions/0038-workflow-ir-lives-in-core-behavior-lives-in-the-workflow-package.md):
`@internal/core` declares the contract and its parse boundary
(`packages/core/src/workflow-ir.ts` and `workflow-nodes.ts`), and
`@internal/workflow` implements behavior over it. That is the same split
`@internal/trace` already follows for the trace event.

## The definition

```ts
interface WorkflowDefinition {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly version: string;
  readonly domain: string;
  readonly jobType: string;
  readonly inputSchema: string;
  readonly outputSchema: string;
  readonly entry: NodeId;
  readonly nodes: { readonly [nodeId: string]: WorkflowNode };
}
```

| Field | Meaning |
| --- | --- |
| `schemaVersion` | The IR **format's** version, a literal `1`. Nothing to do with `version`. A future format change is a type error at every read site rather than a silent misparse. |
| `id` | The workflow's stable id, by the identifier rule in [`identifiers.md`](identifiers.md). |
| `version` | The workflow's own exact `major.minor.patch` version. No range, no pre-release tag. |
| `domain` | The domain id this workflow belongs to. A plain id, **not** version-pinned; see below. |
| `jobType` | The job type within that domain this workflow handles. |
| `inputSchema` | The schema the workflow's input satisfies, as a capability reference string `id@version`. |
| `outputSchema` | The schema the workflow's output satisfies, same form. |
| `entry` | The node execution starts at. |
| `nodes` | Every node, keyed by id. The workflow's output is the output of the node whose `next` is `null`. |

Two deliberate departures from the build plan's M4-T1 example, both recorded in
ADR-0038:

- **`version` is added.** The plan's example omits it. North-star invariants 3
  and 4, `FallbackContext.workflow.version` in the plan's own section 5, and
  M4-T7's idempotency-key formula (which reads "run + **workflow version** +
  node + logical item + attempt") all need one.
- **`domain` stays a plain id**, not the `{ id, version }` `DomainRef` that
  [`Job.domain`](job.md) carries. The router (M5) matches a workflow to a job on
  domain id plus job type; pinning a domain version would break that match
  whenever the domain's version moved, for a reason unrelated to the workflow.
  What the workflow *does* pin exactly is every capability it uses, which is
  where the compatibility question actually lives (AD-015,
  [ADR-0015](../decisions/0015-workflow-ir-references-a-typed-versioned-capability-registry.md)).

Nodes live in a **flat map**, not a tree. Control shapes reference their
sub-graphs by id, so a `chain`, a `branch`, a `map`, a `reduce` and a `loop` are
ordinary entries alongside everything else. That is what makes the graph
enumerable without traversal, which in turn is what makes reachability,
duplicate ids and undeclared cycles questions about one object.

## The node contract

Every node, whatever its type, carries the eight things build plan M4-T2 lists
plus one the plan's list omits:

```ts
interface WorkflowNodeBase {
  readonly id: NodeId;                       // must equal its key in `nodes`
  readonly type: WorkflowNodeType;           // the discriminant
  readonly version: string;                  // exact major.minor.patch
  readonly inputSchema: string;              // capability ref string
  readonly outputSchema: string;             // capability ref string
  readonly timeoutMs: number;                // whole number >= 1
  readonly retry: RetryPolicy;               // { maxAttempts >= 1, backoffMs? >= 0 }
  readonly budget: Budget;                   // `{}` means no node-level limit
  readonly permissions: readonly ToolGrant[]; // M4-T8; not inherited
  readonly input: Binding;                   // where the input comes from
}
```

`input` is the ninth. The plan lists a node's *contract*; a node with typed
input and no statement of where that input comes from cannot execute.

Points worth stating plainly:

- **The id is stored twice on purpose.** The key is what an edge points at; the
  field is what survives when a node is read, traced or reported on its own, and
  it is what `TraceEvent.node` carries. Parse enforces the equality, so the
  duplication cannot become a disagreement.
- **`version` is per node**, because a node is the unit the compiler replaces.
  Promoting a cheap `code` node in place of an `agent` node moves that node's
  version and the workflow's, and replay needs to tell the two apart.
- **`permissions` are not inherited** (M4-T8). An `agent` node receives exactly
  the grants listed on it, and a `code` node does not inherit agent tools. That
  is the rule expressed as a data structure, which is what makes "an agent node
  cannot call an ungranted tool" checkable before anything runs.
- **`budget` may be `{}`**, meaning no node-level limit. The run's budget still
  applies; a node budget can only narrow it.

## The data-flow model

Run state is exactly two things:

```ts
{ input: <the job's input>, nodes: { [nodeId]: <that node's output> } }
```

and a node's `input` field is a `Binding` that reads from it:

```ts
type Binding =
  | { kind: "input" }
  | { kind: "node"; node: NodeId; path?: readonly string[] }
  | { kind: "item" }
  | { kind: "literal"; value: JsonValue }
  | { kind: "object"; fields: Record<string, Binding> };
```

| Kind | Reads |
| --- | --- |
| `input` | The whole job input. |
| `node` | Another node's output, optionally narrowed by `path`. |
| `item` | The current element. Valid only inside a `map` body. |
| `literal` | A constant baked into the workflow and covered by its fingerprint. |
| `object` | An object assembled from other bindings, one per field. |

```ts
// { candidate: <job input>, prior: <the "classify" node's .label> }
{
  kind: "object",
  fields: {
    candidate: { kind: "input" },
    prior: { kind: "node", node: "classify", path: ["label"] },
  },
}
```

**This is not an expression language, and that is the point.** A workflow's
semantics must be inspectable by reading the IR (invariant 3), and an embedded
expression language would mean the IR carried code a reviewer has to interpret,
a compiler could invent, and a fingerprint could not distinguish from data.
AD-013 limits v1 compilation to *structural* composition of registered
capabilities, so the data flow between them is structural too: five closed
cases, no operators, no functions, no conditionals. `path` is a list of object
keys, not a path expression — no wildcards, no indices, no filters. A
transformation that needs any of that is a `code` node calling a registered
handler, where it is versioned, fingerprinted and testable. ADR-0038 records the
decision.

Binding nesting is bounded by `MAX_BINDING_DEPTH` (32). That is a stack guard on
a parse boundary that accepts untrusted input, not a semantic limit; no
legitimate workflow comes close.

## Node types (M4-T3)

The union discriminates on `type`. Six executable types:

| Type | Extra fields | Notes |
| --- | --- | --- |
| `code` | `handler: CapabilityRef`, `next` | A pure deterministic handler. No tools: its `permissions` MUST be empty, which the validator enforces. |
| `call` | `tool: CapabilityRef`, `effect`, `protection?`, `next` | A direct call to a registered external tool. See M4-T7 below. |
| `jev` | `question: { id, version }`, `questionKind`, `next` | A bounded probabilistic judgment. |
| `agent` | `agent: CapabilityRef`, `next` | A registered agent. Its `permissions` are the **only** tools it may use (M4-T8). |
| `artifact` | `name`, `contentType?`, `next` | Stores its input durably and outputs a reference. |
| `escalate` | `reason` | **Terminal**: it carries no `next` at all. Produces a `FallbackContext`. |

A `jev` node **names a question; it does not define one.** Milestone 3 owns the
question contract, the `DecisionEngine` interface and the Jev implementation, and
a question is deliberately not a
[`CapabilityKind`](capability-registry.md) — the five kinds are schema, agent,
tool, handler and policy, and a question is none of them. The consequence for
M4-T9 is explicit: **capability resolution does not resolve `question`**, because
there is nothing to resolve it against. Validating that a named question exists
is M3's boundary, applied when a workflow is registered (M5). `questionKind`
(`boolean` | `choice` | `score`) is carried on the node so a consuming `branch`
can be checked without M3 being present at all, which is what lets M4 and M3
proceed in parallel.

An `artifact` node's `name` is its role within the workflow
(`"research-notes"`), not a file path. Where an artifact is actually stored is
M5's decision; nothing about a path, a bucket or a key belongs in the IR, which
is also what keeps path traversal out of a compiled workflow's reach.

### Reserved types

`human` and `subworkflow` are reserved by M4-T3 and **rejected by name** with
their own message, `` `human` is reserved for a later milestone and cannot be
used yet ``, rather than falling through to "unknown node type". The distinction
matters to whoever hits it: one says the type is coming and the design is not
wrong, the other sends an author looking for a typo. Reserving the names also
stops a domain defining its own incompatible `human` node in the meantime.

## Control shapes (M4-T4)

Five, and they are nodes in the same map as everything else:

| Type | Extra fields | Notes |
| --- | --- | --- |
| `chain` | `steps: readonly NodeId[]` (non-empty), `next` | A fixed sequence. An explicit list rather than a linked list of `next` pointers, so it validates, diffs and compiles as one object. |
| `branch` | `on`, `cases` (non-empty), `default?` | **No `next`**: each case target continues the graph. |
| `map` | `items: Binding`, `body`, `maxItems` (>= 1), `concurrency?`, `next` | Bounded. |
| `reduce` | `items: Binding`, `handler`, `initial: JsonValue`, `next` | `handler` is `(accumulator, item) => accumulator`. |
| `loop` | `body`, `maxIterations` (>= 1), `until`, `next` | The bounded loop. |

`branch.on` is either `{ kind: "field"; path }` (a string value read out of the
node's input) or `{ kind: "policy"; policy: CapabilityRef }` (a registered policy
that returns a label). The policy form is the AD-009 separation in the IR: a
`jev` node produces *judgment*, a policy turns judgment into a *decision*, and
the two are different capabilities with different versions so a threshold can
move without the question changing.

`branch` carries **no `next`** because a shared continuation is expressed by
pointing several cases at the same node. A single `next` would mean every branch
reconverges, which is exactly the assumption that makes an escalating branch hard
to express.

`branch.default` is the escalation target, and **a `branch` without one is
invalid** — that is what M4-T4's "missing escalation target" rejection means. A
selector can always produce a label nobody enumerated (a policy is code, a field
is data), and the alternative to a default is a run that stops with no successor
and no explanation.

`loop.until` is `{ kind: "field"; path; equals: JsonValue }` or
`{ kind: "policy"; policy }`. Both limits are mandatory and independent: `until`
is the intent, `maxIterations` is the guarantee. A loop whose condition never
becomes true stops at the bound and fails; it does not run forever.

**Only `map`, `reduce` and `loop` may execute a node more than once**, and each
carries its own explicit bound. There is no way to write an unbounded loop in
this IR, so "validation rejects an intentional unbounded cycle" (M4-T4, a
Milestone 4 acceptance criterion) is a second line of defence rather than the
only one. Any other cycle through `next` or `cases` edges is invalid.

## Idempotency (M4-T7)

A `call` node declares what calling it does to the world:

| `effect` | Retry | Protection |
| --- | --- | --- |
| `read-only` | Freely. | None needed. |
| `idempotent-write` | Freely; the callee absorbs the duplicate. | None needed. |
| `non-idempotent-write` | Only under protection. | **Required.** |

`protection` is `{ kind: "idempotency-key" }` today. It is an object rather than
a boolean so that a later mechanism — a reservation, a two-phase commit, a
compare-and-set — is a new `kind` rather than a breaking change to the field.

**The IR stores no idempotency key.** A key is a property of a run, not of a
workflow: baking one into the IR would make every run of a workflow share it,
which is precisely backwards. The runtime (M4-T6) derives it per logical node
execution from build plan M4-T7's formula, "run + workflow version + node +
logical item + attempt":

```text
${runId}:${workflowId}@${workflowVersion}:${nodeId}:${itemIndex ?? "-"}:${attempt}
```

`itemIndex` is the element's index inside an enclosing `map`, and `-` when there
is no enclosing `map`. Every component is already constrained to contain no `:`
— a run id is a UUIDv7, a workflow id and a node id obey the identifier rule
which bans `:`, a version is `major.minor.patch`, and the last two are integers —
so the key parses back unambiguously.

## What parse checks, and what it does not

`parseWorkflowDefinition(value: unknown): WorkflowDefinition` is the boundary a
workflow comes back through: the sibling of [`parseJob()`](job.md) and
`parseTraceEvent()`. The DSL's compiled output, a registry row (M5), a replayed
workflow (M6) and a compiler proposal (M8) all hold an `unknown` that claims to
be a workflow. The compiler case matters most: a model may propose IR, and
nothing downstream should have to wonder whether the proposal was well formed.

It checks:

| Field | Rule |
| --- | --- |
| the whole value | A JSON value: no `undefined`, function, `Date`, non-finite number or cycle. Checked first, because it is also the cycle guard. |
| `schemaVersion` | Exactly `1`. |
| `id`, `domain`, `jobType` | Identifiers. |
| `version` | An exact `major.minor.patch` version. |
| `inputSchema`, `outputSchema` | Capability reference strings, `id@version`. |
| `entry` | An identifier. |
| `nodes` | Non-empty; every key an identifier; every value a node whose `id` equals its key. |
| every node | Its ten base fields plus exactly the extra fields its `type` declares, each well formed. |

Every problem is reported at once, each with the path to the field that caused
it, as a `ValidationError` carrying `ValidationIssue[]`. **An unknown field
anywhere is an error, not something to drop**, exactly as `parseJob()` treats
one: a workflow is a reproducible record, and a field this version does not
understand means the value was not written by this version. The returned value is
**deep-frozen**, because a mutated node would silently disagree with the
fingerprint taken over it.

`isWorkflowDefinition(value)` is the pure predicate over the same pass. It
freezes nothing and agrees with `parseWorkflowDefinition` exactly.

It deliberately does **not** check, because these are graph questions and it has
neither the graph nor a registry to ask:

- that `entry` names a node, or that any `next`, `cases`, `default`, `body` or
  `steps` target exists;
- that every node is reachable, or that no id is duplicated;
- that a cycle is a declared bounded loop;
- that one node's `outputSchema` is compatible with the next node's
  `inputSchema`;
- that a `branch` has a `default`;
- that a `code` node's `permissions` are empty;
- that a `non-idempotent-write` `call` declares `protection`;
- that any capability reference resolves.

All of those belong to `compileWorkflow()` in `@internal/workflow` (M4-T4,
M4-T9), whose result type is `CompiledWorkflow`:

```ts
interface CompiledWorkflow {
  readonly definition: WorkflowDefinition; // parsed, frozen, graph-valid, refs resolved
  readonly canonicalJson: string;
  readonly fingerprint: string;
}
```

Holding one means every check above has already passed, which is how "a workflow
with a missing capability MUST fail validation before any node executes" (M4-T9)
becomes a type-level fact rather than a discipline. Anything that executes a
workflow takes a `CompiledWorkflow`; a bare `WorkflowDefinition` carries none of
those guarantees.

## Canonicalization and the fingerprint

```ts
canonicalWorkflowIr(definition: unknown): string   // canonical JSON bytes
workflowFingerprint(definition: unknown): string   // `sha256:<64 hex>`
```

Both parse first. Canonicalizing an unvalidated value would happily encode a
tenth top-level field or a node type this version does not understand, and the
resulting digest would claim to describe a workflow the harness cannot run.

`canonicalJson` sorts object keys by UTF-16 code unit and preserves array order
([ADR-0029](../decisions/0029-canonical-json-and-sha-256-behavior-fingerprints.md)),
so two definitions describing the same workflow produce identical bytes whatever
order their literals were written in. `workflowFingerprint` hashes exactly those
bytes. That is "same IR produces same workflow fingerprint" (a Milestone 4
acceptance criterion) and "the IR, not builder object identity, is fingerprinted"
(M4-T5).

The digest covers the **whole** definition, including each node's version,
timeout, retry policy, budget and tool grants. Narrowing a node's permissions
changes the fingerprint, which is correct: it is a behavior change, and invariant
4 says every behavior-affecting version is fingerprinted. The same value is the
`workflowIr` component of a run's behavior fingerprint
([`behavior-fingerprint.md`](behavior-fingerprint.md),
[ADR-0034](../decisions/0034-behavior-fingerprint-is-component-wise-and-supplied-by-the-domain.md)).

## The fallback envelope

```ts
interface FallbackContext {
  readonly reason: FallbackReason;
  readonly workflow: { readonly id: string; readonly version: string; readonly fingerprint: string };
  readonly completedNodes: readonly {
    readonly nodeId: NodeId;
    readonly outputRef: string;
    readonly trusted: boolean;
  }[];
  readonly evidenceRefs: readonly string[];
  readonly remainingBudget: Budget;
}
```

Exactly build plan section 5's shape. North-star invariant 1 is "a domain can
always fall back to its full agent", and this is what makes the fallback useful
rather than merely possible: the agent receives the original immutable `Job`
**plus** what the compiled path already established, so it does not redo research
the workflow already paid for (invariant 9).

`trusted` is the load-bearing field. A node whose output passed its schema and
whose capability resolved is trusted; one that failed, timed out or produced
something unvalidated is not, and the agent is told which is which rather than
being handed a flat list it has to take on faith.

`FallbackReason` is a **closed** union of six, because the reason is stored,
aggregated and compared: M5 counts fallbacks per reason to decide whether a
workflow is carrying its weight, and M6/M7 compare them across replays. A
free-form string would make "the same reason" a text-matching problem.

| Reason | Meaning |
| --- | --- |
| `escalate-node` | The graph reached an `escalate` node. The designed exit. |
| `node-failed` | A node exhausted its retries. |
| `budget-exceeded` | A budget dimension ran out mid-run. |
| `validation-failed` | A node's input or output failed its schema. |
| `decision-failed` | A `jev` node could not produce a usable answer. |
| `timeout` | A node or the workflow exceeded its wall-clock limit. |

Note that an `escalate` node's own `reason` field is **not** a `FallbackReason`:
it is the workflow author's static prose explaining why that branch gives up
(`"classification was uncertain"`), and it ends up in a trace and in a review.
The `FallbackReason` is chosen at runtime.

## Where the types live

| Symbol | Module |
| --- | --- |
| `WorkflowDefinition`, `FallbackContext`, `FallbackReason`, `parseWorkflowDefinition`, `isWorkflowDefinition`, `canonicalWorkflowIr`, `workflowFingerprint`, `WORKFLOW_SCHEMA_VERSION`, `FALLBACK_REASONS` | `packages/core/src/workflow-ir.ts` |
| `WorkflowNode` and its eleven members, `Binding` and its five, `RetryPolicy`, `NodeProtection`, `BranchSelector`, `LoopCondition`, `NodeId`, `NODE_TYPES`, `CONTROL_NODE_TYPES`, `RESERVED_NODE_TYPES`, `CALL_EFFECTS`, `JEV_QUESTION_KINDS`, `BINDING_KINDS`, `MAX_BINDING_DEPTH`, `isNodeId` | `packages/core/src/workflow-nodes.ts` |
| `CompiledWorkflow` | `packages/workflow/src/compiled.ts` |

All of the first two are re-exported by name from `@internal/core`.

## Validation and compilation (M4-T4, M4-T9)

```ts
compileWorkflow(definition: unknown, registry: CapabilityRegistry): CompiledWorkflow
validateWorkflow(definition: WorkflowDefinition, registry: CapabilityRegistry): readonly ValidationIssue[]
```

Both live in `@internal/workflow` (`packages/workflow/src/compile.ts` and
`src/validate/`). `compileWorkflow()` is the **only** way to obtain a
`CompiledWorkflow`, and it runs M4-T9's six steps in order: parse the definition
(`parseWorkflowDefinition()`, whose `ValidationError` propagates unchanged),
validate the graph and the node rules, resolve every capability,
canonicalize (`canonicalWorkflowIr()`), fingerprint (`workflowFingerprint()`).
Canonical bytes and a digest are produced **only after everything passes**, so
neither ever exists for a workflow that cannot run.

`validateWorkflow()` is the middle two steps as a pure function. It **never
throws for a validation problem**: the typed DSL (M4-T5) reports a mistake at the
call site that made it, and the run inspector explains a workflow it cannot run,
and neither should have to catch an exception to read a list. It takes a
definition that has already been parsed; the shape rules above are
`parseWorkflowDefinition()`'s and are not repeated.

Every pass runs and every issue is collected. A workflow with five problems
reports five, each a `ValidationIssue` whose `path` is rooted at the definition
(`["nodes", "research", "next"]`), and `compileWorkflow()` throws one
`ValidationError`, `compileWorkflow: workflow definition is invalid`, carrying
all of them. Nodes are walked in sorted id order, so the list is a function of
the workflow rather than of the order its literal was written in.

### The graph model

Two kinds of edge, and they mean different things:

| Kind | Fields |
| --- | --- |
| successor edge | `next` (`code`, `call`, `jev`, `agent`, `artifact`, `chain`, `map`, `reduce`, `loop`); `cases[*]` and `default` (`branch`) |
| containment | `chain.steps[*]`, `map.body`, `loop.body` |

A **region** is the top-level graph (rooted at `entry`) or one container child
slot plus everything its successor edges reach. **Every node has exactly one
owner**: it is reached from `entry`, or it is the child of exactly one container
— never both, and never two containers. That is what "duplicate IDs" means in an
IR whose nodes are object keys, and it is what makes `{ kind: "item" }` scoping
well defined: "inside a `map` body" is a property of the node, not of the path
that reached it.

### Every rule the validator enforces

| Rule | Rejects | Issue path |
| --- | --- | --- |
| missing node | `entry`, a `next`, a `cases[*]`, a `default`, a `steps[*]`, a `map.body` or a `loop.body` that names no key in `nodes` | the field that names it |
| one owner | the same node as two container children, or as both a container child and an edge target | the second claim's field |
| container containment | a container child's subgraph continuing by `next` into a node it does not own; its terminals must be `next: null` or `escalate` | the offending `next` |
| unreachable | a node no path of edges or containment reaches from `entry` | `["nodes", id]` |
| cycles | **any** cycle over edges plus containment; repetition must be a `loop` or `map` node, never a back edge | the edge that closes it |
| `item` scope | `{ kind: "item" }` on a node not inside a `map` body, transitively, including nested in an `object` binding's fields | the binding |
| `node` binding | a `{ kind: "node"; node: X }` where `X` names no node, is the node itself, or does not **dominate** the reader | the binding's `node` |
| grants: placement | `permissions` on any node type other than `agent` and `call` — a `code` node in particular does not inherit an agent's tools | `["nodes", id, "permissions"]` |
| grants: coverage | a `call` node with no grant for the tool it calls; an `idempotent-write`/`non-idempotent-write` call without a `mode: "write"` grant (a `read-only` call is satisfied by either mode) | `["nodes", id, "permissions"]` |
| grants: resolution | a `call` node grant naming an unregistered `tool` id. **An `agent` node's grants need not resolve** | `["nodes", id, "permissions", i, "toolId"]` |
| protection | a `call` with `effect: "non-idempotent-write"` and no `protection` | `["nodes", id, "protection"]` |
| escalation target | a `branch` with no `default` | `["nodes", id, "default"]` |
| fallback exists | a workflow with no `escalate` node reachable from `entry` | `["nodes"]` |
| schema: job input | a node whose `input` is `{ kind: "input" }` and whose `inputSchema` is not the workflow's | `["nodes", id, "inputSchema"]` |
| schema: node input | a node whose `input` is `{ kind: "node"; node: X }` **with no `path`** and whose `inputSchema` is not `nodes[X].outputSchema` | `["nodes", id, "inputSchema"]` |
| schema: workflow output | a top-level terminal node other than `escalate` whose `outputSchema` is not the workflow's | `["nodes", id, "outputSchema"]` |
| schema: chain output | a `chain` whose `outputSchema` is not its last step's | `["nodes", id, "outputSchema"]` |
| schema: branch pass-through | a `branch` whose `outputSchema` is not its own `inputSchema`; a branch routes rather than computes, and the runtime records its validated input as its output | `["nodes", id, "outputSchema"]` |
| capability: schemas | a workflow or node `inputSchema`/`outputSchema` not registered as a `schema` at that exact version | the field |
| capability: handlers | `code.handler`, `reduce.handler` not registered as a `handler` | `["nodes", id, "handler"]` |
| capability: tool | `call.tool` not registered as a `tool` | `["nodes", id, "tool"]` |
| capability: agent | `agent.agent` not registered as an `agent` | `["nodes", id, "agent"]` |
| capability: policies | `branch.on.policy`, `loop.until.policy` not registered as a `policy` | the field |
| capability: declared schemas | a node whose `inputSchema`/`outputSchema` contradicts the one its resolved `handler`/`tool`/`agent` declares in the manifest | the node's schema field |

`map.maxItems`, `loop.maxIterations`, `retry.maxAttempts` and `timeoutMs`
positivity are already `parseWorkflowDefinition()`'s and are not re-checked.

### Why a `node` binding is checked by dominance

`{ kind: "node"; node: X }` reads `X`'s output, and an output exists only if `X`
has run. The validator requires `X` to **dominate** the reader: to run on every
path from `entry` to it. The weaker "`X` is an ancestor along some path" would
accept a binding that reads a sibling `branch` case's output — the mistake an
author makes most often and the one a compiler proposal will make — and it would
surface at run time as a `WorkflowError` rather than at compile time as an issue.

Dominance is computed over a **flow graph**, not the edge graph, because
containment carries execution and the containers differ:

- a `chain` always runs every step in order, so it flows into its first step,
  each step's region terminals flow into the next step, and the last step's
  terminals flow into the chain's own `next`. Nothing flows from the chain
  straight to its `next`, because nothing skips a chain's steps;
- a `map` body may run zero times and a `loop`'s `until` may stop it, so both
  flow into their body **and** straight on to their `next`. A node after a `map`
  is therefore not told that a node inside the body ran, which is correct.

### Why schema compatibility is reference equality

A schema in this harness is an opaque Standard Schema validator
([ADR-0027](../decisions/0027-standard-schema-is-the-harness-schema-contract.md)),
and neither `@internal/core` nor `@internal/workflow` declares a schema library,
so nothing here can compare two schemas structurally or decide that one is
assignable to another. What it can decide exactly is whether two nodes name the
**same schema capability at the same version**, which is the check that catches
the mistake compilation actually makes: a node swapped for another that produces
something different.

The five pairings in the table above are all that is ref-checked. These are
validated at **run time only**, by the runtime's per-node input and output
validation, because no registered reference can be derived for them:

- a binding narrowed by `path`, which reads part of a value;
- a `literal` or an `object` binding, which builds a value structurally;
- an `item` binding, since "the element type of that schema" is not derivable
  from `id@version`;
- a `map`'s output (an array of its body's outputs), a `reduce`'s (a handler's
  result) and a `loop`'s (the result of repetition).

### Capability resolution (M4-T9)

Exact versions only. There is no "latest", no range and no fallback to another
version: AD-015 requires a promoted workflow to pin exact capability versions,
and a validator that resolved loosely would be the thing that unpinned them.

When a resolved manifest entry declares an `inputSchema` or `outputSchema`, the
node's MUST equal it. That is what makes resolution more than an existence check:
a handler registered for one schema and a node declaring another both resolve,
and the workflow is still wrong.

**A `jev` node's `question` is not resolved.** A question is not one of the five
capability kinds; M3 owns the question contract and the `DecisionEngine`, and
validating that a named question exists is M3's boundary, applied when a workflow
is registered (M5). The node carries `questionKind` precisely so that M4 can
validate everything around the question without M3 being present.

**An `agent` node's grants need not resolve.** A runtime's own framework tools —
eve's `load_skill`, which `@internal/runtime-eve` exports as
`LOAD_SKILL_TOOL_ID` and which real jobs already grant — are not domain
capabilities and are registered nowhere, so requiring registration would make a
legitimate agent unexpressible. A `call` node has no such excuse: it calls
exactly one registered tool, by reference, and its grants are checked.

All of it is recorded in
[ADR-0039](../decisions/0039-workflow-validation-is-a-graph-model-with-one-owner-per-node.md).
