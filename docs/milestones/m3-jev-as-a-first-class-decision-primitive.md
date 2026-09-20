# Milestone 3, Jev as a First-Class Decision Primitive

**Status:** every task is completed (M3-T1 through M3-T9); all seven acceptance criteria verified.
Snapshot: `../progress/milestones/m3.md`.

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

**Status:** completed (2026-09-20).

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

**Result.** A decision's evidence is one `DecisionRecord`
(`packages/core/src/decision-record.ts`): `{ id, runId, nodeId, result, policy, createdAt }`, where
`result` is exactly what the engine produced and `policy` is exactly what the organization decided
about it. All nine items above are reachable from it, and the module's own doc comment states the
mapping as a table that `decision-record.test.ts > parseDecisionRecord > reaches every item on the
build plan's evidence list` asserts, so the claim is checkable rather than promised. `cost` is
`result.usage.costUsd` and is `null` on every row this milestone writes, which is a **measurement**:
the installed evaluation API exposes no cost anywhere, and an estimate would be indistinguishable
from a reported number once it was in a column.

**The raw result and the policy outcome are two fields of one record, and two columns of one row.**
That is the acceptance criterion "raw Jev result is stored separately from policy outcome" turned
into a schema fact: a policy cannot alter a byte of `result`, and a decision nothing routed stores
`policy: null` rather than a fabricated route. `parseDecisionRecord()` is the strict read boundary
in `parseJob()`'s style; three of its checks are the ones a corrupted row fails — `id` must equal
`result.decisionId`, `stateFingerprint` must be a `sha256:<64 hex>` digest, and a stored
`PolicyOutcome` must carry at least one reason.

`Storage` gains `saveDecision()` (a plain insert; a duplicate `DecisionId` rejects) and
`listDecisions(runId)` (oldest first by `id`, unpaged, because a `DecisionId` is a sortable UUIDv7
and the number of `jev` nodes bounds the list). `supabase/migrations/20260920205520_decisions_columns.sql`
fills the M2-T5 placeholder the way `..._workflow_registry_columns.sql` filled the registry's: the
earlier migration untouched, `payload` dropped, and six fields denormalized beside the authoritative
`result` so cost and latency per question are a `group by`. The read boundary deliberately does not
read those six, so a drifted row cannot look consistent.

**Persistence happens inside `createDecisionPort()`**, the one place that already turns a `jev` node
into an engine call; putting it in `workflow-runtime.ts` would make the interpreter depend on
`Storage` for one node type. A storage failure is a `StorageError` that **fails the node** and is
not caught: a workflow must not act on a judgment nobody recorded.

**Replay is a pure function with no engine parameter.** `replayDecisions(records, policy)` reads
only the `result` half of each record and returns each stored outcome beside the one the supplied
policy produces, plus a summary of changed routes. There is no engine to call, which is the
strongest available statement of the milestone's third acceptance criterion; a record with
`policy: null` counts as changed, because nothing routed it before and something routes it now.

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

**Status:** completed (2026-09-20).

Given:

- evidence
- structured agent output
- output schema

compile configured fields into Jev questions.

Failed fields should be able to return to the same logical agent task with explicit repair
instructions.

**Result.** `compileVerification()` and `readVerification()` live in `packages/core/src/verify.ts`,
**not** in `@internal/decision-jev`, because composing questions is engine-agnostic: the compiled
`QuestionSet` goes to the Jev adapter, to the fake engine, or to anything else implementing
`DecisionEngine`, and in the adapter it could not be tested without a provider.

`compileVerification({ output, outputSchema?, evidence, fields })` produces **one boolean question
per configured field** over one shared state `{ evidence, output, outputSchema? }` — one state, so
the whole batch is one call by construction (M3-T6). One question for the whole output would answer
with one bit for an object with ten fields and give a re-run nothing to act on; per-field questions
are what make "identify a deliberately unsupported field" mean the *field*. A field the output does
**not** carry is still asked about, with a question that says so, because a missing required field
must not be indistinguishable from a supported one.

`readVerification(result, fields)` counts a field as supported when the answer is `true` **and**,
when the question declares bands, the band is `auto`. A field whose question declares no bands is
judged by its answer alone: there is no calibration to apply, and inventing one would be exactly the
global threshold M3-T5 forbids.

The `repair` value is a **sentence**, not a flag, because it is appended to the same logical agent
task's input: *"The field `recommendation.rationale` (`Audited in 2019.`) is not supported by the
evidence; cite a source that establishes it, or remove it."* There are three wordings for the three
failures — the evidence contradicts the value, the evidence supports it only weakly, or the output
never produced it — because the three need three different fixes.

**Not wired into the vendor workflow.** The workflow's `research` route already ends in a `jev`
`verify` node followed by `decide-verified-triage`, which is the same shape at the graph level; a
`verify` step *inside* the `research` node would need the runtime to re-enter a node with a repaired
input, which is a loop the IR does not express today. M6 owns that: `compileVerification()` produces
the questions and `readVerification()` produces the instructions, and what is missing is a node type
that feeds the instructions back, not a primitive.

