# Milestone 3, Jev as a First-Class Decision Primitive

**Status:** in progress. No task has started.

**Goal (from the build plan):** introduce cheap bounded judgment without mixing it with policy.
Vercel currently exposes Jev through AI Gateway as `typesafe-ai/jev`, and AI SDK 7 exposes
evaluation through the experimental evaluation API. Keep that experimental API isolated inside the
adapter package.

**Blocked by:** M2 (complete).

**Parallel work:** can run in parallel with M4 (complete) after M2.

**Deliverable:** a reusable System-One decision layer.

## Before starting

These prerequisites come from the current state of the code and from the build plan's own notes
about this milestone. Read them before opening any M3 task.

- `DecisionError` (`packages/core/src/errors.ts:286`), the branded `DecisionId` type with
  `newDecisionId()` (`packages/core/src/ids.ts`), and the closed `decision.started`/
  `decision.completed`/`decision.failed` trace event types (`packages/core/src/trace.ts`) already
  exist from M1/M2. The `decisions` table already exists too, in M2-T5's minimal keyed placeholder
  shape (`supabase/migrations/20260920030301_later_milestone_tables.sql`: identity, the `run_id` it
  attaches to, and one `payload jsonb`, with the comment "M3 fills this"). `runs.jev_calls`
  (`supabase/migrations/20260920030258_runs_outcome_ledger.sql`) carries a comment from M2 calling
  it "a real measurement, not a placeholder: a run today makes no Jev calls" — but that comment
  predates M4: since M4-T10, a `--workflow` run's Jev calls, made through the fixture
  `WorkflowDecisionPort`, are already counted and non-zero. M3-T3's job is the real engine and the
  persisted evidence behind that count, not the counting mechanism itself, which already works.
- `packages/core/src/workflow-nodes.ts` already fixes the three question kinds as
  `JEV_QUESTION_KINDS = ["boolean", "choice", "score"]`, and a `jev` node already carries
  `question: { id, version }` plus `questionKind`. A question is deliberately **not** a
  `CapabilityKind` (the five kinds are schema, agent, tool, handler and policy) — ADR-0038 and
  ADR-0039 both record this, specifically so M3 and M4 could be built in parallel. M3-T1's question
  contract is therefore not starting from nothing: the node-level shape is already fixed, and this
  milestone owns the engine, the answer shape, the policy layer and persistence around it.
- The M4 workflow runtime already executes a `jev` node through a `WorkflowDecisionPort`
  (`packages/workflow/src/runtime/ports.ts`), and the runtime itself — not the port — opens the
  `decision.started` span, calls `port.decide(...)`, and closes it with `decision.completed` or
  `decision.failed` (`packages/workflow/src/runtime/workflow-runtime.ts`). M3-T2's
  `DecisionEngine` needs an adapter to this port's shape, not a redesign of it.
  `apps/example-agent/src/workflow/fixture-decision-port.ts` is the deterministic placeholder that
  answers the real vendor-triage workflow's two questions today; M3-T8 is what replaces it with a
  real `DecisionEngine`-backed port, and the workflow definition itself does not change when that
  happens.
