---
status: accepted
date: 2026-09-20
deciders: coding agent (M3-T3/T7/T8/T9), per the build plan's Milestone 3
related: [0009, 0036, 0042, 0043]
supersedes: null
superseded_by: null
---

# ADR-0045: Decision evidence is one record with the raw result and the policy outcome apart

## Context

ADR-0042 settled what a decision *is*: a question contract in `@internal/core`, a `DecisionEngine`
implemented over the AI SDK's experimental evaluation API in `@internal/decision-jev`, a
harness-owned confidence derivation, per-question bands, and a deterministic `Policy` that reads a
result and returns a route. What it deliberately left open is everything that happens *around* a
decision once one has been made, which is Milestone 3's second half:

- **M3-T3** lists nine things to store — question ID/version, input-state fingerprint, answer,
  available probability distribution, confidence metadata, model/provider, cost, latency, and the
  policy version that consumed the answer — and two acceptance criteria to satisfy with them: "raw
  Jev result is stored separately from policy outcome" and "changing a policy threshold can replay
  stored decisions without rerunning Jev".
- **M3-T7** asks for a `verify` primitive that compiles configured output fields into Jev questions
  and returns "explicit repair instructions" for the ones the evidence does not support.
- **M3-T8** asks for the three named questions to reach the example agent, with "policy decides
  whether to continue, research, or escalate".
- **M3-T9** asks for a labeled set and five metrics: a confusion matrix, accuracy, uncertain-band
  rate, false-auto rate and fallback rate.

Four facts constrain the answers.

**The `decisions` table already existed**, created by M2-T5 in the minimal keyed shape the build
plan's table list implies — `id`, `run_id`, one `payload jsonb`, `created_at` — with the comment
"M3 fills this". ADR-0043 and
`supabase/migrations/20260920202604_workflow_registry_columns.sql` established, one task earlier,
how a placeholder is filled: a **new** migration, the earlier file untouched, the `payload`
placeholder dropped rather than kept, and exactly the fields a query needs denormalized into
columns beside the authoritative `jsonb`.

