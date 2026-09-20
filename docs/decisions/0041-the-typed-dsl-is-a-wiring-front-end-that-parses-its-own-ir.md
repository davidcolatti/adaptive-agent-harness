---
status: accepted
date: 2026-09-20
deciders: harness maintainers (M4-T5)
related: [0007, 0013, 0038]
supersedes: null
superseded_by: null
---

# ADR-0041: The typed DSL is a wiring front end that parses its own IR

## Context

AD-007 and [ADR-0007](0007-typed-typescript-dsl-over-a-serializable-ir.md) require that "the
public authoring experience is a typed TypeScript DSL" with "a serializable intermediate
representation underneath it", and build plan M4-T5 adds the rule the whole milestone turns on:
**"the IR, not builder object identity, is fingerprinted."** M4-T1/M4-T2 landed that IR in
`@internal/core` and [ADR-0038](0038-workflow-ir-lives-in-core-behavior-lives-in-the-workflow-package.md)
put behavior over it in `@internal/workflow`, so what was left open was the authoring surface
itself: what a caller writes, what the builder fills in, and what it refuses.

Three constraints shaped the answer.

**The IR is total where authoring wants to be partial.** Every node carries ten fields, all
required: `version`, both schemas, `timeoutMs`, `retry`, `budget`, `permissions`, `input` and the
type-specific ones. A workflow written with all ten on every node would bury its graph in
ceremony, and the build plan leaves five of them (timeout, retry, budget, permissions, version)
without a prescribed default, which AD-016 says must therefore be recorded rather than implied.

**The graph model admits exactly one owner per node.**
[ADR-0039](0039-workflow-validation-is-a-graph-model-with-one-owner-per-node.md) fixes it: `next`,
`branch.cases[*]` and `branch.default` are *edges*; `chain.steps[*]`, `map.body` and `loop.body`
are *containment*; and a node is either reachable from `entry` or the child of exactly one
container, never both. A DSL that let an author write `next` by hand would let them write a
workflow the validator rejects, in a language whose job is to stop that.

**`compileWorkflow()` is being written in parallel and needs a registry.** Capability resolution
is M4-T9's boundary and it takes a `CapabilityRegistry` argument. A DSL that resolved references
would need a registry at *authoring* time, which would make a workflow module impossible to import
without one.

## Decision

`@internal/workflow` gains `workflow(options)`, a fluent builder in `packages/workflow/src/dsl/`,
with a method per IR node type: `code`, `call`, `jev`, `agent`, `artifact`, `escalate`, `chain`,
`branch`, `map`, `reduce`, `loop`. It compiles to a `WorkflowDefinition` and to nothing else.

### The builder MUST NOT resolve capabilities

`build()` returns `parseWorkflowDefinition(ir)` and stops there. It does not import
`compileWorkflow()`, does not hold a registry, and does not validate the graph. A caller that
wants those guarantees passes the result to `compileWorkflow(definition, registry)`.

### `build()` MUST parse; `toIr()` is the escape hatch

`build()` returns a value that has been through `parseWorkflowDefinition()`, so it is shape-valid
and deep-frozen. `toIr()` returns the same IR unparsed and unfrozen, for a test that wants to
mutate a field and watch the parse boundary reject it.

### Wiring is by construction; there is no `next` option

Nodes added to the top-level builder form one chain: each node's `next` is the node added after
it, and the last is terminal. `branch` and `escalate` carry no `next`, so they end that chain; a
node added after one starts a new segment and MUST state its own `input` binding, because it has
no unique predecessor. There is no way to set `next` directly.

### Sub-graphs are nested builder callbacks that MUST terminate

A branch case, a branch default, a `map` body, a `loop` body and a `chain`'s steps are each a
callback `(b) => ...` that MUST return the `SubGraphEnd` marker, which only `.end()`, `.goto()`,
`.branch()` and `.escalate()` produce. Forgetting to terminate a sub-graph is a *type* error.

A `chain`'s steps are wired as containment: every node the callback adds becomes one entry of
`steps` and is terminal on its own. Every other sub-graph is a sequence wired through `next`.

### `.goto(nodeId)` sets an edge, never ownership

