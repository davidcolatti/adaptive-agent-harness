---
status: accepted
date: 2026-09-19
deciders: project owner (build plan); recorded during M0
related: [0006, 0009, 0013]
supersedes: null
superseded_by: null
---

# ADR-0005: Human-reviewed promotion precedes autonomous promotion

## Context

AD-005 defines the promotion pipeline as `trace -> learn -> compile -> sandbox/test -> replay ->
eval -> promotion policy -> production workflow`, and states: "Early versions stop before
automatic promotion and require explicit developer approval. Autonomous promotion is a later
capability and must never bypass promotion policy." North-Star Invariant #13 (§17) reinforces
this: "Generated code cannot directly self-promote." Invariant #12 adds: "Cost improvement
cannot compensate for an unacceptable quality regression." Milestone 9's acceptance criteria
require that "candidate cannot become active without promotion policy pass" and that "early
version also requires explicit human approval" via `pnpm harness workflow promote <version>`
(M9-T5), which must show the eval report and require explicit confirmation. Milestone 12
("Optional autonomous promotion", M12-T4) only relaxes this, and only under an explicit,
disableable policy with strict requirements.

## Decision

Every promotion of a compiled workflow to `active` status MUST require an explicit human
approval step through Milestone 9 (`pnpm harness workflow promote <version>`, showing the eval
report and requiring confirmation). No milestone before Milestone 12 MAY implement code that
transitions a workflow to `active` without that human confirmation. When Milestone 12 introduces
optional autonomous promotion, it MUST still pass through the same promotion-policy gate
(promotion policy pass, reserved-set pass, minimum sample size, no critical eval failures, no new
external-write permission, no SOP incompatibility, no security-sensitive change, and an existing
rollback target, per M12-T4) and MUST be disableable globally. Cost improvement alone MUST NOT be
sufficient grounds for promotion at any milestone (build plan §6, M6-T8: "Cost improvement alone
can never promote a workflow").

## Consequences

### Positive

- Satisfies North-Star Invariant #13 (generated code cannot self-promote) and Invariant #12
  (quality regression cannot be bought back with cost savings) by construction.
- Keeps the safety bar high while the compiler is unproven, and gives the project a natural
  place (Milestone 9) to build and audit the promotion/rollback machinery before any autonomy is
  considered.

### Negative

- Throughput of the learn-compile-promote loop is bounded by human review capacity until
  Milestone 12, by design.
- The optional autonomous-promotion path in Milestone 12 adds meaningful policy-engineering
  surface area (drift detection, minimum sample sizes, permission-change detection) that must be
  built and tested even though it defaults to disabled.

### Neutral

- Constrains Milestone 9 (Safe Promotion, Shadowing, and Rollback), which introduces the human
  approval gate, the promotion audit trail, and rollback; and Milestone 12 (Hardening and
  Autonomous Optimization), the only milestone permitted to relax the gate, and only within
  policy.
- Constrains `packages/compiler`, `packages/replay`, `packages/evals`, and the `workflow_
  promotions` table (build plan §9).

## Alternatives considered

- **Allow the compiler to auto-promote once replay/eval pass**: rejected; AD-005 and Invariant
  #13 explicitly defer autonomous promotion to a later capability, and Milestone 9's acceptance
  criteria require explicit human approval even after policy checks pass.

## References

- `docs/milestones/build-plan.md` §1 AD-005, §17 Invariants #12, #13, §9 Supabase Data Model
  (`workflow_promotions`), Milestone 9, Milestone 12 (M12-T4)
- Related ADRs: 0006, 0009, 0013
- Related code paths: `packages/compiler`, `packages/replay`, `packages/evals`