**The installed evaluation API exposes no cost.** `ai@7.0.107`'s
`Experimental_EvaluationResult` has no cost field and neither does the provider-level
`EvaluationModelV4Result` (verified in `node_modules/ai/docs/07-reference/01-ai-sdk-core/14-evaluate.mdx`
and `@ai-sdk/provider`'s types). ADR-0042 already recorded this; M3-T3 has to persist it, and the
choice is between a nullable column and a fabricated estimate.

**A `jev` node's output is validated by its own `outputSchema`.** Under M4-T10 the vendor
workflow's `classify` node answered `clear | research | uncertain` directly, because the
deterministic placeholder standing in for Jev had no way to separate the model's judgment from the
organization's decision. Registering real questions forces the separation into the open.

**No model credential exists on this host.** Live Jev cannot be run, so the fixture path must be
able to produce every demo route and every calibration number without one, and the live path must
be a tagged test that skips.

## Decision

### The record

A decision's evidence is one `DecisionRecord`, declared in
`packages/core/src/decision-record.ts`:

```ts
interface DecisionRecord {
  readonly id: DecisionId;
  readonly runId: RunId;
  readonly nodeId: NodeId | null;
  readonly result: DecisionResult<QuestionSet>;
  readonly policy: PolicyOutcome<string> | null;
  readonly createdAt: string;
}
```

`result` MUST be exactly what the engine produced and MUST NOT be edited by a policy. `policy` MUST
be `null` when no policy consumed the answer. `id` MUST equal `result.decisionId`. Every one of
M3-T3's nine items is reachable from this value; the mapping is stated as a table in the module's
own doc comment and asserted by a test, so the claim is checkable rather than promised.

`parseDecisionRecord()` is the strict read boundary, in `parseJob()`/`parseRunRecord()`/
`parseWorkflowVersionRecord()`'s style: every issue reported at once with a path, an unknown field
rejected rather than dropped, `stateFingerprint` checked against `sha256:<64 hex>`, `cost` allowed
to be `null`, a stored `PolicyOutcome` required to carry at least one reason, and the result deeply
frozen.

`replayDecisions(records, policy)` is pure, lives in core, takes no engine, and returns each
record's stored outcome beside the outcome the supplied policy produces, plus a summary of changed
routes. A record whose stored `policy` is `null` counts as changed.

### The columns

A new migration, `supabase/migrations/20260920205520_decisions_columns.sql`, drops the `payload`
placeholder and adds `node_id`, `state_fingerprint`, `question_ids text[]`, `result jsonb`,
`policy jsonb`, `model_provider`, `model_id`, `cost_usd numeric` and `latency_ms`. `result` and
`policy` are **two columns**, which is how "raw Jev result is stored separately from policy
outcome" is enforced by the schema rather than by convention. The six denormalized columns exist so
that "what did this question cost, and how slow was it?" is a `group by`; the read boundary
deliberately does **not** read them, so a drifted row cannot look consistent. `cost_usd` is
nullable and is `null` for every row this milestone writes.

`Storage` gains `saveDecision(record)` (a plain insert; a duplicate id rejects) and
`listDecisions(runId)` (oldest first by `id`, unpaged). Both implementations run the shared contract
suite.

### Persistence happens inside the decision port

`createDecisionPort()` in `@internal/workflow` takes an optional
`storage?: Pick<Storage, "saveDecision">`. For each `jev` node it evaluates, then applies the
entry's policy, then saves one record carrying both, then returns the node's output. A storage
failure is a `StorageError` and **fails the node**; it MUST NOT be swallowed.

The port, not the workflow runtime, owns this, because the port is already the one place that turns
a node into an engine call; putting it in `workflow-runtime.ts` would make the interpreter depend on
`Storage` for one node type.

### A `jev` node may name a bundle, and the policy belongs to the bundle

A node's `question.id@version` MAY resolve to a `QuestionBundle`: several questions about the
node's one input, a `primary` key, and an optional `Policy`. The whole bundle travels in **one**
engine call, which is M3-T6's rule (batching is by shared state) rather than an optimization.

The policy is attached to the bundle rather than to the port, because a port serves every `jev` node
in a workflow and two nodes ask different questions; a port-level policy would necessarily be wrong
for one of them.

A node's output is `{ answer, confidence, band, distribution, decisionId, route, reasons, answers }`.
`route` is the policy's route or `null`; `answers` carries every question's bare answer under the
bundle's own keys. A `branch` selects on `["route"]`. The full evidence is in the stored record,
which `decisionId` points at, rather than copied into every downstream node's input.

### `verify` lives in core

`compileVerification()` and `readVerification()` are in `packages/core/src/verify.ts`, not in
`@internal/decision-jev`, because composing questions is engine-agnostic: the compiled `QuestionSet`
goes to the Jev adapter, to the fake engine, or to anything else implementing `DecisionEngine`.

`compileVerification()` produces **one boolean question per configured field** over one shared
state `{ evidence, output, outputSchema? }`. A field the output does not carry is still asked
about, with a question that says so. `readVerification()` counts a field as supported when the
answer is `true` **and**, when the question declares bands, the band is `auto`; a field whose
question declares no bands is judged by its answer alone, because there is no calibration to apply
and inventing one would be the global threshold M3-T5 forbids. Each unsupported field carries a
`repair` **sentence** naming the field, quoting the value and saying what would fix it, with three
wordings for the three failures (contradicted, weakly supported, absent).

### The fixture classifies by batch and routes by policy

`apps/example-agent/src/decisions/` registers the three questions M3-T8 names — `low-risk`
(boolean), `category` (choice over the SOP's own five categories) and `evidence-sufficient`
(boolean) — as one bundle, `vendor-triage.classify@1.0.0`, with `category` as its primary.
`createTriagePolicy()` turns the three answers into `clear`, `research` or `uncertain`, and the
branch selects on the route. The `verify` node names one bare boolean question with **no** policy,
so its record stores `policy: null`.

`category` is the SOP's category list and not `clear | research | uncertain`, because a category is
a judgment about the vendor and a route is a decision about what the organization does, and mixing
them is what ADR-0009 exists to prevent. `finalize` reads `answers.category` for the triage output's
`category` field, which the domain schema already describes as "what the vendor sells, in the SOP's
own vocabulary".

`resolveDecisionEngine()` returns live Jev (`typesafe-ai/jev` through the AI Gateway) when
`AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN` is set, and a deterministic fixture engine otherwise.
The fixture engine derives a script per call from the frozen vendor evidence, using the exact rules
the M4-T10 placeholder port used, and runs it through `createFakeDecisionEngine()` so the answers go
through the same validation and the same `deriveConfidence()` a real adapter's do. The command says
on stderr which engine answered.

### The calibration metrics

`runCalibration({ engine, questions, policy, cases, primary, fallbackRoute })` reports:

| Metric | Definition |
| --- | --- |
| confusion matrix | one cell per `(expected route, actual route)` pair that occurred, with a count |
| accuracy | the fraction of cases whose policy route equals the labeled one |
| uncertain-band rate | the fraction whose **primary** answer did not land in `auto` |
| false-auto rate | the fraction whose primary answer landed in `auto`, whose route was **not** the fallback, and whose route was wrong |
| fallback rate | the fraction routed to `fallbackRoute` |

The false-auto rate excludes fallbacks deliberately: falling back is not acting, so raising a
threshold cannot raise this number. The report MUST NOT combine accuracy and fallback rate into one
score, because falling back is the safe outcome and being confidently wrong is not, and a reader
comparing two threshold sets needs to see the two move against each other.

## Consequences

### Positive

- "Raw Jev result is stored separately from policy outcome" is a schema fact: two columns, and a
  test that stores the same result with and without a policy and compares the bytes.
- Replaying history through a changed threshold is a pure function call with no engine parameter,
  so it cannot accidentally become a second Jev bill.
- A decision row joins to a trace by `run_id` and to a node by `node_id`, so
  `pnpm harness run show` and a `select` describe the same judgments.
- `verify` is testable with the fake engine, and a deliberately unsupported field produces a
  sentence a re-run can be given rather than a boolean.
- The fixture demonstrates the whole layer — batch, policy, bands, persistence, replay — with no
  credential, so the acceptance criteria are verifiable on any machine.

### Negative

- A `jev` node's output shape changed, so the example's `classification` and `verification` schemas
  and the two handlers that read them changed with it, and the workflow's fingerprint changed.
- `answers` is a second place a node's answers appear, beside the stored record. It is a copy, and a
  copy can drift if a future change writes one without the other.
- `question_ids`, `model_provider`, `model_id`, `cost_usd`, `state_fingerprint` and `latency_ms`
  duplicate values inside `result`. The read boundary ignores them, which bounds the damage, but the
  writer has to keep them consistent.
- The fixture engine's numbers (0.94, 0.95, 0.92, …) are invented, so the calibration report proves
  the metrics and the labeled set are coherent and says nothing about a model.

### Neutral

- `cost_usd` is `null` on every row until a provider reports a cost. The column exists so that a
  provider that does needs no migration.
- A decision made outside a workflow has `node_id: null`, which the schema allows and the read
  boundary accepts.

## Alternatives considered

- **Two tables, one for results and one for policy outcomes.** Rejected: they are produced by one
  call about one state, the only query anyone makes reads both, and splitting them would buy a join
  and no additional separation — the separation is that a policy cannot write to `result`, which two
  columns give just as well.
- **Persisting in `workflow-runtime.ts` beside the `decision.*` span.** Rejected: it would make the
  interpreter depend on `Storage` for one node type, and the port already holds everything a record
  needs.
- **A port-level `policy` option.** Rejected: one port serves every `jev` node in a workflow, so a
  single policy would be applied to questions it was not written for. `verify`'s `policy: null` is
  the case that makes this concrete.
- **Keeping `category` as `clear | research | uncertain`.** Rejected: it is the M4-T10 placeholder's
  shape, and it puts the organization's decision inside the model's answer. Keeping it would have
  made M3-T4's policy layer and M3-T6's batching decorative in the one fixture that is supposed to
  demonstrate them.
- **Putting `verify` in `@internal/decision-jev`.** Rejected: it composes questions and answers
  none, so it belongs where questions are declared; in the adapter it could not be tested without a
  provider.
- **A single calibration score.** Rejected: it would hide the trade between falling back and being
  wrong, which is the only trade a threshold change makes.
- **Estimating `costUsd` from token counts.** Rejected: an estimate and a measurement are
  indistinguishable once they are in the same column, and the installed API reports neither cost nor,
  reliably, tokens.

## References

- `docs/milestones/build-plan.md` § Milestone 3 (M3-T3, M3-T7, M3-T8, M3-T9), AD-009, AD-016
- Related ADRs: ADR-0009, ADR-0029, ADR-0030, ADR-0036, ADR-0042, ADR-0043
- Related code paths: `packages/core/src/decision-record.ts`, `packages/core/src/verify.ts`,
  `packages/core/src/storage.ts`, `packages/workflow/src/runtime/decision-port.ts`,
  `packages/storage-supabase/src/supabase-storage.ts`,
  `packages/testing/src/in-memory-storage.ts`,
  `supabase/migrations/20260920205520_decisions_columns.sql`,
  `apps/example-agent/src/decisions/`
- Research: `docs/research/vercel/2026-09-20-m3-ai-sdk-evaluate.md`
