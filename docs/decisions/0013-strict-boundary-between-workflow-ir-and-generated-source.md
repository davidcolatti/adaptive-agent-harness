---
status: accepted
date: 2026-09-19
deciders: project owner (build plan); recorded during M0
related: [0006, 0007, 0016]
supersedes: null
superseded_by: null
---

# ADR-0013: Strict boundary between workflow IR and generated source; v1 is structural compilation only

## Context

AD-013 states: "The compiler agent NEVER directly writes executable production workflow source
as its authoritative output." The pipeline is defined as:

```text
learned evidence
      ↓
compiler optimization plan
      ↓
candidate Workflow IR
      ↓
schema + graph + permission validation
      ↓
deterministic code generator
      ↓
TypeScript source
      ↓
format + lint + typecheck + Workflow build
      ↓
replay + eval
      ↓
promotion
```

"The LLM may propose IR. The source generator is ordinary deterministic TypeScript owned by the
harness." AD-013 further scopes v1: "V1 compilation is structural compilation only. The compiler
may compose registered nodes, agents, tools, Jev questions, policies, and deterministic
handlers. It may not invent arbitrary executable handler code. Generating new executable
capabilities is a later, separately gated feature." Milestone 8 (M8-T3, M8-T4) operationalizes
this exactly: the compiler produces a candidate IR plan first, validated (rejecting unknown
tools/schemas, unsupported node types, unbounded loops, undeclared writes, missing fallback,
incompatible outputs) before any source generation; only after IR validation and capability
resolution does `packages/codegen` generate TypeScript, and the generator "emits no arbitrary
model-provided source snippets."

## Decision

The compiler (`packages/compiler`) MUST produce only a candidate workflow IR as its output; it
MUST NOT emit or write executable TypeScript source directly. All executable source MUST come
from the deterministic code generator (`packages/codegen`, per ADR-0016) operating on a
schema-validated, graph-validated, permission-validated, capability-resolved canonical IR. In v1,
the compiler is restricted to structural compilation: it may only compose already-registered
capabilities (nodes, agents, tools, Jev questions, policies, deterministic handlers from the
`CapabilityRegistry`, see ADR-0015); it MUST NOT invent new executable handler code or arbitrary
source snippets. Generating genuinely new executable capabilities (as opposed to composing
existing registered ones) is out of scope for this plan and MUST be treated as a later,
separately gated feature requiring its own safety review.

## Consequences

### Positive

- Removes an entire class of risk (arbitrary LLM-authored executable code reaching a production
  workflow) by construction, since the only path from "compiler proposal" to "runnable code" goes
  through IR validation and a deterministic, non-LLM code generator.
- Keeps compiler output auditable at the IR level: a reviewer can inspect what capabilities were
  composed and how, without having to trust that generated TypeScript faithfully reflects intent,
  because the generator is deterministic and testable independent of any specific LLM output.

### Negative

- V1's structural-compilation-only restriction means the compiler cannot help with jobs that
  genuinely need new executable logic beyond composing existing registered handlers; those cases
  must fall back to the full agent (or wait for a later, separately gated capability-generation
  feature).
- Requires maintaining a strict, enforced boundary (validation gates) between "compiler output"
  and "code generator input" so that no shortcut path lets compiler-proposed source bypass
  validation.

### Neutral

- Constrains Milestone 8 (Compiler v1), which implements exactly this pipeline (IR-first
  generation, static validation, candidate replay, bounded repair loop), and Milestone 9 (which
  gates promotion of whatever the pipeline ultimately produces).
- Constrains `packages/compiler` (IR proposal only) and `packages/codegen` (deterministic
  generation, ADR-0016).

## Alternatives considered

- **Let the compiler LLM write executable TypeScript directly, then lint/typecheck it**:
  rejected explicitly by AD-013 ("The compiler agent NEVER directly writes executable production
  workflow source as its authoritative output").
- **Allow v1 compilation to generate genuinely new executable handler code (not just compose
  registered capabilities)**: rejected; AD-013 restricts v1 to structural compilation and defers
  "generating new executable capabilities" to a later, separately gated feature.

## References

- `docs/milestones/build-plan.md` §1 AD-013, Milestone 8 (M8-T3, M8-T4), Appendix Bridge Audit
  Checklist ("compiler -> candidate: IR only")
- Related ADRs: 0006, 0007, 0016
- Related code paths: `packages/compiler`, `packages/codegen`