### M3-T8, Neutral fixture

**Status:** completed (2026-09-20).

Add Jev to vendor triage:

```text
Is vendor obviously low risk?
Which vendor category applies?
Is evidence sufficient?
```

Policy decides whether to continue, research, or escalate.

**Result.** `apps/example-agent/src/decisions/` registers those three questions as one **bundle**,
`vendor-triage.classify@1.0.0`, which the workflow's `classify` node names. All three are answered
in **one** Jev call, because they are three questions about one vendor and batching is by shared
state. `createTriagePolicy()` turns the answers into `clear`, `research` or `uncertain`, and the
branch now selects on `["route"]` rather than on `["category"]`.

**That rename is the substance of the task, not cosmetics.** Under M4-T10 the `classify` node
answered `clear | research | uncertain` directly, because the deterministic placeholder standing in
for Jev had no way to separate the model's judgment from the organization's decision. `category` is
now the SOP's own five-category list — a judgment about the **vendor** — and `route` is what the
organization does about it. Keeping them fused would have made M3-T4's policy layer and M3-T6's
batching decorative in the one fixture that exists to demonstrate them. `finalize` reads
`answers.category` for the triage output's `category` field, which the domain schema already
describes as "what the vendor sells, in the SOP's own vocabulary".

The policy's asymmetry is worth naming: a confident `false` on `low-risk` routes to `research`,
because it is a judgment that the case needs reading; an **unconfident** answer routes to
`uncertain`, because sending a case to an agent that already said it does not know is not a plan.

The `verify` node names a bare question with **no** policy, so its record stores `policy: null`.
Two decisions in one `research` run, one routed and one not, is the clearest demonstration in the
repository that the two halves really are stored apart.

`resolveDecisionEngine()` returns live Jev (`typesafe-ai/jev` through the AI Gateway) when
`AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN` is set and a deterministic fixture engine otherwise, and
`src/run.ts` prints which on stderr. The fixture engine derives a script per call from the frozen
vendor evidence using the **exact** rules M4-T10's placeholder used, and runs it through
`createFakeDecisionEngine()`, so the answers go through the same validation and the same
`deriveConfidence()` a real adapter's do and the three demo routes still hold with no credential.
`createFixtureDecisionPort()` and its test are deleted.

One rule did have to change: the placeholder matched category terms against the whole evidence text,
and the freight vendor's evidence contains an invoice dispute, which would have filed a freight
forwarder under finance. The category is now read from the vendor's **stated offering** first and
from its documents only as a fallback, which is the question the SOP actually asks.

### M3-T9, Calibration fixture

**Status:** completed (2026-09-20).

Create a small labeled set.

Report:

- confusion matrix where applicable
- accuracy
- uncertain-band rate
- false-auto rate
- fallback rate

**Result.** `runCalibration({ engine, questions, policy, cases, primary, fallbackRoute })` and
`renderCalibrationReport()` live in `src/decisions/calibration.ts`, and
`pnpm --filter @internal/example-agent run calibrate` prints the report. The five metrics are
**defined once**, in the module's own doc comment, so a number in a report is not open to
interpretation.

**The false-auto rate is the one that matters, and it excludes fallbacks deliberately**: it counts
the cases whose primary answer landed in `auto`, whose route was **not** the fallback, and whose
route was wrong. Falling back is not acting, so raising a threshold can cost accuracy but can never
raise this number. For the same reason the report refuses to combine accuracy and fallback rate into
a single score: falling back is the safe outcome and being confidently wrong is not, and a reader
comparing two threshold sets has to watch the two move against each other. A test asserts exactly
that trade by raising the category threshold above what the engine can produce.

**Three cases would have said nothing.** `calibration-cases.ts` adds eleven synthetic vendors to the
three frozen ones — one complete vendor in each SOP category, and one missing each of the SOP's
requirements, including the payment-integrity flag — for sixteen labeled cases: seven `clear`, seven
`research`, two `uncertain`. The three frozen records are unchanged, so a calibration run and a demo
run see the same evidence for the same vendor. The labels are what a careful reviewer would decide,
not what the engine happens to do; a label copied from the engine would make the accuracy number
meaningless.

## Acceptance criteria

From the build plan. Evidence is dated and cites the test by file > title, or the run id and table
count it was observed on.

### Jev can route at least one example-agent decision — **verified (2026-09-20)**

Three real runs of the vendor workflow through `createHarness()` against local Supabase, each
routed by `vendor-triage.route@1.0.0` reading a decision the engine produced:

| Vendor | Run id | Route | `decisions` rows |
| --- | --- | --- | --- |
| Northwind Ledger | `01a0c0ad-359e-7001-a2d9-73515254a721` | `clear` | 1 |
| Tessellate Analytics | `01a0c0ad-5b44-7001-afc3-e5a721f3ca9f` | `research` | 2 |
| Aurelia Freight | `01a0c0ad-6d8a-7001-bb78-03c5bcedc8e7` | `uncertain` (escalation) | 1 |

