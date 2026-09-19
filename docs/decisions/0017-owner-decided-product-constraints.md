---
status: accepted
date: 2026-09-19
deciders: project owner (build plan); recorded during M0
related: [0001, 0006, 0008, 0009, 0013, 0015]
supersedes: null
superseded_by: null
---

# ADR-0017: Owner-decided product constraints without a single natural ADR home

## Context

Before Milestone 0 began, the repository owner decided a set of project constraints that are
binding on the build but each individually too small, or too cross-cutting, to justify its own
architectural decision record, and that do not fit cleanly inside any single ADR-0001 through
ADR-0016. Most owner-decided constraints (TypeScript/pnpm/GitHub, local-first development, no
v1 package distribution requirement, AI SDK as the runtime boundary, eve as the default runtime,
Jev as the first decision engine, the typed-DSL/IR authoring model, deterministic generated
source, and domain/SOP-lineage-scoped learning) are already folded into the Decision or
Consequences sections of ADR-0001 through ADR-0016. This ADR records the remaining constraints,
each as its own numbered sub-decision, per the build-plan sections that ground it.

## Decision

1. **Job types are explicit, developer-defined identifiers.** A `jobType` is a plain string
   identifier a domain developer defines and assigns deliberately (build plan §5 Job/
   `DomainDefinition`); it is never inferred, generated, or fuzzily matched. Registry, routing,
   and learning scoping (ADR-0008) all key off this identifier as an opaque, stable string.
   *Rationale:* fuzzy job-type inference would break the deterministic routing and namespace
   isolation Milestone 5 and Milestone 10 depend on. *First affects:* Milestone 1 (`Job`,
   `DomainDefinition.createJob`).

2. **SOPs are domain-owned Markdown documents.** Standard operating procedures live as Markdown
   in the owning domain repository and are referenced from the `Job` contract's `contracts.sop`
   field (build plan §5) and from agent scaffolding (`agent/instructions.md`, Milestone 1,
   M1-T2). *Rationale:* Markdown keeps SOPs human-reviewable, diffable in git, and consistent
   with `eve`'s filesystem-first authored-slot convention (AD-012), without inventing a bespoke
   SOP format. *First affects:* Milestone 1 (example agent scaffold, `DomainDefinition`).

3. **Compilation requires quality evals to already exist.** A domain cannot be a compilation
   target until it has `evals: DomainEval[]` defined (build plan §5), because Milestone 6's
   promotion gate and Milestone 8's compiler input contract both consume baseline metrics derived
   from those evals. *Rationale:* without evals there is no baseline to protect against
   regression, and North-Star Invariant #12 (cost cannot buy back a quality regression) is
   unenforceable without one. *First affects:* Milestone 1 (`DomainDefinition.evals` required),
   enforced at Milestone 6 (promotion gate) and Milestone 8 (compiler input contract).

