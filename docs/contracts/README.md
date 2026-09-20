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
| `job.md` | active (M1-T3; finalized M2-T2) | The immutable unit of work: domain, job type, objective, input, contract references, budget, and permissions. Deeply immutable, with `parseJob()` as the boundary that turns a stored value back into one. |
| `domain-definition.md` | active (M1-T3) | `DomainDefinition`, `defineDomain()`, and the Standard Schema contract that lets a domain use any schema library while core keeps zero dependencies. |
| `agent-runtime.md` | active (M1-T5) | The `AgentRuntime` interface that runs a job through any AI-SDK-compatible agent implementation, its `AgentExecution` result, and the fake used to replace it in tests. |
| `harness.md` | active (M1-T4) | `createHarness()`: the public entry point, the single place input is validated before execution and a runtime's claimed output before success, and the run's trace events. |
| `capability-registry.md` | active (M1-T9) | `CapabilityRegistry` and the serializable `CapabilityManifest`: versioned schemas, agents, tools, handlers and policies, with behavior fingerprints and no executable source. |
| `trace-event.md` | active (M2-T3, M2-T4) | The closed event taxonomy, the fifteen-field event, the run-scoped `TraceRecorder` that owns a run's order, the buffered writer with its local JSONL sinks, the redaction pass above them, and `parseTraceEvent()`, the read boundary an event comes back in through (M2-T10). |
| `redaction.md` | active (M2-T9) | What is removed from a trace event before anything buffers or stores it: field paths, secret patterns, headers and per-tool sanitizer hooks, applied by a `TraceWriter` decorator that sits above the buffer. |
| `behavior-fingerprint.md` | active (M2-T8) | The component-wise `sha256:` fingerprint over the behavior-affecting inputs — instructions, SOP, skills, tool definitions, model configuration, schemas, workflow IR and policy thresholds — supplied by the domain and stamped on every event of a run. |
| `storage.md` | active (M2-T5, M2-T6, M2-T7) | The `Storage` port the harness persists through, the outcome ledger row it writes, the thirteen-table Supabase schema behind it, and the sink that drains a run's trace into it. |
| `workflow-ir.md` | planned (M4) | The versioned, serializable intermediate representation that is the authoritative source of compiled workflow semantics. |
| `decision-engine.md` | planned (M3) | The `DecisionEngine` interface for bounded probabilistic judgments, implemented first by Jev. |
| `promotion-policy.md` | planned (M6) | The quality/regression/false-auto/fallback thresholds a candidate workflow must clear before promotion. |

Twelve contracts are implemented: the execution context (M1-T7), the error taxonomy (M1-T8), `Job`
and `DomainDefinition` with `defineDomain()` (M1-T3), `AgentRuntime` with `AgentExecution`
(M1-T5), `createHarness()` (M1-T4), the capability registry with its serializable manifest
(M1-T9), the entity identifier scheme (M2-T1), the trace event with its recorder and writer
(M2-T3, M2-T4), the behavior fingerprint (M2-T8), trace redaction (M2-T9), and the `Storage` port with its outcome ledger
(M2-T5, M2-T6, M2-T7). All live in `packages/core` except the trace's
persistence half, which is `packages/trace`: the buffered writer, the JSONL sinks and the
redaction pass above them, kept out of core so that core owns no storage decision and touches no
`node:fs`. Redaction is a `TraceWriter` decorator placed above the buffer, so "redact before
persistence" is structural rather than a convention every sink has to remember
([ADR-0035](../decisions/0035-redaction-is-a-trace-writer-decorator-placed-before-buffering.md)). The schema contract that `DomainDefinition` depends on is a
harness-owned copy of Standard Schema v1, recorded in
[ADR-0027](../decisions/0027-standard-schema-is-the-harness-schema-contract.md) and documented in
`domain-definition.md`; it is what keeps `packages/core` at zero dependencies while a domain
authors its schemas in `zod`. The manifest's behavior fingerprints rest on a harness-owned
canonical JSON encoding, recorded in
[ADR-0029](../decisions/0029-canonical-json-and-sha-256-behavior-fingerprints.md). What a *run's*
behavior fingerprint hashes, and why it is composed component by component and supplied by the
domain rather than gathered by the harness, is `behavior-fingerprint.md` and
[ADR-0034](../decisions/0034-behavior-fingerprint-is-component-wise-and-supplied-by-the-domain.md).

Every entity in the system is named by a sortable, branded identifier. The scheme is RFC 9562
UUIDv7 with a monotonic counter, owned by the harness rather than taken from Node's
`crypto.randomUUIDv7()` (which its own documentation says is not strictly increasing), recorded in
[ADR-0030](../decisions/0030-sortable-uuidv7-entity-identifiers-owned-not-delegated.md) and
documented in `identifiers.md`. `Job.id`, `ExecutionContext.runId`/`jobId` and `TraceEvent.runId`
carry it today; the other nine brands exist as types with no field yet.

Of build plan section 5, `DecisionEngine` (M3) is still to come and `FallbackContext` waits for
M4. `job.md` is **finalized** as of M2-T2, recorded in
[ADR-0032](../decisions/0032-jobs-are-deeply-immutable-and-the-effective-job-is-the-job.md): the
field list is unchanged, immutability is deep rather than one level, the job the runtime receives
is the job, creation time is derived from the `JobId` rather than stored in a `createdAt` field, an
attempt belongs to a run rather than to a job, and `parseJob()` is the boundary a stored job comes
back through.

Persistence arrives with `storage.md`. The `Storage` port is declared in `packages/core`, because
the dependency rule forbids core from importing Supabase, and implemented twice: by
`packages/storage-supabase` over `@supabase/supabase-js`, and in memory by `packages/testing`. Both
run one contract suite, which is what makes them interchangeable in fact rather than by assertion.
Its two load-bearing properties are about ordering rather than success: a run's job and ledger row
are written **before** its first trace event, so a crash leaves an inspectable `running` row, and
the outcome is written **after** the trace is flushed, so a `completed` row never outlives its
evidence. Every storage failure leaves `harness.run()` as a `StorageError` rather than becoming a
result. Recorded in
[ADR-0036](../decisions/0036-storage-is-a-core-port-over-a-supabase-schema-with-runs-as-the-ledger.md).
