---
status: active
owner: core
last_verified: 2026-09-20
related:
  - docs/contracts/workflow-ir.md
  - docs/decisions/0041-the-typed-dsl-is-a-wiring-front-end-that-parses-its-own-ir.md
  - docs/decisions/0007-typed-typescript-dsl-over-a-serializable-ir.md
  - docs/decisions/0038-workflow-ir-lives-in-core-behavior-lives-in-the-workflow-package.md
  - docs/decisions/0039-workflow-validation-is-a-graph-model-with-one-owner-per-node.md
implementation:
  - packages/workflow
---

# Workflow DSL

The typed DSL is **the public way to author a workflow** (AD-007,
[ADR-0007](../decisions/0007-typed-typescript-dsl-over-a-serializable-ir.md)). It is a fluent
TypeScript builder in `@internal/workflow` that compiles to the
[workflow IR](workflow-ir.md) and to nothing else: `build()` returns a
`WorkflowDefinition` that has been through `parseWorkflowDefinition()`, and every downstream
consumer — the validator, the runtime, the registry, replay, the fingerprint — sees that value
rather than the builder. That is M4-T5's rule stated as a fact about the code: **the IR, not
builder object identity, is fingerprinted.**

It was created by **M4-T5** and its design is
[ADR-0041](../decisions/0041-the-typed-dsl-is-a-wiring-front-end-that-parses-its-own-ir.md).

Everything the builder does falls into three jobs: it applies defaults, it wires edges, and it
derives schemas. It does **not** resolve capabilities — that is `compileWorkflow()`'s boundary
(M4-T9) — and it does not validate the graph.

```text
workflow({...}).jev(...).branch(...).build()   ->  WorkflowDefinition   (shape-valid, frozen)
compileWorkflow(definition, registry)          ->  CompiledWorkflow     (graph-valid, resolved)
```

## The authoring surface

```ts
import { workflow } from "@internal/workflow";

workflow({
  id: "vendor-triage-v1",   // identifier
  version: "1.0.0",         // exact version; defaults to "1.0.0"
  domain: "vendor-triage",  // plain id, never version-pinned
  jobType: "vendor-triage",
  input: "vendor-triage.input@1.0.0",    // string `id@version`, or { id, version }
  output: "vendor-triage.output@1.0.0",
  defaults: { timeoutMs: 30_000 },       // optional; overrides DSL_NODE_DEFAULTS for every node
});
```

Eleven node methods, one per IR node type, each taking `(id, options)`:

| Method | Required options beyond the common ones |
| --- | --- |
| `.code(id, {...})` | `handler` |
| `.call(id, {...})` | `tool`, `effect`; `protection?`, `permissions?` |
| `.jev(id, {...})` | `question`, `questionKind` |
| `.agent(id, {...})` | `agent`; `permissions?` |
| `.artifact(id, {...})` | `name`; `contentType?` |
| `.escalate(id, {...})` | `reason` |
| `.chain(id, {...})` | `steps` (a sub-graph) |
| `.branch(id, {...})` | `on`, `cases`, `default` (sub-graphs) |
| `.map(id, {...})` | `items`, `body` (a sub-graph), `maxItems`; `concurrency?` |
| `.reduce(id, {...})` | `items`, `handler`, `initial` |
| `.loop(id, {...})` | `body` (a sub-graph), `maxIterations`, `until` |

Every method also accepts the common options, all optional:

| Option | Meaning |
| --- | --- |
| `input` | The `Binding` this node reads. `node` references are narrowed to the ids declared so far, so a typo is a type error. |
| `inputSchema` | A capability reference. Derived when it can be; see below. |
| `outputSchema` | Same. Derived only for a terminal node, a `branch` and an `escalate`. |
| `timeoutMs`, `retry`, `budget`, `version` | Four of the five the IR requires and the build plan leaves open. |

The fifth, `permissions`, is **not** a common option and **not** part of the workflow's `defaults`
block. Only `.agent()` and `.call()` accept it, because only an `agent` and a `call` node may carry
grants; every other node's `permissions` is `[]` in the emitted IR. That is M4-T8's "a `code` node
does not inherit agent tools" made unwritable rather than merely rejected: a workflow-level default
that granted a tool would grant one to every `code` node in the workflow.

