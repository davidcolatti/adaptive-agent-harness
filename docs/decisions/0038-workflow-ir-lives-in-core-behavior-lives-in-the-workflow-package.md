---
status: accepted
date: 2026-09-20
deciders: orchestrator (Claude Fable 5.1) with repository owner constraints; recorded during M4-T1/M4-T2
related: [0006, 0007, 0013, 0015, 0029, 0032]
supersedes: null
superseded_by: null
---

# ADR-0038: The workflow IR is a core contract; validation, the DSL and the runtime live in `@internal/workflow`

## Context

Milestone 4 builds the inspectable compiled representation before anything tries
to compile automatically. Its first two tasks define the value everything else
in the milestone is written against: M4-T1 the serializable
`WorkflowDefinition`, M4-T2 the contract every node obeys. M4's own "Parallel
Work" note says runtime, validator, DSL and fixture workflow can split *after*
the IR stabilizes, so the IR is on the critical path of a critical-path
milestone and has to be decided in one pass rather than discovered.

Several prior decisions constrain it rather than leave it open:

- **AD-013 / ADR-0006 / ADR-0007.** The IR is authoritative; generated
  TypeScript is an artifact of it. V1 compilation is **structural** only: the
  compiler may compose registered nodes, agents, tools, Jev questions, policies
  and deterministic handlers, and may not invent arbitrary executable handler
  code.
- **AD-015 / ADR-0015.** IR never embeds imports, executable source or
  unregistered definitions. A node names a capability by `{ id, version }` and
  validation resolves every reference before execution or source generation.
- **ADR-0029.** Fingerprints are `sha256:` over RFC 8785-style canonical JSON, so
  every value in the IR must be exactly JSON-representable or the fingerprint
  scheme does not apply to it.
- **ADR-0032.** The harness's other reproducible record, `Job`, is deeply
  immutable and comes back through a strict `parseJob()` that rejects unknown
  fields. A workflow is the same kind of thing and should not need a second
  pattern.
- **The hard prohibition** "no unbounded loops in workflow definitions", and
  north-star invariants 3 (every workflow version is inspectable), 4 (every
  behavior-affecting version is fingerprinted), 5 (every node has typed input and
  output), 6 (every loop is bounded) and 7 (every external write has explicit
  permission semantics).

Two things the build plan leaves genuinely open, and the no-assumption stop
condition therefore applies to: **where** the IR lives in the workspace, and
**how data flows between nodes**. Nothing in `eve`, the AI SDK, AI Gateway, Jev,
Workflow or Sandbox prescribes either, so both are harness-owned design and are
recorded here rather than drifted into.

## Decision

### Placement

`@internal/core` declares the **contract**; `@internal/workflow` implements
**behavior over it**. This is the split `@internal/trace` already follows for the
trace event, and it is adopted for the same reason.

- `packages/core/src/workflow-ir.ts` and `packages/core/src/workflow-nodes.ts`
  own the types, the strict parse boundary `parseWorkflowDefinition()`, the pure
  predicate `isWorkflowDefinition()`, `canonicalWorkflowIr()`,
  `workflowFingerprint()` and `FallbackContext`. `@internal/core` MUST stay
  zero-dependency; nothing here needs more than the JSON model, `deepFreeze`, the
  identifier rules, the error taxonomy and `canonicalJson`/`fingerprint`, all of
  which are already in core.
- `packages/workflow` (`@internal/workflow`) is created by this task with one
  export, `CompiledWorkflow`, and will hold `compileWorkflow()` (M4-T4, M4-T9),
  the typed DSL (M4-T5) and the local deterministic interpreter (M4-T6).
- `@internal/workflow` is **not an adapter**. `tests/architecture/boundaries.ts`
  gives it the same `forbiddenByPackage` bans `@internal/core` and
  `@internal/trace` carry, including the ban on the npm package named `workflow`,
  which is Vercel's durable-workflow primitive and stays adapter-only
  (`@internal/workflow-vercel`, M11). M4-T6's local runtime deliberately builds no
  durability, and the ban is what keeps the two from being confused.

The IR is in core because `BehaviorDescriptor.workflowIr` (M2-T8) already refers
to it, the router (M5), replay (M6) and the compiler (M8) all need the type, and
core is the only package every one of them may depend on. Validation, the DSL and
the runtime are not in core because they are execution, and core is a contract
package.

### Shape

The top-level definition is build plan M4-T1's example with **two deliberate
departures**:

