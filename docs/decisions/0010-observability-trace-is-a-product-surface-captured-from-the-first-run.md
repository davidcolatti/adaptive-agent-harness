---
status: accepted
date: 2026-09-19
deciders: project owner (build plan); recorded during M0
related: [0003, 0012, 0014]
supersedes: null
superseded_by: null
---

# ADR-0010: Observability/trace is a product surface, captured from the first run

## Context

AD-010 states: "The trace is not debug logging. Every behavior-affecting event needed for
replay, evaluation, lineage, cost analysis, or model-risk analysis must be captured as structured
data from the first working run." Milestone 2 ("the most important foundation in the project")
defines the append-only event trace schema (`run.started`/`completed`/`failed`,
`agent.*`, `model.*`, `tool.*`, `decision.*`, `node.*`, `artifact.created`,
`approval.*`, `fallback.*`, `eval.completed`), where every event carries event ID, run ID,
timestamp, sequence, parent span, node, event version, behavior fingerprint, sanitized payload,
usage, latency, and error metadata (M2-T3). It defines the `TraceWriter` interface, behavior
fingerprinting (M2-T8), mandatory secret/sensitive-data redaction before persistence (M2-T9), and
a local run inspector CLI (M2-T10). Milestone 2's acceptance criteria require that "a trace
reconstructs execution without application logs" and that "seeded secrets never appear in stored
trace payloads." Appendix A / AD-012 direct that `eve/hooks` (the documented observe-only runtime
event extension point, which "run after events are durably recorded") should be the source for
agent-runtime trace events, normalized into the harness trace schema rather than parsed from
console logs.

## Decision

Trace capture MUST be treated as a first-class product surface, not an optional debugging aid,
and MUST exist from Milestone 2 onward, before the router, replay, learning, or compiler systems
are built. Every behavior-affecting event (per the taxonomy in M2-T3) MUST be written through the
`TraceWriter` interface as append-only, ordered, structured data, sufficient to reconstruct an
execution without consulting application logs. Every event MUST carry a behavior fingerprint
(M2-T8) computed from behavior-affecting inputs (agent instructions, SOP, loaded skills, tool
definitions/versions, model configuration, schemas, workflow IR, policy thresholds), excluding
timestamps and other irrelevant metadata. Sensitive data MUST be redacted before persistence via
field-path redaction, secret-pattern redaction, header redaction, and tool-specific sanitizer
hooks (M2-T9), verified with seeded fake secrets. Agent-runtime trace events MUST be sourced from
`eve/hooks`, normalized into the harness trace schema, rather than by parsing console output or
other unstructured logs (AD-012).

## Consequences

### Positive

- Replay (Milestone 6), evaluation, learning (Milestone 7), and cost/model-risk analysis all
  become possible without retrofitting instrumentation, because the trace schema is designed for
  those consumers from the start.
- A durable, ordered, fingerprinted trace directly enables North-Star Invariant #9 ("Historical
  evidence can be replayed without unnecessary re-research") and Invariant #4 ("Every
  behavior-affecting version is fingerprinted").

### Negative

- Every new agent, tool, node type, or decision engine added to the system must be instrumented
  into the trace taxonomy and redaction pipeline before it can be trusted in production, which is
  ongoing engineering discipline, not a one-time cost.
- Redaction and fingerprinting logic must be kept correct and tested (seeded secret fixtures) on
  an ongoing basis, since a redaction gap is a security incident, not a cosmetic bug.

### Neutral

- Constrains Milestone 2 (Job, Trace, Supabase, and Run Ledger, the trace schema's origin),
  Milestone 6 (Replay, which consumes stored trace/tool-result data), and Milestone 7 (Learning,
  which reads traces to produce generalized notes).
- Constrains `packages/trace`, `packages/observability`, and the `trace_events` table (build
  plan §9).

## Alternatives considered

- **Treat trace as ordinary application logging, added incrementally as debugging needs arise**:
  rejected; AD-010 explicitly states "the trace is not debug logging" and requires structured
  capture "from the first working run," which Milestone 2 (before router, replay, or learning
  exist) operationalizes.
- **Parse `eve` console/log output into trace events**: rejected by AD-012, which requires using
  the documented `eve/hooks` event stream and normalizing it, "rather than parsing console logs."

## References

- `docs/milestones/build-plan.md` §1 AD-010, §1 AD-012, §17 Invariants #4, #9, Milestone 2
  (M2-T3, M2-T8, M2-T9, M2-T10), Appendix A (eve)
- Related ADRs: 0003, 0012, 0014
- Related code paths: `packages/trace`, `packages/observability`
