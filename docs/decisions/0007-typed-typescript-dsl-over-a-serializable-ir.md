---
status: accepted
date: 2026-09-19
deciders: project owner (build plan); recorded during M0
related: [0006, 0013, 0015]
supersedes: null
superseded_by: null
---

# ADR-0007: Typed TypeScript DSL over a serializable IR; runtime never executes unvalidated generated source

## Context

AD-007 states: "The public authoring experience is a typed TypeScript DSL. A serializable
intermediate representation (IR) exists underneath it for: validation, fingerprints,
visualization, replay, compiler output, compatibility checks. The runtime must never execute
arbitrary unvalidated model-generated source directly." Milestone 4 (M4-T5) shows the target DSL
shape:

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

and states: "The DSL compiles to IR. The IR, not builder object identity, is fingerprinted."
Milestone 4 also defines the versioned IR shape (`WorkflowDefinition` with `schemaVersion`,
`nodes`, `entry`), node contracts (input/output schema, timeout, retry policy, budget,
permissions, version), and validation rules that reject unreachable nodes, missing nodes,
incompatible schemas, undeclared cycles, missing escalation targets, and duplicate IDs (M4-T4).
Section 13 explicitly rules out a "YAML workflow language" as something not to build early.

## Decision

Humans and (later) the compiler MUST author workflows through the typed TypeScript DSL
(`workflow(...)` builder, per M4-T5), never by hand-writing IR JSON or a separate configuration
language. The DSL MUST compile deterministically to the versioned, serializable IR defined in
M4-T1/M4-T2. Fingerprinting, validation, replay, compiler output, and compatibility checks MUST
operate on the canonicalized IR (per M4-T9), not on DSL builder object identity or in-memory
state. The local and (later) hosted runtimes MUST NOT execute arbitrary, unvalidated,
model-generated source directly; any executable behavior reaching the runtime MUST first pass
through IR validation (schema, graph, permission checks per M4-T4) and, for compiled workflows,
the deterministic code generator (ADR-0016).

## Consequences

### Positive

- Workflows get IDE type-checking and refactoring support during authoring while still producing
  a stable, versioned artifact (the IR) suitable for fingerprinting, replay, and compiler
  consumption.
- Structural validation (unreachable nodes, incompatible schemas, undeclared cycles, missing
  escalation targets, duplicate IDs) can run mechanically against the IR regardless of how a
  given workflow was authored (by hand or by the compiler).

### Negative

- Requires building and maintaining both a DSL-to-IR compiler and an IR-to-TypeScript code
  generator (ADR-0016), rather than treating one representation as sufficient.
- The DSL's ergonomics are constrained by the need to compile cleanly to canonical IR; not every
  TypeScript pattern a human author might prefer is necessarily expressible.

### Neutral

- Constrains Milestone 4 (Workflow IR, DSL, and Local Deterministic Runtime), which is where the
  IR schema, node contracts, control shapes, and DSL are first implemented, and Milestone 8
  (Compiler v1), which produces IR programmatically rather than DSL source text (M8-T3: "The
  compiler produces a candidate IR plan first. Validate it before source generation.").
- `packages/workflow` owns both the DSL and the IR schema/validator.

## Alternatives considered

- **A YAML (or other non-TypeScript) workflow configuration language**: rejected explicitly by
  §13 ("What Not to Build Early" lists "YAML workflow language").
- **Author workflows directly as hand-written TypeScript execution code, with no separate IR**:
  rejected; AD-007 requires a serializable IR beneath the DSL specifically so validation,
  fingerprinting, replay, and compiler output do not depend on parsing or re-executing arbitrary
  TypeScript, and so the runtime never executes unvalidated generated source directly.

## References

- `docs/milestones/build-plan.md` §1 AD-007, §13 What Not to Build Early, Milestone 4 (M4-T1
  through M4-T5, M4-T9)
- Related ADRs: 0006, 0013, 0015
- Related code paths: `packages/workflow`