- **`version: string` is added**, an exact `major.minor.patch`. Invariants 3 and
  4, `FallbackContext.workflow.version` in build plan section 5, and M4-T7's own
  idempotency-key formula ("run + **workflow version** + node + logical item +
  attempt") each require one.
- **`domain: string` stays a plain id** and MUST NOT become the `{ id, version }`
  `DomainRef` that `Job.domain` carries. The router (M5) matches a workflow to a
  job on domain id plus job type; a workflow pinning a domain version would stop
  matching whenever the domain's version moved, for a reason unrelated to the
  workflow. Exactness lives where it belongs, on the capability references, which
  the workflow pins by version without exception.

Nodes live in a **flat map** keyed by id rather than in a tree; control shapes
reference their sub-graphs by id. Every node carries M4-T2's eight fields plus
`input`, and a node's `id` MUST equal its key.

### Data flow: `Binding` is not an expression language

Node input is built by a closed five-case `Binding` union over the run state
`{ input, nodes }`: `input`, `node` (with an optional list of object keys),
`item`, `literal` and `object`. There are no operators, no functions, no
conditionals, no wildcards and no array indices.

This follows directly from AD-013. An expression language in the IR would be
executable content the compiler could invent, a reviewer would have to interpret,
and a fingerprint could not distinguish from data — which would defeat invariant
3 ("every workflow version is inspectable") and re-open exactly the gate AD-013
closes when it limits v1 to structural composition. A transformation that needs
more than these five cases is a `code` node calling a registered handler, where it
is versioned, fingerprinted, permission-checked and testable.

### Jev questions are named, not registered

A `jev` node carries `question: { id, version }` and `questionKind`. A question
is **not** a `CapabilityKind`: the five kinds are schema, agent, tool, handler
and policy, and Milestone 3 owns the question contract. M4-T9's capability
resolution therefore MUST NOT attempt to resolve `question`; validating that a
named question exists is M3's boundary, applied at workflow registration (M5).
`questionKind` is carried on the node so a consuming `branch` can be checked with
M3 absent, which is what lets M3 and M4 proceed in parallel as the milestone
graph intends.

### `human` and `subworkflow` are reserved and rejected by name

M4-T3 says to reserve them without implementing them. `parseWorkflowDefinition`
rejects either with `` `human` is reserved for a later milestone and cannot be
used yet ``, distinct from the message for an unrecognized type. Reserving the
names also prevents a domain defining its own incompatible `human` node in the
interim.

### The IR stores no idempotency key

M4-T7's key is derived per logical node execution by the runtime as
`${runId}:${workflowId}@${workflowVersion}:${nodeId}:${itemIndex ?? "-"}:${attempt}`.
It is a property of a **run**, not of a workflow: a key baked into the IR would be
shared by every run of that workflow, which is the opposite of what an
idempotency key is for, and it would make the workflow fingerprint depend on
something that is not behavior. What the IR does carry is the *declaration*: a
`call` node's `effect` (`read-only` | `idempotent-write` |
`non-idempotent-write`) and its optional `protection: { kind: "idempotency-key" }`,
required by the validator when the effect is `non-idempotent-write`.

### Parse is strict, and parse is not validation

`parseWorkflowDefinition()` MUST reject unknown fields at every level, MUST
assert the whole value is a `JsonValue` (which is also its cycle guard), MUST
report every issue at once with a path, and MUST return a `deepFreeze`d value —
the `parseJob()` contract of ADR-0032, applied to the other reproducible record.

It MUST NOT perform graph validation or capability resolution. Missing nodes,
unreachable nodes, duplicate ids, incompatible schemas, undeclared cycles, a
`branch` with no `default`, a `code` node with tool grants and an unprotected
`non-idempotent-write` are all well-formed *values* and invalid *workflows*.
`compileWorkflow()` rejects them and returns a `CompiledWorkflow`, which is the
only thing the runtime accepts. That is how M4-T9's "a workflow with a missing
capability MUST fail validation before any node executes" becomes a type-level
fact rather than a discipline.

## Consequences

### Positive

- The IR stabilizes in one place, so M4-T4/T9 (validator), M4-T5 (DSL) and
  M4-T6 (runtime) can be built in parallel, which is what the milestone's
  "Parallel Work" note asks for.
- Every package that needs the *type* — the router (M5), replay (M6), evals
  (M7), the compiler and codegen (M8) — depends on `@internal/core`, which they
  all already do. None of them has to depend on the runtime to read a workflow.
- The IR is exactly JSON, deep-frozen and canonicalizable, so the M2 fingerprint
  scheme applies to it unchanged: `BehaviorDescriptor.workflowIr` needs no new
  mechanism, and "same IR produces same workflow fingerprint" is one function.
- An unbounded loop is **unwritable**, not merely invalid. Only `map`, `reduce`
  and `loop` repeat, and each carries a mandatory bound, so invariant 6 holds
  structurally and validation is a second line of defence.
- `permissions` per node makes M4-T8's "an agent node receives only its granted
  tools; a code node does not inherit agent tools" checkable before execution.

### Negative

