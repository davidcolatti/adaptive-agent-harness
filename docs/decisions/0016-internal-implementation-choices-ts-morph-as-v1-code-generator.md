---
status: accepted
date: 2026-09-19
deciders: project owner (build plan); recorded during M0
related: [0006, 0013, 0014]
supersedes: null
superseded_by: null
---

# ADR-0016: Internal implementation choices are recorded explicitly; ts-morph is the v1 deterministic code generator

## Context

AD-016 states the no-assumption rule from AD-011 applies to external framework behavior and to
project architecture equally: "When Vercel does not prescribe a choice, this project MAY choose
one, but the choice must be explicit." Examples given: canonical JSON encoding for fingerprints,
source-generator library, UUID implementation, database indexing strategy, CLI framework.
"Material architecture choices receive an ADR. Small implementation choices are recorded in the
task work log." AD-016 then makes the project's own choice explicit: "For v1 source generation,
this project chooses ts-morph as the project-owned deterministic TypeScript AST/code-generation
library. This is not a Vercel requirement. Codegen consumes only validated IR and the capability
manifest, writes generated modules, then Biome formats them." Milestone 8 (M8-T4) operationalizes
this: after IR validation and capability resolution, `packages/codegen` generates TypeScript
using ts-morph, from inputs limited to "validated canonical IR, capability manifest, codegen
version, target backend"; the generator resolves capability references to manifest module/export
data, creates static typed imports, emits orchestration from known node/control templates, emits
no arbitrary model-provided source snippets, writes `workflow.ir.json` and
`workflow.generated.ts`, runs Biome formatting, and reparses/compiles the generated module as
validation.

## Decision

`ts-morph` is adopted as the project-owned, deterministic TypeScript AST manipulation and
code-generation library used by `packages/codegen` for v1 source generation. This is an internal
implementation choice, not a Vercel-prescribed requirement, and is recorded here per AD-016
rather than left implicit. The code generator MUST take only validated canonical IR, the
capability manifest, a codegen version identifier, and a target backend as input; it MUST NOT
accept or emit arbitrary model-provided source snippets. Generated modules MUST be formatted with
Biome after generation and MUST be reparsed/compiled as a validation step before being considered
valid output. Other internal implementation choices not prescribed by Vercel (canonical JSON
encoding for fingerprints, UUID implementation, database indexing strategy, CLI framework, and
similar) MUST likewise be made explicit: material architecture choices of this kind require their
own ADR, while smaller implementation choices are recorded in the relevant task's WORKLOG entry
(ADR-0014) rather than left as silent, undocumented defaults.

## Consequences

### Positive

- Gives the compiler pipeline (ADR-0006, ADR-0013) a concrete, deterministic mechanism for
  producing `workflow.generated.ts` from validated IR, satisfying the "deterministic code
  generator" step in AD-013's pipeline and the CI regeneration check in AD-006.
- Establishes a general norm (explicit recording of non-Vercel-prescribed choices) that prevents
  silent architectural drift across a project with many coding agents and sessions over time.

### Negative

- Commits the project to ts-morph's API and TypeScript-AST-based approach for v1 codegen;
  switching source-generation strategies later (e.g., to raw string templating or a different AST
  library) would require a superseding ADR and rework of `packages/codegen`.
- Requires every other "Vercel does not prescribe this" choice (JSON canonicalization, UUID
  scheme, indexing, CLI framework) to be actively decided and recorded rather than picked
  implicitly by whichever engineer or agent happens to write the code first.

### Neutral

- Constrains Milestone 8 (Compiler v1, M8-T4 deterministic source generation) and the CI
  regeneration check (ADR-0006) that depends on ts-morph's output being reproducible from the
  same IR input.
- Constrains `packages/codegen` directly; touches `packages/workflow` insofar as the IR shape it
  produces must be codegen-consumable.

## Alternatives considered

- **Leave the code-generation library choice unstated/implicit, decided ad hoc when Milestone 8
  begins**: rejected; AD-016 requires internal implementation choices to be explicit and, where
  material, recorded in an ADR rather than implied.
- **Use raw string templating instead of an AST-based generator**: not the option the plan
  selects; AD-016 explicitly names ts-morph as "the project-owned deterministic TypeScript
  AST/code-generation library" for v1, which this ADR records as the binding choice.

## References

- `docs/milestones/build-plan.md` §1 AD-016, §1 AD-011 (no-assumption rule extended to internal
  choices), Milestone 8 (M8-T4)
- Related ADRs: 0006, 0013, 0014
- Related code paths: `packages/codegen`
