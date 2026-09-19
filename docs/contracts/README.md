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
| `job.md` | active (M1-T3; M2-T2 extends) | The immutable unit of work: domain, job type, objective, input, contract references, budget, and permissions. |
| `domain-definition.md` | active (M1-T3) | `DomainDefinition`, `defineDomain()`, and the Standard Schema contract that lets a domain use any schema library while core keeps zero dependencies. |
| `agent-runtime.md` | active (M1-T5) | The `AgentRuntime` interface that runs a job through any AI-SDK-compatible agent implementation, its `AgentExecution` result, and the fake used to replace it in tests. |
| `trace-event.md` | planned (M2) | The append-only structured event stream that reconstructs an execution without application logs. |
| `workflow-ir.md` | planned (M4) | The versioned, serializable intermediate representation that is the authoritative source of compiled workflow semantics. |
| `decision-engine.md` | planned (M3) | The `DecisionEngine` interface for bounded probabilistic judgments, implemented first by Jev. |
| `promotion-policy.md` | planned (M6) | The quality/regression/false-auto/fallback thresholds a candidate workflow must clear before promotion. |

Five contracts are implemented, all in `packages/core`: the execution context (M1-T7), the error
taxonomy (M1-T8), `Job` and `DomainDefinition` with `defineDomain()` (M1-T3), and `AgentRuntime`
with `AgentExecution` (M1-T5). The schema contract that `DomainDefinition` depends on is a
harness-owned copy of Standard Schema v1, recorded in
[ADR-0027](../decisions/0027-standard-schema-is-the-harness-schema-contract.md) and documented in
`domain-definition.md`; it is what keeps `packages/core` at zero dependencies while a domain
authors its schemas in `zod`.

Of build plan section 5, `CapabilityRegistry` (M1-T9) and `DecisionEngine` (M3) are still to come,
and `FallbackContext` waits for M4. `job.md` is written against the M1 shape the build plan
states; M2-T2 finalizes it.