- The AI SDK evaluation API is framework-facing, so AD-011's research checkpoint is mandatory
  before implementation. Installed `ai@7.0.107` (pinned in `packages/runtime-ai-sdk/package.json`
  and `packages/runtime-eve`'s peer) exports `experimental_evaluate`, the `Experimental_EvaluationModel`/
  `Experimental_EvaluationQuestion`/`Experimental_EvaluationAnswer`/`Experimental_EvaluationResult`
  types and `Experimental_EvaluationUnsupportedQuestionTypeError`. Its shipped docs live at
  `node_modules/ai/docs/07-reference/01-ai-sdk-core/14-evaluate.mdx` (plus a conceptual guide at
  `03-ai-sdk-core/32-evaluation.mdx` and the error's own reference page), and are the source of
  truth ahead of memory or an older example, per the source-of-truth protocol.
  `@internal/decision-jev` is already a declared adapter package in
  `adapterPackages` in `tests/architecture/boundaries.ts`, reserved ahead of this milestone the
  same way `@internal/storage-supabase` was reserved ahead of M2.
- No model credential is available on this development host (the same reason
  `pnpm example:run` against a live Gateway model has been unverified since M1). Live Jev tests
  must be tagged and skip without one; fakes are the default test path. This is not merely
  convenient — it is an explicit acceptance criterion below: "Decision tests use fake engines by
  default; live Jev tests are explicitly tagged," and "Live-provider tests do not run on normal
  pre-commit."
- M3-T3 (persist complete decision evidence) extends the `Storage` port in
  `packages/core/src/storage.ts`, which today has eight methods and no decision-persistence method
  at all. M5-T1 is extending the same port concurrently (workflow versions and promotions), so
  M3-T3 is sequenced to run **after** M5-T1/M5-T2 land, to avoid two tasks racing on one port's
  shape and one migration file.
- Pre-assigned ADR numbers for this milestone: **0042** (the question contract and
  `JevDecisionEngine`, M3-T1/M3-T2) and **0045** (persistence, `verify`, and the two fixtures,
  M3-T3/M3-T7/M3-T8/M3-T9). `pnpm check:handoff` fails on a WORKLOG entry referencing an ADR that
  does not yet have a file under `docs/decisions/`, so each task writes its own ADR before its
  WORKLOG entry is marked `completed`.

## Tasks

### M3-T1, Question contract

**Status:** completed (2026-09-20).

Support:

```text
Boolean
Choice
Score
```

Keep harness naming aligned with AI SDK where practical.

**Result.** `packages/core/src/decision.ts` declares `BooleanQuestion`, `ChoiceQuestion` and
`ScoreQuestion`, each carrying `id` under the shared identifier rule, an exact `version`, a `kind`
drawn from the `JEV_QUESTION_KINDS` a `jev` node already branches on, a `prompt`, and optional
`bands`. `defineQuestion()` and `defineQuestionSet()` are the validating boundary, in
`defineDomain()`'s style: they report every issue at once with a path and return the value deeply
frozen, rejecting a duplicated choice, a described option that does not exist, a rubric with fewer
than two levels and an empty question set.

**A question is versioned because its answers are evidence**: two stored decisions are comparable
only when they answered the same question, so rewording a prompt is a new version rather than an
edit. That is why a `jev` node names `question.id@version` and why `createDecisionPort()` looks up
the pair rather than the id.

Naming follows the AI SDK where it can and diverges in exactly three recorded places (ADR-0042):
`kind` rather than `type`, because `JevQuestionKind` and `CapabilityKind` already say `kind`;
`prompt` rather than `instructions`, because `instructions` already means a domain agent's
instructions throughout this repository; and an ordered `choices` list beside optional
`choiceDescriptions` rather than one `criteria` map, because a contract has to validate that options
are non-empty, ordered and unique, and a map expresses none of that. A score's scale is its rubric —
`levels`, at least two ordered descriptions, with the answer a fraction in
`[0, levels.length - 1]` (`scoreRange()`) — rather than a free `min`/`max` pair, because a bare
range says nothing about what a 3 means and a calibration fixture cannot check it.

### M3-T2, `JevDecisionEngine`

**Status:** completed (2026-09-20).

Implement the `DecisionEngine` interface using AI SDK evaluation.

No domain imports.

**Result.** `packages/decision-jev` is a new declared adapter depending on `@internal/core` and
`ai@7.0.107` and nothing else. `createJevDecisionEngine({ model })` implements `DecisionEngine` over
`experimental_evaluate`, mapping each of the three kinds to the SDK's question shape and each answer
back, and **it is the only place in the repository the experimental evaluation API appears** — which
is what the milestone asks for, and what the installed guide's own warning that the API "may change
in patch releases" makes worth enforcing.

`JEV_GATEWAY_MODEL_ID` is `"typesafe-ai/jev"`, the id `@ai-sdk/gateway@4.0.87`'s
`GatewayEvaluationModelId` enumerates; a bare string resolves through the AI Gateway, so **no new
dependency was added** to name Jev. A caller may pass any `Experimental_EvaluationModel` instead.

Every failure — provider error, unsupported question kind, malformed answer, abort — leaves the
adapter as one `DecisionError` with trace-safe details, never as a fabricated answer. The
unsupported-kind case carries the SDK error's `questionId`, `questionType`, `provider` and `modelId`
and is detected with the documented marker-based `isInstance`; the SDK raises it before any provider
I/O, which the tests assert by observing that the model was never called. The engine emits **no**
trace events: `workflow-runtime.ts` already owns the `decision.*` span around a `jev` node, and a
batch call answering three questions corresponds to no single node span (ADR-0042).

Unit tests drive `Experimental_EvaluationMockModelV4` from `ai/test`, the double the installed
package ships, so they run against the same type a real provider satisfies — including the SDK's own
answer validation, which caught a wrong fixture during development. One `*.integration.test.ts` is
tagged `live:jev`, is excluded from the `unit` project by suffix and therefore from pre-commit, and
skips with a printed reason when neither `AI_GATEWAY_API_KEY` nor `VERCEL_OIDC_TOKEN` is set. It has
**not** been run against a live model, because no credential exists in this environment.

`createFakeDecisionEngine()` in `@internal/testing` is the default engine for every other decision
test, and `createDecisionPort()` in `@internal/workflow` bridges a `DecisionEngine` to the
`WorkflowDecisionPort` a `jev` node executes through, returning
`{ answer, confidence, band, distribution, decisionId }`. Nothing in the M4 interpreter changed,
exactly as `runtime/ports.ts` predicted.

### M3-T3, Persist complete decision evidence

**Status:** not started.

Store:

- question ID/version
- input-state fingerprint
- answer
- available probability distribution
- confidence metadata
- model/provider
- cost
- latency
- policy version that consumed the answer

### M3-T4, Policy API

**Status:** completed (2026-09-20).

```ts
const result = await decisionEngine.evaluate(...);

const route = policy.evaluate(result);
```

Policies are deterministic and unit-tested.

**Result.** `definePolicy({ id, version, thresholds, route })` returns a `Policy` whose
`evaluate(result)` stamps `{ id, version }` onto a `PolicyOutcome` carrying the route and at least
one reason. An outcome with no reason is rejected: an unauditable route defeats the point of
separating judgment from policy. `thresholds` is exposed as JSON and deep-frozen so
`policyFingerprint()` can hash `{ id, version, thresholds }`, which makes ADR-0009's "thresholds are
versioned and replayable" checkable — a policy whose numbers changed without its version changing
has a different fingerprint.

**A policy performs no I/O, and the test proves the acceptance criterion directly**: it
`JSON.stringify`s a result, parses it back, routes the parsed value through two policy versions with
different thresholds, and gets two different routes, with no engine constructed anywhere in the
file. That is "changing a policy threshold can replay stored decisions without rerunning Jev",
demonstrated rather than asserted.

### M3-T5, Confidence bands

**Status:** completed (2026-09-20).

Support per-question calibration.

Do not define one global `.90` threshold.

Example:

```text
auto
agent review
human review
```

**Result.** `ConfidenceBands = { auto, agentReview }`, validated as `0 <= agentReview <= auto <= 1`,
declared **per question** with no default pair anywhere in the harness. `bandFor(answer, bands)` and
`bandForConfidence()` map a confidence to `auto`, `agent-review` or `human-review`. Equal thresholds
are legal and collapse the agent-review band.

Confidence itself had to be **harness-owned**, because the installed API exposes no portable measure
and says so: the guide states that the SDK "does not promise calibration across providers", that a
boolean's `probability` "is not confidence in either outcome", and that TypeSafe's own statistic "is
not ... a portable confidence measure". `deriveConfidence()` therefore defines one rule, once, in
core: for a boolean, the mass on the side answered (so a `false` at `P(true) = 0.02` is a
**confident** answer at `0.98`); for a choice, the chosen option's probability; for a score, the
probability mass within half a level of the answer. A provider's own statistic is carried verbatim
in `providerMetadata` and never adopted.

**Banding fails closed twice over.** A `null` confidence is `human-review`, because a decision the
harness cannot score is one it must not act on. And a question with **no bands at all** is
`human-review` whatever its confidence, because an uncalibrated question has no threshold to clear —
letting a high number auto-route it is the exact failure per-question calibration exists to prevent.
M3-T9's fixture is what earns a question its bands.

### M3-T6, Batch decisions

**Status:** completed (2026-09-20).

Allow one shared state to answer several independent questions in one Jev call where semantics
permit.

**Result.** One `evaluate` call carries one `state` and a non-empty `QuestionSet` keyed by the
caller's own names, and answers come back under those same keys. A test asks a boolean, a choice and
a score question about one vendor and observes exactly one provider call.

"Where semantics permit" turned out to be the installed API's own rule rather than a harness
judgment: `state` is "one shared state, even when the value is an array", and evaluation "does not
stream answers, perform multilabel classification, or batch unrelated states. Run separate calls for
separate states." So the harness batches **by shared state and only by shared state**, and there was
nothing further to design. Two `jev` nodes in a workflow have different inputs by construction and
are therefore two calls; a workflow that genuinely wants several questions over one state asks them
from a `code` node that calls the engine directly.

### M3-T7, `verify` primitive

**Status:** not started.

Given:

- evidence
- structured agent output
- output schema

compile configured fields into Jev questions.

Failed fields should be able to return to the same logical agent task with explicit repair
instructions.

### M3-T8, Neutral fixture

**Status:** not started.

Add Jev to vendor triage:

```text
Is vendor obviously low risk?
Which vendor category applies?
Is evidence sufficient?
```

Policy decides whether to continue, research, or escalate.

### M3-T9, Calibration fixture

**Status:** not started.

Create a small labeled set.

Report:

- confusion matrix where applicable
- accuracy
- uncertain-band rate
- false-auto rate
- fallback rate

## Acceptance criteria

From the build plan.

- Jev can route at least one example-agent decision. **not yet verified**
- Raw Jev result is stored separately from policy outcome. **not yet verified**
- Changing a policy threshold can replay stored decisions without rerunning Jev. **not yet verified**
- A Jev failure escalates safely rather than silently guessing. **not yet verified**
- Verification can identify a deliberately unsupported field. **not yet verified**
- Decision tests use fake engines by default; live Jev tests are explicitly tagged. **not yet verified**
- Live-provider tests do not run on normal pre-commit. **not yet verified**
