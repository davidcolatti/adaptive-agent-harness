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

## Planned contracts

The table below lists the contract files planned in the build plan's repository layout, their
target milestone, and a one-line summary. None of them exist yet.

| File | Status | Summary |
|---|---|---|
| `job.md` | planned (M2) | The immutable unit of work: domain, job type, objective, input, contract references, budget, and permissions. |
| `trace-event.md` | planned (M2) | The append-only structured event stream that reconstructs an execution without application logs. |
| `workflow-ir.md` | planned (M4) | The versioned, serializable intermediate representation that is the authoritative source of compiled workflow semantics. |
| `agent-runtime.md` | planned (M1) | The `AgentRuntime` interface that runs a job through any AI-SDK-compatible agent implementation. |
| `decision-engine.md` | planned (M3) | The `DecisionEngine` interface for bounded probabilistic judgments, implemented first by Jev. |
| `promotion-policy.md` | planned (M6) | The quality/regression/false-auto/fallback thresholds a candidate workflow must clear before promotion. |

No contracts are implemented in Milestone 0. `packages/core/src/index.ts` is intentionally an
empty boundary (a comment plus `export {}`) until Milestone 1 begins filling in these contracts.
