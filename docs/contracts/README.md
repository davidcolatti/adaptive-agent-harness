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
| `identifiers.md` | active (M2-T1) | The sortable RFC 9562 UUIDv7 scheme every entity id is minted under, its strict-ordering guarantee, and the twelve branded id types (`JobId`, `RunId`, and ten more). |
| `execution-context.md` | active (M1-T7) | `ExecutionContext` and its supporting types: run/job IDs, domain reference, attempt, budget, tool grants, trace writer, abort signal and runtime metadata. |
| `errors.md` | active (M1-T8) | The nine-class harness error taxonomy and the whitelisted, stack-free representation every error serializes into. |
| `job.md` | active (M1-T3; M2-T2 extends) | The immutable unit of work: domain, job type, objective, input, contract references, budget, and permissions. |
| `domain-definition.md` | active (M1-T3) | `DomainDefinition`, `defineDomain()`, and the Standard Schema contract that lets a domain use any schema library while core keeps zero dependencies. |
| `agent-runtime.md` | active (M1-T5) | The `AgentRuntime` interface that runs a job through any AI-SDK-compatible agent implementation, its `AgentExecution` result, and the fake used to replace it in tests. |
| `harness.md` | active (M1-T4) | `createHarness()`: the public entry point, the single place input is validated before execution and a runtime's claimed output before success, and the run's trace events. |
| `capability-registry.md` | active (M1-T9) | `CapabilityRegistry` and the serializable `CapabilityManifest`: versioned schemas, agents, tools, handlers and policies, with behavior fingerprints and no executable source. |
| `trace-event.md` | planned (M2) | The append-only structured event stream that reconstructs an execution without application logs. |
| `workflow-ir.md` | planned (M4) | The versioned, serializable intermediate representation that is the authoritative source of compiled workflow semantics. |
| `decision-engine.md` | planned (M3) | The `DecisionEngine` interface for bounded probabilistic judgments, implemented first by Jev. |
| `promotion-policy.md` | planned (M6) | The quality/regression/false-auto/fallback thresholds a candidate workflow must clear before promotion. |

Eight contracts are implemented, all in `packages/core`: the execution context (M1-T7), the error
taxonomy (M1-T8), `Job` and `DomainDefinition` with `defineDomain()` (M1-T3), `AgentRuntime`
with `AgentExecution` (M1-T5), `createHarness()` (M1-T4), the capability registry with its
serializable manifest (M1-T9), and the entity identifier scheme (M2-T1). The schema contract that `DomainDefinition` depends on is a
harness-owned copy of Standard Schema v1, recorded in
[ADR-0027](../decisions/0027-standard-schema-is-the-harness-schema-contract.md) and documented in
`domain-definition.md`; it is what keeps `packages/core` at zero dependencies while a domain
authors its schemas in `zod`. The manifest's behavior fingerprints rest on a harness-owned
canonical JSON encoding, recorded in
[ADR-0029](../decisions/0029-canonical-json-and-sha-256-behavior-fingerprints.md).

Every entity in the system is named by a sortable, branded identifier. The scheme is RFC 9562
UUIDv7 with a monotonic counter, owned by the harness rather than taken from Node's
`crypto.randomUUIDv7()` (which its own documentation says is not strictly increasing), recorded in
[ADR-0030](../decisions/0030-sortable-uuidv7-entity-identifiers-owned-not-delegated.md) and
documented in `identifiers.md`. `Job.id`, `ExecutionContext.runId`/`jobId` and `TraceEvent.runId`
carry it today; the other nine brands exist as types with no field yet.

Of build plan section 5, `DecisionEngine` (M3) is still to come and `FallbackContext` waits for
M4. `job.md` is written against the M1 shape the build plan states; M2-T2 finalizes it.
