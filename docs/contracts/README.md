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
| `workflow-ir.md` | active (M4-T1, M4-T2) | The versioned, serializable intermediate representation that is the authoritative source of compiled workflow semantics: the definition, the eleven node types and five control shapes, the `Binding` data-flow model, `parseWorkflowDefinition()` and the workflow fingerprint. |
| `workflow-dsl.md` | active (M4-T5) | The typed TypeScript builder that authors a workflow: `workflow()`, a method per node type, nested sub-graph callbacks, `.goto()` for rejoining, the defaults it applies and the edges and schemas it derives. It compiles to the IR and parses its own output. |
| `workflow-registry.md` | active (M5-T1, M5-T2) | The workflow registry: the seven statuses and the transition table between them, what a version declares about the jobs it can handle, the exact-match compatibility selector with its nine ordered checks and typed rejection reasons, the three records and their parse boundaries, the six `Storage` methods and the promotion ledger. |
| `decision-engine.md` | active (M3-T1, M3-T2, M3-T4, M3-T5, M3-T6) | Bounded probabilistic judgment: the three question kinds with their versioned identity, the `DecisionEngine` port and its complete JSON-representable result, the harness-owned confidence derivation, per-question confidence bands that fail closed, and the deterministic policy API a stored result replays through. |
| `promotion-policy.md` | planned (M6) | The quality/regression/false-auto/fallback thresholds a candidate workflow must clear before promotion. |

Sixteen contracts are implemented: the execution context (M1-T7), the error taxonomy (M1-T8), `Job`
and `DomainDefinition` with `defineDomain()` (M1-T3), `AgentRuntime` with `AgentExecution`
(M1-T5), `createHarness()` (M1-T4), the capability registry with its serializable manifest
(M1-T9), the entity identifier scheme (M2-T1), the trace event with its recorder and writer
(M2-T3, M2-T4), the behavior fingerprint (M2-T8), trace redaction (M2-T9), and the `Storage` port with its outcome ledger
(M2-T5, M2-T6, M2-T7), the workflow IR with its node contracts (M4-T1, M4-T2), the typed
workflow DSL over it (M4-T5), the workflow registry with its compatibility selector
(M5-T1, M5-T2), and the decision engine with its questions, bands and policies (M3-T1, M3-T2,
M3-T4, M3-T5, M3-T6). All live in
`packages/core` except their behavior halves. The trace's is `packages/trace`: the buffered writer, the JSONL sinks and the
redaction pass above them, kept out of core so that core owns no storage decision and touches no
`node:fs`. The workflow's is `packages/workflow`: graph validation, the typed DSL and the local
deterministic runtime, kept out of core for the same reason, so core declares the IR contract and
executes nothing
([ADR-0038](../decisions/0038-workflow-ir-lives-in-core-behavior-lives-in-the-workflow-package.md)).
Redaction is a `TraceWriter` decorator placed above the buffer, so "redact before
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

Build plan section 5's contracts are now all declared. `WorkflowNode`, the control shapes and
`FallbackContext` arrived with M4-T1/M4-T2 and are `workflow-ir.md`; `DecisionEngine` arrived with
M3 and is `decision-engine.md`. The decision contract's behavior half is `packages/decision-jev`,
split out for the usual reason and for one more: the AI SDK's evaluation API is experimental, and
its own documentation says it "may change in patch releases", so it is confined to a single adapter
file
([ADR-0042](../decisions/0042-the-decision-contract-is-core-the-experimental-evaluation-api-is-the-adapter.md)).
Two of that contract's properties are worth knowing before reading it: confidence is
**harness-owned**, because the installed API exposes no portable measure and says so plainly, and
banding **fails closed** both when confidence is missing and when a question has never been
calibrated. `job.md` is **finalized** as of M2-T2, recorded in
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

The **workflow registry** is where Milestone 5's routing decision becomes decidable from data.
`workflow-registry.md` states the seven statuses and the explicit table of edges between them, what
a version declares about the jobs it can handle, and the exact-match selector that picks one. Two
properties carry the weight. Promotion is human-invoked, so every method that moves a status takes
an actor and nothing in the harness can promote itself (AD-005); and a version's identity is its IR
fingerprint, so registering the same behaviour twice is a conflict and the read boundary recomputes
the digest rather than trusting the stored one. The model and the pure selector live in
`packages/core`; the service that needs a `Storage` and a `CompiledWorkflow` lives in
`packages/registry`, the same split the trace and the workflow packages already make. Recorded in
[ADR-0043](../decisions/0043-the-workflow-registry-is-a-status-model-in-core-with-an-exact-match-selector.md).
