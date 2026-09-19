---
status: accepted
date: 2026-09-19
deciders: project owner (build plan); recorded during M0
related: [0001, 0003, 0011, 0012]
supersedes: null
superseded_by: null
---

# ADR-0002: Vercel-native architecture without internal Vercel lock-in

## Context

AD-002 directs the project to "use Vercel primitives deeply where they save meaningful
infrastructure work": AI SDK 7, `eve`, AI Gateway, Jev, Vercel Workflow, and Vercel Sandbox. It
explicitly states: "Do not build speculative provider portability. Create clean internal
boundaries only where they naturally improve testing and ownership." Section 13 ("What Not to
Build Early") separately rules out building a custom model gateway, a custom durable workflow
engine, and a custom sandbox: exactly the kinds of work a speculative portability layer would
require.

## Decision

The harness MUST adopt Vercel's agent and workflow primitives directly rather than building a
provider-agnostic abstraction over multiple vendors "just in case." Internal adapter packages
(`packages/runtime-eve`, `packages/decision-jev`, `packages/storage-supabase`, `packages/
workflow`) MUST exist only where they improve testability and ownership boundaries per the
dependency rule in build plan §4 (for example, `packages/core` cannot import `eve` or Supabase
directly), not as a vendor-swap mechanism. The project MUST NOT build a custom model gateway, a
custom durable workflow engine, or a custom sandbox as long as AI Gateway, Vercel Workflow, and
Vercel Sandbox remain available and documented.

TypeScript, pnpm, and GitHub are the fixed toolchain for this project regardless of the
Vercel-native stance; they are project-owner decisions independent of the Vercel adapter choice.

## Consequences

### Positive

- Avoids speculative complexity the plan explicitly warns against (§13): no custom gateway,
  workflow engine, or sandbox to design, build, and maintain.
- Lets the harness capture real infrastructure savings (durable execution, model routing,
  bounded judgment) without also paying for portability it does not need.

### Negative

- The harness becomes structurally coupled to the Vercel ecosystem: `eve` (M1), Jev (M3), Vercel
  Workflow/Sandbox (M11). Migrating off Vercel primitives later would require new adapter
  packages, not a configuration change.
- Internal boundaries exist for testing/ownership, not vendor neutrality, so contract tests
  (build plan §8) must be relied on to keep adapters honest rather than a portability guarantee.

### Neutral

- Constrains Milestone 1 (`EveAgentRuntime`), Milestone 3 (`JevDecisionEngine`), Milestone 4
  (local-first workflow runtime as the interim primitive ahead of hosted Vercel Workflow), and
  Milestone 11 (Vercel Production-Primitive Adapters), which is explicitly gated to run "only
  after the local architecture works."

## Alternatives considered

- **Provider-portable abstraction layer**: design the harness against a generic multi-vendor
  agent/workflow/model interface from the outset. Rejected by AD-002 as "speculative provider
  portability."
- **Custom-built model gateway, durable workflow engine, or sandbox**: rejected outright by §13
  "What Not to Build Early," which lists all three explicitly.

## References

- `docs/milestones/build-plan.md` §1 AD-002, §3 Runtime Responsibility Matrix, §4 dependency
  rule, §13 What Not to Build Early, Milestone 11
- Related ADRs: 0001, 0003, 0011, 0012
- Related code paths: `packages/runtime-eve`, `packages/decision-jev`, `packages/
  storage-supabase`, `packages/workflow`