A branch case or default may end with `.goto("finalize")`, which points the case's last node at a
node declared elsewhere — typically later, at the top level, which is how several cases rejoin.
A case that adds no node of its own and only `goto`s makes that node the case target directly,
so "this label goes straight to `finalize`" needs no pass-through node. `goto` is rejected from a
`map` body, a `loop` body and a `chain` step, which return to their container. Targets may be
forward references and are checked at `build()`.

### Bindings and schemas default, and the defaults are derivable

A node's `input` defaults to `{ kind: "input" }` for the workflow's first node,
`{ kind: "item" }` for the head of a `map` body, and `{ kind: "node", node: <predecessor> }`
everywhere else, where the "predecessor" of a sub-graph's head is its container.

A node's `inputSchema` is derived from that binding: the workflow's input schema for
`{ kind: "input" }`, and the referenced node's output schema for an unnarrowed `{ kind: "node" }`.
Any other binding has no derivable schema and the node MUST state one.

A node's `outputSchema` is derived only where it is not a choice: the workflow's output schema for
a node that ends the main graph, and the node's own input schema for a `branch` or an `escalate`,
neither of which transforms what it is given. Every other node MUST state one.

This is exactly the shape ADR-0039's reference-equality schema rules require, so a workflow whose
edges are all the common case is schema-compatible without the author saying so.

### `permissions` is offered only where the IR allows it, and a `call` grants its own tool

`permissions` MUST NOT appear in the workflow's `defaults` block or in the common per-node options.
Only `.agent()` and `.call()` accept it; every other node type emits `[]`. ADR-0039's node rules
reject a non-empty `permissions` on any other type, and a workflow-level default would have granted
a tool to every `code` node in the workflow — which is precisely the thing M4-T8 exists to forbid.
Making it unwritable is stronger than rejecting it, and it costs one extra option interface.

A `call` node that states no `permissions` is granted its own tool, at the mode its effect requires:
`read` for `read-only`, `write` for both write effects. The validator requires exactly that grant,
and a `call` node names one tool by reference, so writing the grant by hand is transcription with
nothing to decide. An explicit `permissions` is used as written, which is how a scope or a second
grant is added.

### The node defaults are these five values

| Field | Default | Why |
| --- | --- | --- |
| `timeoutMs` | `60_000` | Long enough for an `agent` node to finish, short enough that a hung node fails rather than hangs. |
| `retry` | `{ maxAttempts: 1 }` | "Do not retry", the only safe default for a node whose effect on the world the DSL cannot see. M4-T7's protection rules are about `call` nodes the author configures deliberately. |
| `budget` | `{}` | The IR's own "no node-level limit"; the run's budget still applies. |
| `permissions` | `[]` | Permission is explicit, so the default is denial (north-star invariant 7). Overridable only on `agent` and `call`; a `call` derives its own grant. |
| `version` | `"1.0.0"` | The version a node that has never been replaced is on. |

A workflow's `defaults` block overrides all five for every node; a node overrides the block. The
workflow's own `version` defaults to `"1.0.0"` the same way. They are exported as
`DSL_NODE_DEFAULTS` and `DSL_WORKFLOW_VERSION_DEFAULT`, so a reader never has to guess what a node
that states nothing carries.

### A duplicate node id throws at the call site

Every other problem is collected and thrown from `build()` as one `ValidationError` carrying every
issue. A duplicate id is the exception and throws from the method that caused it, naming the id:
the author is standing at the call site, and a second node under an existing id would otherwise
silently replace the first.

### What is typed and what is not

Node ids are tracked as a string-literal union through the chain, so a backward reference
(`{ kind: "node", node: "classify" }`) is typo-checked at the call site. Schema and capability
references are strings (`"vendor-triage.input@1.0.0"`) or `{ id, version }` objects, validated at
definition time by `parseCapabilityRefString()`. **There is no type-level schema inference.**
Whether a binding actually produces the shape a node's `inputSchema` promises is a runtime question
the validator and the runtime answer against the capability registry, and a type-level system would
duplicate that check somewhere it cannot be kept honest. Forward `goto` targets are runtime-checked,
because a forward reference is the whole point of the feature.

## Consequences

### Positive

- The M4-T10 vendor-triage graph is expressible with no `input` binding, no `inputSchema` and no
  `next` written anywhere: seven nodes, three of which state an `outputSchema` because they
  genuinely introduce one. It compiles against a registry with zero issues.