- The IR is verbose. A node carries ten base fields before it says what it does,
  so a hand-authored workflow is long and the DSL (M4-T5) is not optional
  ergonomics but the intended authoring surface.
- `Binding`'s deliberate poverty means some perfectly ordinary reshaping — rename
  a field, coerce a number — needs a registered `code` handler. That is the cost
  of the inspectability AD-013 buys, and it will be felt first by M4-T10's
  hand-authored example.
- Two modules in core rather than one (`workflow-ir.ts`, `workflow-nodes.ts`),
  because one would run past a thousand lines. The split is one-directional, so
  there is no import cycle, but a reader has to know both exist.
- The node-shape validation duplicates `job.ts`'s budget and tool-grant
  collectors. Sharing them would mean exporting a validation surface from
  `job.ts` whose only consumer is this module; the duplication is about forty
  lines and is noted here so a future consolidation is a deliberate choice.

### Neutral

- `escalate` and `branch` carry no `next` field at all, rather than an optional
  one that must be `null`. That gives each node exactly one canonical form and
  keeps the canonical bytes a function of the contract, at the cost of an author
  who writes `next: null` on an `escalate` node getting an "unknown field"
  message.
- `WORKFLOW_SCHEMA_VERSION` is a literal `1`, so a format change is a type error
  at every read site. Changing it supersedes this ADR rather than editing it.
- `MAX_BINDING_DEPTH` (32) is a stack guard on a boundary that accepts untrusted
  input, not a semantic limit.

## Alternatives considered

- **Put the whole IR in `packages/workflow`, including the types.** Rejected:
  `BehaviorDescriptor.workflowIr` in core already refers to the IR, and the
  router, replay, evals and the compiler all need the type. Core would end up
  depending on `workflow`, inverting the build plan's dependency diagram, or
  every consumer would depend on the runtime to read a value. The `trace`
  precedent — contract in core, persistence in the sibling package — already
  answers this shape of question in this repository.
- **Put validation and the runtime in core too.** Rejected: core is a contract
  package with no execution in it, and an interpreter in core would drag graph
  algorithms, concurrency and capability resolution into the package every other
  package depends on.
- **An expression language for node input** (JSONPath, JMESPath, a small
  arithmetic DSL). Rejected under AD-013: it is executable content in the IR, it
  is what an LLM compiler would be tempted to generate, and it is precisely what
  "structural compilation only" excludes. It would also need a dependency, which
  core may not have.
- **Implicit data flow** — each node receives the previous node's output, with no
  `input` field. Rejected: it makes a `branch`'s reconvergence and a `map` body's
  element invisible, and it cannot express a node that needs two earlier outputs
  without inventing an implicit merge rule that the IR would not show.
- **`domain` as a version-pinned `DomainRef`**, matching `Job.domain`. Rejected:
  it would make every domain version bump silently unmatch every workflow, and
  the router matches on id plus job type. Recorded rather than dropped because
  the asymmetry with `Job` is surprising on first reading.
- **Storing the idempotency key in the IR.** Rejected: see above; it is per-run
  state, and it would put a non-behavioral value inside the fingerprint.
- **Registering Jev questions as a sixth `CapabilityKind`.** Rejected for now:
  M3 owns the question contract and has not defined it, and inventing a kind
  ahead of it would be exactly the speculative coupling AGENTS.md's scope
  discipline warns against ("no capability-registry type exists until M1-T9 needs
  it"). If M3 concludes a question *is* a capability, adding the kind is a
  forward-compatible change to the registry and a validator change here, not an
  IR change.
- **A tree-shaped IR**, with control shapes containing their children inline.
  Rejected: it makes reachability and duplicate-id checks traversal problems, it
  makes a shared continuation impossible to express without duplication, and it
  makes a node's identity depend on its position.
- **A permissive parse that drops unknown fields.** Rejected for the reason
  `parseJob()` rejects it (ADR-0032): a workflow is a reproducible record, and a
  field this version does not understand means the value was not written by this
  version. Dropping it would lose data from a record whose whole purpose is
  reproducibility, and for a compiler proposal it would silently accept something
  nobody reviewed.

## References

- `docs/milestones/build-plan.md` §1 AD-013, AD-015, AD-016; §5 Core Contracts
  (`Workflow node`, `Control shapes`, `Capability registry`, `Fallback
  envelope`); Milestone 4 (M4-T1 through M4-T9); §14 North-star invariants
- Related ADRs: ADR-0006, ADR-0007, ADR-0013, ADR-0015, ADR-0029, ADR-0032,
  ADR-0034, ADR-0035 (the `trace` placement precedent), ADR-0037
- Related code paths: `packages/core/src/workflow-ir.ts`,
  `packages/core/src/workflow-nodes.ts`, `packages/workflow/src/compiled.ts`,
  `tests/architecture/boundaries.ts`
- Contract: `docs/contracts/workflow-ir.md`