4. **Model roles are aliases/configuration, not hard-coded workflow semantics.** Workflow and
   agent definitions reference a model by role/alias (for example "primary" or "fast"), resolved
   through AI Gateway configuration (build plan §3 Runtime Responsibility Matrix: "Model access =
   AI Gateway"; Milestone 11, M11-T3 centralizes "model aliases, provider settings, budgets,
   retry/fallback policy"), never by embedding a literal model identifier in IR or generated
   source. *Rationale:* keeps model selection a swappable configuration concern, so upgrading or
   substituting a model does not require recompiling or hand-editing workflow logic.
   *First affects:* Milestone 1 (agent/runtime configuration), formalized by Milestone 11
   (M11-T3 AI Gateway configuration).

5. **Compiler-generated Jev questions are versioned capabilities.** When the compiler composes a
   Jev question into a candidate workflow (AD-013, structural compilation), that question is
   registered and versioned the same way any other capability is (AD-015), carrying the same
   question ID/version discipline Milestone 3 already requires for decision evidence (M3-T3).
   *Rationale:* keeps compiler-composed judgment calls replayable and pinned to an exact version
   on promotion, exactly like any other capability reference. *First affects:* Milestone 3
   (question ID/version contract), applied by Milestone 8 (compiler composing Jev questions).

6. **Compiled workflows may perform writes in v1, subject to the plan's safety model.** V1 does
   not forbid external side effects from compiled workflows; instead, every `call` node MUST
   declare whether it is read-only, an idempotent write, or a non-idempotent write, and
   non-idempotent writes require explicit protection (build plan §5 Milestone 4, M4-T7), with
   node permissions granted explicitly per node (M4-T8). *Rationale:* real automation value
   requires writes; the safety mechanism is explicit classification and idempotency protection,
   not a blanket prohibition. *First affects:* Milestone 4 (`call` node idempotency and tool
   grants).

7. **Learning never depends on hidden chain-of-thought.** Per-run learning notes and batch
   retrospectives (Milestone 7, M7-T2/M7-T3) are generated from structured, replayable evidence:
   the trace (ADR-0010), stored Jev decisions (ADR-0009), and eval outcomes, not from a model's
   internal reasoning trace. *Rationale:* hidden chain-of-thought is not a stable, inspectable,
   or reliably available signal, and building learning on it would violate the trace's role as
   the sole record needed to reconstruct execution (AD-010). *First affects:* Milestone 7
   (learning batch selector and per-run notes).

8. **The compiler may optimize domain workflows but may never modify harness, compiler,
   security, or promotion infrastructure itself.** Milestone 8's own goal states this directly:
   "The compiler should be constrained. It is not allowed to invent arbitrary infrastructure."
   The compiler's write surface is limited to producing candidate workflow IR for a domain
   (AD-013); it has no path to alter `packages/compiler`, `packages/codegen`, the promotion gate
   (Milestone 9), or any security/permission check. *Rationale:* an optimizer that could edit the
   mechanisms validating and gating it could disable its own safety net; keeping that
   infrastructure outside its blast radius is what makes autonomous optimization (Milestone 12)
   possible to reason about at all. *First affects:* Milestone 8 (Compiler v1 goal and input
   contract).

## Consequences

### Positive

- Closes gaps the plan's numbered architectural decisions (AD-001 through AD-016) do not
  individually cover, without inflating those ADRs with unrelated concerns.
- Gives each constraint a single, citable, versioned record and a milestone trigger, so a
  reviewer encountering a violation of any of these eight rules can trace it back to an explicit
  decision rather than an implicit assumption.

### Negative

- Bundling eight otherwise-unrelated constraints into one ADR trades topical cohesion for
  avoiding ADR sprawl; a future reviewer must read the whole document to find one specific rule.

### Neutral

- Constrains Milestone 1 (items 1, 2, 3, 4), Milestone 3 (item 5), Milestone 4 (item 6),
  Milestone 7 (item 7), and Milestone 8 (items 5, 8) as noted per sub-decision above.

## Alternatives considered

- **Fold each of these into whichever existing ADR is topically nearest** (for example, item 8
  into ADR-0013, item 7 into ADR-0010): considered, but each of these eight constraints is either
  a distinct owner decision not stated by any single AD-00N in the build plan, or would require
  stretching an existing ADR's scope beyond the specific decision it documents; a single
  consolidated ADR was judged clearer than eight small edits to unrelated ADRs.
- **Leave these as undocumented conventions enforced only by code review**: rejected; AD-016's
  own principle (record internal implementation and product choices explicitly rather than
  implying them) applies here as much as to codegen tooling choices.

## References

- `docs/milestones/build-plan.md` §3 Runtime Responsibility Matrix, §5 Core Contracts, Milestone
  1, Milestone 3 (M3-T3), Milestone 4 (M4-T7, M4-T8), Milestone 6, Milestone 7 (M7-T2, M7-T3),
  Milestone 8 (Goal, M8-T1), Milestone 11 (M11-T3), §17 Invariant #12
- Related ADRs: 0001, 0006, 0008, 0009, 0013, 0015