- "DSL output can be serialized to canonical IR" and "same IR produces same workflow fingerprint"
  (two Milestone 4 acceptance criteria) are properties of the emitted value, so they are tested by
  building twice, by a JSON round trip, and by two builders that differ only in the order
  independent settings were written in.
- A malformed builder cannot produce a malformed definition downstream, because `build()` parses.
- The one-owner rule, "a `branch` has a `default`" and "a `code` node does not inherit agent tools"
  are unwritable violations rather than rejected ones: `default` is a required option, a sub-graph
  is a callback, and `permissions` is an option only where a grant is legal.

### Negative

- **`next` cannot be set directly**, so a graph whose shape the builder does not express has to be
  written as an IR literal. That is deliberate — the shapes it does not express are the ones with
  two owners — but an author who wants one will find no option for it.
- **A node in the middle of a chain must state its `outputSchema`.** Only a terminal node's is
  derivable. This is the most common thing an author writes, and it is the price of not guessing.
- **The builder mutates shared state and returns itself.** The fluent type says
  `WorkflowBuilder<TIds | TId>`, which reads as if each call produced a new value; it does not, so a
  builder must be used linearly. A persistent builder would mean copying the draft map per call for
  a use nobody has.
- **A branch case's sub-graph is authored before the node it `goto`s exists**, so a typo in a
  forward target is a `build()` error rather than a compile error.
- `packages/workflow/src/dsl/types.ts` restates the option shape of every node type. It is
  duplication of a kind, but the option types are what an author reads, and deriving them from the
  IR types with mapped types would make them unreadable in an editor tooltip.

- **Two validator rules stay outside the DSL's reach**, so a definition it builds may still fail to
  compile: a workflow needs a *reachable* `escalate` node, and a `{ kind: "node" }` binding must
  name a node that dominates its reader (nothing after a `map` or `loop` may bind into its body).
  The builder's own default bindings never violate the second — a node after a `map` binds to the
  `map` itself — but an explicitly stated one can, and the first is a property of a whole graph
  rather than of any one call.

### Neutral

- `escalate` and `branch` get their input schema as their output schema. Neither transforms its
  input, and ADR-0039 constrains only the terminal *non-escalate* node's output schema, so nothing
  downstream depends on the choice; it exists to keep `.escalate("full-agent", { reason })` a
  one-liner.
- The DSL adds no dependency. `@internal/workflow` still depends on `@internal/core` alone.

## Alternatives considered

- **JSON-first authoring: no DSL, write the IR literal.** Rejected by AD-007 and ADR-0007, which
  make the typed DSL the public authoring experience. It is also what the negative consequences
  above fall back to, so it remains available for a graph the builder cannot express.
- **A class or object per node (`new JevNode({...})`, `compose([...])`).** It makes every node's
  fields explicit and needs no wiring rules, which is exactly its problem: `next`, `input` and both
  schemas would be written by hand on every node, and the one-owner rule would be a convention
  again. The build plan's own M4-T5 example is fluent, not compositional.
- **Type-level schema inference, with `Schema` objects threaded through the chain.** Rejected as
  out of scope by the task and wrong on the merits: the IR stores schema *references*, resolved
  against a registry at compile time, so a type-level model would describe a different thing than
  the one that is actually checked. ADR-0027 keeps schemas in the domain's own library, which a
  harness-side inference system would have to duplicate.
- **`build()` returning the raw IR, with parsing left to the caller.** Cheaper, and wrong: the DSL
  is the only producer that could be trusted to skip the boundary, and the moment it is trusted,
  a builder bug becomes a validator bug, a runtime bug or a wrong fingerprint.
- **A `next` option on every node method, with the fluent chain as sugar over it.** It would let an
  author express a rejoin without `goto` and a container child that escapes its container. The
  second is the reason it was rejected.

## References

- `docs/milestones/build-plan.md` — Milestone 4, M4-T5; AD-007, AD-013, AD-016
- `docs/contracts/workflow-dsl.md`, `docs/contracts/workflow-ir.md`
- Related ADRs: ADR-0007, ADR-0013, ADR-0038, ADR-0039, ADR-0027, ADR-0029
- Related code paths: `packages/workflow/src/dsl/`, `packages/core/src/workflow-ir.ts`,
  `packages/core/src/workflow-nodes.ts`
