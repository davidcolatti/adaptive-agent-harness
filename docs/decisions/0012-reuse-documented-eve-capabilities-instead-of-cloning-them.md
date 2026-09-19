---
status: accepted
date: 2026-09-19
deciders: project owner (build plan); recorded during M0
related: [0003, 0010, 0011, 0028]
supersedes: null
superseded_by: null
---

# ADR-0012: Reuse documented eve capabilities instead of cloning them

> **Amended by [ADR-0028](0028-eve-agent-runtime-is-a-url-only-client-that-observes-the-eve-event-stream.md)
> (2026-09-19).** The Decision below says agent-runtime observation "MUST go through
> `eve/hooks`". Read that clause as: *through the documented eve event stream, via `eve/hooks`
> in-process or via `eve/client` from a caller.* `eve`'s own documentation states the two carry
> the same envelope, and a hook runs inside the server process so it cannot reach a caller's
> `TraceWriter`. Nothing else in this ADR is changed, and the rule it exists to state, normalize
> the documented event stream rather than parse console logs, is unchanged.

## Context

AD-012 states: "The harness supplements `eve`; it does not create parallel versions of public
`eve` features without a concrete reason." It lists specific examples of required reuse: use
`eve` hooks/instrumentation as the agent-runtime observation source when the documented event
stream contains the needed event, and normalize those events into the harness trace schema
"rather than parsing console logs"; use `eve/evals` for domain-agent evals where its contract
fits; use `eve/client` for documented programmatic/session invocation when calling an eve
application over its public runtime boundary; use `eve` approvals/tool policies for agent-side
action approval; use documented `eve` sandbox/context APIs instead of internal runtime state; use
`defineWorkflowTool` only when a durable workflow is intentionally exposed as a tool to an eve
agent. AD-012 draws a clear line: "Harness-specific replay, compiler datasets, workflow
promotion, cross-run ledger data, and compiled-workflow routing remain harness responsibilities."

## Decision

Where `eve` already documents a public capability that meets a harness requirement, the harness
MUST use that capability rather than build a parallel implementation. Specifically: agent-runtime
observation MUST go through `eve/hooks`, normalized into the harness trace schema (see ADR-0010),
not through console-log parsing; domain-agent evals MUST use `eve/evals`'s `defineEval` where its
contract fits; programmatic/session invocation of an eve application MUST use `eve/client`;
agent-side action approval MUST use `eve`'s documented approvals/tool-policy mechanisms;
sandbox/context state MUST be read through documented `eve` sandbox/context APIs, not by
inspecting internal runtime state; and `defineWorkflowTool` MUST be used only when a durable
workflow is intentionally being exposed as a tool to an eve agent, not as a general workflow
invocation mechanism. Conversely, replay, compiler datasets, workflow promotion, cross-run ledger
data, and compiled-workflow routing are harness-owned responsibilities that MUST NOT be
delegated to or reimplemented from `eve` internals, since `eve` does not provide them.

## Consequences

### Positive

- Avoids maintaining a shadow copy of `eve` functionality that would drift from upstream
  behavior and updates, reducing long-term maintenance burden.
- Keeps the harness's own responsibilities (replay, compiler datasets, promotion, ledger,
  routing) clearly scoped to the things `eve` genuinely does not provide, which sharpens the
  Responsibility Matrix (build plan §3).

### Negative

- The harness's trace, evals, and approval systems are constrained by whatever `eve` documents
  and exposes publicly; a needed capability not yet documented by `eve` must be recorded as an
  open technical decision (per ADR-0011's no-assumption stop condition) rather than built around.
- Any future `eve` documentation or export change to a reused surface (hooks, evals, client,
  approvals) can require harness-side rework, since the harness's own contracts depend on it.

### Neutral

- Constrains Milestone 1 (eve adapter, must not leak eve session details while still using `eve`
  surfaces underneath), Milestone 2 (trace ingestion via `eve/hooks`), and Milestone 11 (eve
  production adapter validation of approvals, subagents, durable sessions, skills, tool grants,
  and tracing hooks against the currently installed `eve` version).
- Directly informs the `packages/runtime-eve` and `packages/trace` implementations.

## Alternatives considered

- **Build harness-owned equivalents of eve's hooks, evals, client, or approval mechanisms**:
  rejected; AD-012 states the harness "does not create parallel versions of public `eve` features
  without a concrete reason," and enumerates exactly these surfaces as ones to reuse.
- **Parse `eve` console/log output to reconstruct trace events**: rejected explicitly in favor of
  the documented `eve/hooks` event stream (see also ADR-0010).

## References

- `docs/milestones/build-plan.md` §1 AD-012, §3 Runtime Responsibility Matrix, Milestone 1
  (M1-T6), Milestone 11 (M11-T4), Appendix A (eve)
- Related ADRs: 0003, 0010, 0011
- Related code paths: `packages/runtime-eve`, `packages/trace`, `packages/evals`