A `call` node that states no `permissions` is granted **its own tool**, at the mode its effect
needs: `read` for `read-only`, `write` for `idempotent-write` and `non-idempotent-write`. The
validator requires exactly that grant, and a `call` node calls one tool by reference, so restating
its id is a transcription step with nothing to decide. State `permissions` explicitly to add a
scope or a second grant.

```ts
.call("file-ticket", { tool: "ticketing.create@3.1.0", effect: "non-idempotent-write",
                       protection: { kind: "idempotency-key" } })
// permissions: [{ toolId: "ticketing.create", mode: "write" }]
```

A capability reference is written either way, and both produce the IR's own form:

```ts
handler: "vendor.finalize@1.0.0"
handler: { id: "vendor.finalize", version: "1.0.0" }
```

Two terminal methods: `build()` returns the parsed, deep-frozen definition; `toIr()` returns the
same IR unparsed and unfrozen, an escape hatch for a test that wants to mutate a field and watch
the parse boundary reject it.

## Wiring

**The top-level chain.** Nodes added to the builder form one chain: each node's `next` is the node
added after it, and the last node is terminal (`next: null`). There is no `next` option; setting
it by hand is what would let an author write a node with two owners, which
[ADR-0039](../decisions/0039-workflow-validation-is-a-graph-model-with-one-owner-per-node.md)
forbids.

A `branch` and an `escalate` carry no `next` at all, so they end that chain. A node added after one
starts a new segment and **must state its own `input`**, because it has no unique predecessor:

```ts
.branch("route", { ... })       // ends the chain
.code("finalize", {             // a new segment; `input` is required
  handler: "vendor.finalize@1.0.0",
  input: { kind: "node", node: "classify" },
})
```

**Sub-graphs.** A branch case, a branch default, a `map` body, a `loop` body and a `chain`'s steps
are each a callback that receives a nested builder and must terminate it. "Must" is a type rule:
the callback returns `SubGraphEnd`, and only `.end()`, `.goto()`, `.branch()` and `.escalate()`
produce one.

```ts
research: (b) =>
  b
    .agent("research", { agent: "vendor-researcher@1.0.0", outputSchema: "..." })
    .code("decide", { handler: "vendor.decide@1.0.0" })
    .end(),          // `decide.next = null`
```

A `chain`'s steps are the exception to the sequential wiring: each node the callback adds becomes
one entry of `steps` and is terminal on its own, because `steps` is *containment*. A step reachable
from a sibling's `next` **and** listed in `steps` would have two owners.

**Rejoining with `.goto()`.** A branch case or default may end by continuing at a node declared
elsewhere, typically later at the top level. That is how several cases converge:

```ts
.branch("route", {
  on: { kind: "field", path: ["label"] },
  cases: {
    clear: (b) => b.goto("finalize"),                       // straight to `finalize`
    research: (b) => b.agent("research", {...}).goto("finalize"),
  },
  default: (b) => b.escalate("full-agent", { reason: "uncertain classification" }),
})
.code("finalize", { handler: "vendor.finalize@1.0.0", input: { kind: "node", node: "classify" } })
```

A case that adds no node of its own and only `goto`s makes that node the case target directly, so
no pass-through node is invented. The target may be a forward reference and is checked at
`build()`; an unknown id is a `ValidationError` naming it. `goto` is **rejected** from a `map` body,
a `loop` body and a `chain` step, which return to their container rather than continuing the main
graph.

## Defaults

Absent per-node settings fall back to the workflow's `defaults` block, and that falls back to
`DSL_NODE_DEFAULTS`:

| Field | Default |
| --- | --- |
| `timeoutMs` | `60_000` |
| `retry` | `{ maxAttempts: 1 }` (do not retry) |
| `budget` | `{}` (no node-level limit) |
| `permissions` | `[]` (nothing granted); overridable only on `agent` and `call` |
| `version` | `"1.0.0"` |

The workflow's own `version` defaults to `DSL_WORKFLOW_VERSION_DEFAULT`, also `"1.0.0"`. Both
constants are exported, so a reader never has to guess what a node that states nothing carries.
ADR-0041 records why each value was chosen.

## Bindings and derived schemas

A node's `input` defaults to its position:

| Position | Default binding |
| --- | --- |
| The workflow's first node | `{ kind: "input" }` |
| The head of a `map` body | `{ kind: "item" }` |
| The head of any other sub-graph | `{ kind: "node", node: <the container> }` |
| Anywhere else | `{ kind: "node", node: <the preceding node> }` |
| The head of a segment after a `branch` or `escalate` | none — the author states it |

`inputSchema` is then **derived from that binding**:

- `{ kind: "input" }` → the workflow's input schema;
- an unnarrowed `{ kind: "node", node: X }` → `X`'s output schema;
- anything else (`item`, `literal`, `object`, or a `node` narrowed by `path`) → the node must state
  one, and a `ValidationError` names it if it does not.

`outputSchema` is derived only where it is not a choice:

- a node that **ends the main graph** (its `next` is `null` and it is not inside a `map`, `loop` or
  `chain` body) → the workflow's output schema;
- a `branch` or an `escalate` → its own input schema, because neither transforms what it is given;
- every other node must state one.

This is exactly what ADR-0039's reference-equality schema rules require, so a workflow whose edges
are all the common case is schema-compatible without the author saying so.

## Errors

| When | What |
| --- | --- |
| An ill-formed id, version or capability reference | Throws from the method that took it. |
| A duplicate node id | Throws from the method that caused it, naming the id. |
| An empty sub-graph, `goto` from a container body, a `branch` with no cases | Throws from the container's method. |
| An unknown `goto` target, an unknown `{ kind: "node" }` reference, a schema that cannot be derived, a node with no unique predecessor | Collected and thrown from `build()` as one `ValidationError` whose `issues` name every problem. |

Everything is a `ValidationError`, the same type `parseJob()` and `parseWorkflowDefinition()`
throw, so a workflow module that fails to load fails the same way everywhere.

## The vendor-triage example

The M4-T10 shape, authored in full. Nothing states an `input` binding or an `inputSchema`: every
edge is the common case, so the builder derives all of it, and the only schemas written down are
the ones a node genuinely introduces.

```ts
const definition = workflow({
  id: "vendor-triage-v1",
  version: "1.0.0",
  domain: "vendor-triage",
  jobType: "vendor-triage",
  input: "vendor-triage.input@1.0.0",
  output: "vendor-triage.output@1.0.0",
})
  .jev("classify", {
    question: "vendor.classification@1.0.0",
    questionKind: "choice",
    outputSchema: "vendor-triage.classification@1.0.0",
  })
  .branch("route", {
    on: { kind: "field", path: ["category"] },
    cases: {
      clear: (b) => b.code("finalize", { handler: "vendor.finalize@1.0.0" }).end(),
      research: (b) =>
        b
          .agent("research", {
            agent: "vendor-researcher@1.0.0",
            permissions: [{ toolId: "lookup_vendor_evidence", mode: "read" }],
            outputSchema: "vendor-triage.evidence@1.0.0",
            timeoutMs: 120_000,
          })
          .jev("verify", {
            question: "vendor.evidence-supports@1.0.0",
            questionKind: "boolean",
            outputSchema: "vendor-triage.verification@1.0.0",
          })
          .code("decide", { handler: "vendor.decide@1.0.0" })
          .end(),
    },
    default: (b) => b.escalate("full-agent", { reason: "classification was uncertain" }),
  })
  .build();
```

Seven nodes. The emitted IR, in excerpt:

