---
status: accepted
date: 2026-09-19
deciders: project owner (build plan); recorded during M0
related: [0001, 0009, 0017]
supersedes: null
superseded_by: null
---

# ADR-0008: Learning is domain-isolated and scoped by organization -> domain -> job type

## Context

AD-008 states learning data is scoped by `organization/workspace -> domain -> job type`, and
that "cross-domain reuse happens only through explicit promotion into a shared primitive
registry." Milestone 10 operationalizes this: namespace isolation (M10-T3) requires registry
keys to include domain and job type, so "no workflow from domain A is eligible for domain B
unless explicitly published as shared," with the acceptance criterion "workflow registry never
cross-routes by accident." The shared primitive registry (M10-T4) is a distinct, explicit
mechanism (`shared/verify-evidence`, `shared/research-entity`, `shared/classify-intent`), and
promotion into it requires multiple-domain evidence, compatible contracts, and explicit approval.
North-Star Invariant #11 (§17) states: "Learning from one domain does not silently alter
another." Milestone 7 similarly scopes learning batch selection "by domain, job type, behavior
fingerprint, SOP version, date range, outcome" and forbids mixing incompatible policy versions
(M7-T1).

## Decision

All learning data (notes, learnings, learning batches, compiler runs) MUST be scoped and keyed by
organization/workspace, domain, and job type. Learning selectors (M7-T1) MUST NOT mix runs across
incompatible domains, job types, or policy versions, and MUST additionally track SOP version as
part of that scope: a learning batch is valid only across runs sharing a compatible SOP lineage,
so a SOP revision that changes behavior-affecting guidance starts a new learning scope rather than
silently blending with evidence gathered under the prior SOP. The workflow registry MUST key entries by
domain and job type (M10-T3) so that no workflow authored for one domain is ever eligible for
another domain by accident. Cross-domain reuse of a capability, learning, or workflow fragment is
permitted only through an explicit, separately governed promotion into the shared primitive
registry (M10-T4), which itself requires multiple-domain evidence, compatible contracts, and
explicit approval; it MUST NOT happen implicitly as a side effect of learning or compilation.

## Consequences

### Positive

- Prevents one domain's idiosyncratic behavior from silently leaking into or corrupting another
  domain's learned workflows, directly satisfying North-Star Invariant #11.
- Gives the project a deliberate, auditable path (the shared primitive registry) for genuine
  cross-domain reuse, rather than leaving it to registry lookup accidents.

### Negative

- Each domain must accumulate its own evidence independently before learning or compilation can
  proceed for it; there is no free cross-domain transfer of learned behavior.
- Building and governing the shared primitive registry (promotion criteria, compatible-contract
  checks) is additional scope beyond per-domain learning itself.

### Neutral

- Constrains Milestone 7 (Learning Layer, batch selection scoping), Milestone 8 (Compiler v1,
  which consumes only validated, domain-scoped learnings), and Milestone 10 (Multi-Domain SDK,
  namespace isolation and shared primitive registry).
- Constrains `packages/learner`, `packages/registry`, and the `learning_runs` /
  `compiler_runs` tables (build plan §9), which carry `domain_id` and `job_type` as scoping keys.

## Alternatives considered

- **Global, unscoped learning store shared across all domains**: rejected; this is precisely
  what AD-008 and Invariant #11 forbid, and it would make the registry's namespace-isolation
  acceptance criteria (M10) meaningless.
- **Implicit cross-domain generalization by the compiler when it notices similar patterns**:
  rejected; AD-008 requires cross-domain reuse to happen "only through explicit promotion into a
  shared primitive registry," never automatically.

## References

- `docs/milestones/build-plan.md` §1 AD-008, §17 Invariant #11, Milestone 7 (M7-T1), Milestone 10
  (M10-T3, M10-T4), §9 Supabase Data Model (`learning_runs`, `compiler_runs`)
- Related ADRs: 0001, 0009, 0017
- Related code paths: `packages/learner`, `packages/registry`
