---
status: accepted
date: 2026-09-19
deciders: project owner (build plan); recorded during M0
related: [0007, 0013, 0016]
supersedes: null
superseded_by: null
---

# ADR-0006: Compiled workflows are committed source; IR is authoritative, generated TypeScript is never hand-edited

## Context

AD-006 states that git stores both `workflow.ir.json` (the compiler-authoritative semantic
representation) and `workflow.generated.ts` (deterministic generated execution source). "The IR
is the source of truth for compiled semantics. The TypeScript file is generated from that IR and
MUST NOT be manually edited. A regeneration check in CI fails if committed generated source
differs from deterministic codegen output." Supabase stores metadata, run history, status,
evaluations, fingerprints, lineage, and a reference to the promoted IR; git remains "the
canonical review/history surface for workflow implementation." AD-006 also states: "The harness
core should not own PR submission. A consuming repo may later install a GitHub integration that
takes a compiler-generated patch/branch and opens a PR." Build plan §11 elaborates: the compiler
produces a safe candidate artifact (source, IR, manifest, eval report, suggested commit message
and PR description); an optional `SourceControlPublisher` interface lets a consuming repo publish
it; for local development, the first implementation "should simply write candidates under
`.compiler/<run-id>/`."

## Decision

For every compiled workflow, the repository (or the consuming repo, once promoted) MUST commit
both `workflow.ir.json` and `workflow.generated.ts` as a pair. `workflow.ir.json` is the
authoritative semantic source; `workflow.generated.ts` MUST be produced only by the deterministic
code generator (see ADR-0016) and MUST NOT be hand-edited. CI MUST include a regeneration check
of the form `committed IR -> codegen -> generated TS == committed generated TS` (build plan
M8-T4), and a mismatch MUST fail the build. `packages/compiler` and harness core MUST NOT
implement GitHub PR submission; PR creation is out of scope for harness core and belongs, if
wanted, to an optional `SourceControlPublisher` adapter owned by the consuming repository (build
plan §11, M9-T6). Locally, uncommitted compiler candidates are written under `.compiler/
<run-id>/` before any promotion decision is made.

## Consequences

### Positive

- Compiled workflows remain inspectable and reviewable through ordinary git diff/PR workflows,
  giving a durable audit trail independent of the Supabase run ledger.
- Keeping GitHub write access out of harness core means the harness "works without GitHub
  credentials" (Milestone 9 acceptance criteria), and repository mutation stays under the control
  of whichever agent/repo actually uses the harness.

### Negative

- Requires building and maintaining a CI regeneration-check job, and a deterministic code
  generator capable of reproducing byte-identical (post-format) output from the same IR input.
  This is meaningful codegen-engineering surface area (see ADR-0016).
- The generated-source pair adds two committed files per workflow version that reviewers must be
  trained to treat asymmetrically (IR is source of truth, generated TS is a derived artifact).

### Neutral

- Constrains Milestone 8 (Compiler v1, which produces the IR/generated-source pair via `packages/
  codegen`), Milestone 9 (Git integration boundary, `SourceControlPublisher`, `GitHubSourceControlPublisher`
  as a later adapter), and CI (`.github/workflows/ci.yml`).
- The Supabase `workflow_versions` table stores `ir`, `fingerprint`, and `source_commit` alongside
  status, per build plan §9, linking the database record back to the git-committed pair.

## Alternatives considered

- **Store only the IR and generate TypeScript at build/run time without committing it**:
  rejected; AD-006 explicitly requires both files to be committed so git remains "the canonical
  review/history surface for workflow implementation."
- **Let the compiler agent write executable production source directly**: rejected; this is the
  specific case ADR-0013 (AD-013) forbids, and AD-006's "MUST NOT be manually edited" rule for
  generated TypeScript applies equally to model-authored edits.
- **Have harness core open GitHub PRs automatically**: rejected by AD-006 and by §13's explicit
  prohibition on "automatic GitHub writes"; PR ownership stays with an optional consuming-repo
  adapter.

## References

- `docs/milestones/build-plan.md` §1 AD-006, §1 AD-013, §11 GitHub and Pull Requests, §13 What
  Not to Build Early, §9 Supabase Data Model (`workflow_versions`), Milestone 8 (M8-T4), Milestone
  9 (M9-T6)
- Related ADRs: 0007, 0013, 0016
- Related code paths: `packages/codegen`, `packages/workflow`, `.github/workflows/ci.yml`