```jsonc
{
  "schemaVersion": 1,
  "id": "vendor-triage-v1",
  "version": "1.0.0",
  "domain": "vendor-triage",
  "jobType": "vendor-triage",
  "inputSchema": "vendor-triage.input@1.0.0",
  "outputSchema": "vendor-triage.output@1.0.0",
  "entry": "classify",
  "nodes": {
    "classify": {
      "id": "classify", "type": "jev", "version": "1.0.0",
      "inputSchema": "vendor-triage.input@1.0.0",
      "outputSchema": "vendor-triage.classification@1.0.0",
      "timeoutMs": 60000, "retry": { "maxAttempts": 1 }, "budget": {}, "permissions": [],
      "input": { "kind": "input" },
      "question": { "id": "vendor.classification", "version": "1.0.0" },
      "questionKind": "choice",
      "next": "route"
    },
    "route": {
      "id": "route", "type": "branch", "version": "1.0.0",
      "inputSchema": "vendor-triage.classification@1.0.0",
      "outputSchema": "vendor-triage.classification@1.0.0",
      "timeoutMs": 60000, "retry": { "maxAttempts": 1 }, "budget": {}, "permissions": [],
      "input": { "kind": "node", "node": "classify" },
      "on": { "kind": "field", "path": ["category"] },
      "cases": { "clear": "finalize", "research": "research" },
      "default": "full-agent"
      // no `next`: each case continues the graph
    },
    "finalize": {
      "id": "finalize", "type": "code", "version": "1.0.0",
      "inputSchema": "vendor-triage.classification@1.0.0",
      "outputSchema": "vendor-triage.output@1.0.0",   // derived: it ends the workflow
      "timeoutMs": 60000, "retry": { "maxAttempts": 1 }, "budget": {}, "permissions": [],
      "input": { "kind": "node", "node": "route" },
      "handler": { "id": "vendor.finalize", "version": "1.0.0" },
      "next": null
    },
    "research": {
      "id": "research", "type": "agent", "version": "1.0.0",
      "inputSchema": "vendor-triage.classification@1.0.0",
      "outputSchema": "vendor-triage.evidence@1.0.0",
      "timeoutMs": 120000, "retry": { "maxAttempts": 1 }, "budget": {},
      "permissions": [{ "toolId": "lookup_vendor_evidence", "mode": "read" }],
      "input": { "kind": "node", "node": "route" },
      "agent": { "id": "vendor-researcher", "version": "1.0.0" },
      "next": "verify"
    },
    // "verify" (jev) -> "decide" (code, next: null, outputSchema = the workflow's)
    "full-agent": {
      "id": "full-agent", "type": "escalate", "version": "1.0.0",
      "inputSchema": "vendor-triage.classification@1.0.0",
      "outputSchema": "vendor-triage.classification@1.0.0",  // derived: it passes input through
      "timeoutMs": 60000, "retry": { "maxAttempts": 1 }, "budget": {}, "permissions": [],
      "input": { "kind": "node", "node": "route" },
      "reason": "classification was uncertain"
      // no `next`: terminal
    }
  }
}
```

Handed to `compileWorkflow(definition, registry)` with the five schemas, two handlers, one agent
and one tool registered, it produces a `CompiledWorkflow` with no issues. A Jev question is **not**
resolved, because a question is not a capability kind (M3 owns it).

Two of the validator's rules are about a workflow as a whole and the DSL cannot enforce them, so a
definition it builds may still fail to compile:

- **A workflow needs a reachable `escalate` node** (north-star invariant 1). Most of the small
  examples in this document have none, and would not compile.
- **A `{ kind: "node", node: X }` binding must name a node that *dominates* the reader.** A `map`
  or `loop` body may run zero times, so nothing after one may bind to a node inside it. The DSL's
  own defaults never produce such a binding — a node after a `map` binds to the `map` itself — but
  an explicitly stated one can.

## Determinism

`build()` is a pure function of what was written. Two builds of the same workflow are deep-equal,
and `workflowFingerprint()` of either is the same value. Because `canonicalJson` sorts object keys
([ADR-0029](../decisions/0029-canonical-json-and-sha-256-behavior-fingerprints.md)), the order
independent settings were written in does not reach the fingerprint: two builders that list a
branch's cases in different orders, or a node's options in different orders, produce the same
digest. What *does* reach it is the graph — a changed edge, a changed timeout, a narrowed
permission — which is correct, because each is a behavior change (north-star invariant 4).

A definition also survives a JSON round trip unchanged:
`workflowFingerprint(JSON.parse(JSON.stringify(definition)))` equals
`workflowFingerprint(definition)`. That is the Milestone 4 acceptance criterion "DSL output can be
serialized to canonical IR".

## Where the symbols live

| Symbol | Module |
| --- | --- |
| `workflow()` | `packages/workflow/src/dsl/builder.ts` |
| `WorkflowOptions`, `WorkflowBuilder`, `SubGraphBuilder`, `SubGraph`, `SubGraphEnd`, `CommonNodeOptions` and the eleven per-type option types, `RefInput`, `TypedBinding`, `BranchSelectorInput`, `LoopConditionInput`, `NodeDefaults`, `DSL_NODE_DEFAULTS`, `DSL_WORKFLOW_VERSION_DEFAULT` | `packages/workflow/src/dsl/types.ts` |

All of them are re-exported by name from `@internal/workflow`.
