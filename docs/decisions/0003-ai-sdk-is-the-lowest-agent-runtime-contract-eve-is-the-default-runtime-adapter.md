---
status: accepted
date: 2026-09-19
deciders: project owner (build plan); recorded during M0
related: [0002, 0012, 0017]
supersedes: null
superseded_by: null
---

# ADR-0003: AI SDK is the lowest agent-runtime contract; eve is the default runtime adapter

## Context

AD-003 states the harness should understand an internal `AgentRuntime` abstraction "modeled
around AI SDK agents," with `eve` as "the first-class runtime adapter and expected default." The
stated benefit is future optionality: "This allows future use of another AI SDK-compatible
harness without rewriting the trace/compiler/workflow system." Build plan §5 (Core Contracts)
gives the conceptual contract:

```ts
interface AgentRuntime {
  run<TInput, TOutput>(
    job: Job<TInput, TOutput>,
    context: ExecutionContext
  ): Promise<AgentExecution<TOutput>>;
}
```

Milestone 1 (M1-T5, M1-T6) implements this as `AgentRuntime` plus an `EveAgentRuntime` adapter,
with the instruction to "not leak `eve` session details into core contracts," and the acceptance
criterion that "a fake `AgentRuntime` can replace `EveAgentRuntime` in a unit test."

## Decision

`AI SDK` (v7) MUST be treated as the lowest-level agent-runtime contract the harness understands.
`packages/core` MUST define the `AgentRuntime` interface above and MUST NOT import `eve`
directly (build plan §4 dependency rule). `packages/runtime-eve` MUST implement `AgentRuntime` as
`EveAgentRuntime` and MUST be the default runtime adapter used by `createHarness()`. `eve` is
adopted as the default agent runtime by explicit project-owner decision, not merely as one
option among equals. `EveAgentRuntime` MUST NOT leak `eve`-specific session types, IDs, or
objects through the `AgentRuntime`, `ExecutionContext`, or trace contracts; any `eve`-specific
detail needed downstream MUST be normalized first (see ADR-0010, ADR-0012).

## Consequences

### Positive

- Trace, compiler, and workflow systems are built against `AgentRuntime`, not `eve`, so a future
  AI SDK-compatible runtime could be substituted without rewriting those systems.
- Testability: a fake `AgentRuntime` can stand in for `EveAgentRuntime` in unit tests (M1
  acceptance criteria), keeping the bulk of the test suite free of live model/`eve` calls (build
  plan §8 Testing Strategy).

### Negative

- Introduces an adapter layer (`packages/runtime-ai-sdk`, `packages/runtime-eve`) even though
  `eve` is the only adapter actually built in the plan's scope; the abstraction has a carrying
  cost before it has a second implementation.
- Any `eve` capability not cleanly expressible through `AgentRuntime`/`ExecutionContext` requires
  deliberate normalization work rather than being passed through directly.

### Neutral

- Constrains Milestone 1 (`AgentRuntime`, `EveAgentRuntime`, `ExecutionContext`), Milestone 4
  (workflow `agent` nodes execute through this same contract), and Milestone 11 (eve production
  adapter validation against approvals, subagents, durable sessions, skills, tool grants, and
  tracing hooks).
- `packages/runtime-ai-sdk` and `packages/runtime-eve` sit directly beneath `packages/core` in
  the dependency graph (build plan §4).

## Alternatives considered

- **Hard-code `eve` as the only supported runtime, with no `AgentRuntime` abstraction**: rejected
  because AD-003 explicitly requires an `AgentRuntime` contract "modeled around AI SDK agents" so
  that another AI SDK-compatible harness could be used later without rewriting the
  trace/compiler/workflow system.

## References

- `docs/milestones/build-plan.md` §1 AD-003, §5 Core Contracts (`AgentRuntime`), Milestone 1
  (M1-T5, M1-T6), Milestone 11 (M11-T4), Appendix A (eve)
- Related ADRs: 0002, 0012, 0017
- Related code paths: `packages/core`, `packages/runtime-ai-sdk`, `packages/runtime-eve`
