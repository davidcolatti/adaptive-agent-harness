# Contracts

This directory holds documentation for the stable boundaries and schemas the rest of the system is
built against: `Job`, `DomainDefinition`, `AgentRuntime`, `DecisionEngine`, `WorkflowNode`/control
shapes, `CapabilityRegistry`, `FallbackContext`, and similar. Contracts are described here in prose
and type form, not as implementation; the actual code lives in `packages/core` and the other
harness packages.

Contract documents carry the same frontmatter rule as architecture documents. Every file under
`docs/contracts/` must include:

```yaml
---
status: active
owner: core
last_verified: YYYY-MM-DD
related:
  - docs/...
implementation:
  - packages/...
---
```

## Contracts

The table below lists this directory's contract files and the ones the build plan's repository
layout still plans, with their target milestone and a one-line summary.

| File | Status | Summary |
|---|---|---|
| `execution-context.md` | active (M1-T7) | `ExecutionContext` and its supporting types: run/job IDs, domain reference, attempt, budget, tool grants, trace writer, abort signal and runtime metadata. |
| `errors.md` | active (M1-T8) | The nine-class harness error taxonomy and the whitelisted, stack-free representation every error serializes into. |
| `job.md` | planned (M2) | The immutable unit of work: domain, job type, objective, input, contract references, budget, and permissions. |
| `trace-event.md` | planned (M2) | The append-only structured event stream that reconstructs an execution without application logs. |
| `workflow-ir.md` | planned (M4) | The versioned, serializable intermediate representation that is the authoritative source of compiled workflow semantics. |
| `agent-runtime.md` | planned (M1) | The `AgentRuntime` interface that runs a job through any AI-SDK-compatible agent implementation. |
| `decision-engine.md` | planned (M3) | The `DecisionEngine` interface for bounded probabilistic judgments, implemented first by Jev. |
| `promotion-policy.md` | planned (M6) | The quality/regression/false-auto/fallback thresholds a candidate workflow must clear before promotion. |

Two contracts are implemented, both in `packages/core`: the execution context (M1-T7) and the
error taxonomy (M1-T8). The rest of build plan section 5 (`Job`, `DomainDefinition`,
`AgentRuntime`, `CapabilityRegistry`) is still to come in M1-T3 through M1-T6 and M1-T9, so
`packages/core` exports the two contracts above and nothing else yet.
