---
status: accepted
date: 2026-09-19
deciders: project owner (build plan); recorded during M0
related: [0002, 0010, 0017]
supersedes: null
superseded_by: null
---

# ADR-0001: Harness is a reusable package, not a domain monorepo

## Context

The build plan's goal (build plan §0) is a reusable TypeScript agent harness installed into
many independent domain-agent repositories, illustrated as:

```text
marketing-site-agent
        |
        +---- @internal/adaptive-agent-harness

paid-ads-agent
        |
        +---- @internal/adaptive-agent-harness
```

The harness owns the execution lifecycle. Domain agents own their instructions, SOPs, tools,
skills, schemas, permissions, and domain evals. AD-001 states directly: "The harness is a
reusable package. Future domain agents should not live inside the harness repository." The
repository may contain a neutral example app for development and integration testing only.

## Decision

This repository MUST be developed and packaged as a reusable library (`@internal/
adaptive-agent-harness` and its workspace packages), not as a home for any production domain
agent's instructions, SOPs, tools, skills, or schemas. Real domain agents (marketing-site-agent,
paid-ads-agent, pmm-agent, and future domains) MUST live in their own repositories and depend on
this package.

The repository MAY contain `apps/example-agent` and `apps/playground` as neutral, synthetic
fixtures used for development and integration testing (build plan §4 Repository Layout). These
apps MUST NOT encode real production domain logic and MUST NOT be treated as a template a
consuming repo copies wholesale; they exist to exercise the harness's own contracts.

No package publishing or external distribution pipeline is required for v1; local pnpm workspace
linking and packed-tarball installation (build plan Milestone 10, M10-T6) are sufficient proof of
reusability.

## Consequences

### Positive

- Keeps a hard ownership boundary between harness (execution lifecycle) and domain (behavior),
  which the whole architecture (Responsibility Matrix, build plan §3) depends on.
- Forces the public API and capability registry to be genuinely reusable rather than accreting
  domain-specific shortcuts.

### Negative

- The team cannot validate the harness against a real production domain early; it must build and
  maintain synthetic reference domains (vendor triage in M1, a second unrelated fixture such as
  document intake triage in M10-T5) to prove reuse.
- Extra packaging discipline (public API surface, versioning, install-from-tarball testing) is
  required earlier than it would be in a single-app project.

### Neutral

- Constrains `apps/example-agent`, `apps/playground`, and `packages/core` from day one (M1).
- Directly constrains Milestone 10 (Multi-Domain SDK), whose stated deliverable is "Proof that
  this is a harness, not a vendor-triage application," and its namespace-isolation and
  shared-primitive-registry requirements (M10-T3, M10-T4).
- `packages/core` MUST NOT import domain code (build plan §4 dependency rule), which is the
  structural enforcement of this ADR.

## Alternatives considered

- **Domain monorepo**: keep the harness and one or more production domain agents in the same
  repository. Rejected explicitly by AD-001 ("Future domain agents should not live inside the
  harness repository") because it would blur the ownership boundary the Responsibility Matrix
  depends on and make the harness's public API implicit rather than explicit.

## References

- `docs/milestones/build-plan.md` §0 Goal, §1 AD-001, §3 Runtime Responsibility Matrix, §4
  Repository Layout, Milestone 10
- Related ADRs: 0002, 0010, 0017
- Related code paths: `packages/core`, `apps/example-agent`, `apps/playground`