The row count is the number of `jev` nodes each route executes.
`select policy->>'route' from decisions where run_id = ...` returns `clear`, `research` and
`uncertain` respectively. In tests: `apps/example-agent/src/decisions/engine.test.ts >
createVendorDecisionEngine > keeps the three demo routes the M4-T10 placeholder produced`, and
`apps/example-agent/src/workflow/vendor-triage-run.test.ts > the `clear` route > stores one decision
record per jev node executed, with its policy outcome (M3-T3)`.

The engine was the deterministic fixture one, because no model credential exists on this host. What
that proves is the harness path — question, batch, policy, band, persistence, route — end to end;
what it does not prove is a model's judgment, which is the tagged live test's job.

### Raw Jev result is stored separately from policy outcome — **verified (2026-09-20)**

They are two fields of one record and two `jsonb` columns of one row
(`supabase/migrations/20260920205520_decisions_columns.sql`). Proved three ways:

- `packages/workflow/src/runtime/decision-port.test.ts > createDecisionPort: persistence (M3-T3) >
  stores `policy: null` when nothing routed the answer, with identical result bytes` — the same
  script through a policied and an unpolicied entry produces byte-identical `answers` and the same
  `stateFingerprint`; only `policy` differs.
- `packages/storage-supabase/src/storage.contract.test.ts > stores a decision no policy consumed,
  with a null policy and an intact result`, run against **both** the in-memory and the real Supabase
  implementation.
- On a real run: `01a0c0ad-5b44-7001-afc3-e5a721f3ca9f` has two rows, `classify` with
  `policy->>'route' = 'research'` and `verify` with `policy is null`.

### Changing a policy threshold can replay stored decisions without rerunning Jev — **verified (2026-09-20)**

`replayDecisions(records, policy)` takes **no engine parameter**, so there is nothing to call.

- `packages/core/src/decision-record.test.ts > replayDecisions > re-routes stored evidence through
  a tightened threshold with no engine`, and `> leaves every stored record untouched`. The whole
  file constructs no `DecisionEngine`.
- End to end, including the store:
  `packages/workflow/src/runtime/decision-port.test.ts > createDecisionPort: persistence (M3-T3) >
  replays stored decisions through a tightened policy with no further engine call` — it decides
  once, reads the record back out of the store, replays it, and asserts that `engine.calls.length`
  did not move and that the route changed from `clear` to `uncertain`.
- At the fixture's level: `apps/example-agent/src/decisions/triage-policy.test.ts > re-routes a JSON
  round trip of a stored result, with no engine anywhere`.

### A Jev failure escalates safely rather than silently guessing — **verified (2026-09-20)**

- `packages/workflow/src/runtime/decision-port.test.ts > createDecisionPort failure semantics`:
  an engine failure comes out as a `DecisionError`, and an unregistered reference or a mismatched
  `questionKind` is refused **before** the engine is called (`engine.calls` is empty).
- `packages/workflow/src/runtime/decision-port.test.ts > createDecisionPort: persistence (M3-T3) >
  fails the node when the store fails, rather than continuing unrecorded` — the storage half of the
  same rule: a decision nobody recorded does not become a decision the workflow acted on.
- The runtime turns any of these into `decision.failed` and then into an escalation, which M4's own
  suite already covers.

### Verification can identify a deliberately unsupported field — **verified (2026-09-20)**

`packages/core/src/verify.test.ts > readVerification > identifies a deliberately unsupported field
and leaves the supported one alone`: an output whose `recommendation.rationale` claims *"Audited in
2019."* against evidence that says only *"SOC 2 Type II, renewed annually"* is reported as
unsupported, `category` is not, and the repair instruction is the exact sentence a re-run can be
given. `> applies the field's bands: a weakly supported `true` is not support` covers the banded
case, and `> asks a missing field to be produced, not cited` the absent one.

### Decision tests use fake engines by default; live Jev tests are explicitly tagged — **verified (2026-09-20)**

Every decision test in the repository runs against `createFakeDecisionEngine()` from
`@internal/testing`, or against `Experimental_EvaluationMockModelV4` from `ai/test` inside the
adapter's own unit tests, or against no engine at all. Two files are tagged `live:jev` and are the
only ones that would call a provider:

- `packages/decision-jev/src/jev-decision-engine.integration.test.ts` (M3-T2)
- `apps/example-agent/src/decisions/live-jev.integration.test.ts` (M3-T8/M3-T9)

Both skip with a printed reason when neither `AI_GATEWAY_API_KEY` nor `VERCEL_OIDC_TOKEN` is set,
and **neither has been run against a live model**, because no credential exists on this host.

### Live-provider tests do not run on normal pre-commit — **verified (2026-09-20)**

Both files are named `*.integration.test.ts`, which `vitest.config.ts` assigns to the `integration`
project and excludes from `unit` by suffix. `pnpm check` runs `pnpm test`, and `.husky/pre-commit`
runs the `unit` layer, so neither file is reachable from a commit. Observed: `pnpm vitest run
--project unit --project contract` (2026-09-20) collected 78 files and neither of the two.
