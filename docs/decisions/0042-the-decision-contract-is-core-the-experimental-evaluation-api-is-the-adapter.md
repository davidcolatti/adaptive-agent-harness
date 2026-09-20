---
status: accepted
date: 2026-09-20
deciders: coding agent (M3-T1/T2/T4/T5/T6), per the build plan's Milestone 3
related: [0003, 0009, 0011, 0024, 0038, 0040]
supersedes: null
superseded_by: null
---

# ADR-0042: The decision contract is a core contract; the experimental evaluation API is an adapter

## Context

Milestone 3 makes bounded judgment a first-class primitive. AD-009/ADR-0009 already fixed the
governing split — "Jev answers bounded questions. TypeScript decides what follows", with thresholds
"versioned and replayable" — and build plan section 5 fixes the interface verbatim:

```ts
interface DecisionEngine {
  evaluate<TQuestions extends QuestionSet>(
    request: DecisionRequest<TQuestions>
  ): Promise<DecisionResult<TQuestions>>;
}
```

What section 5 does not fix is everything the milestone's tasks need decided: what a question *is*
(M3-T1), what an answer and a result carry (M3-T2, M3-T3), how a policy is declared and replayed
(M3-T4), how confidence becomes a band (M3-T5), and what "batch" means (M3-T6).

The constraints on those answers come from three places. **The build plan** says Jev is reached
"through AI Gateway as `typesafe-ai/jev`", that "AI SDK 7 exposes evaluation through the
experimental evaluation API", and — as an instruction, not an observation — "keep that experimental
API isolated inside the adapter package". **The installed AI SDK** (`ai@7.0.107`) says of that same
API that it "is experimental and may change in patch releases", that "the SDK does not promise
calibration across providers", that a provider's own confidence statistic "is not ... a portable
confidence measure", and that a probability distribution is *optional* for choice and score
questions while *required* for boolean ones. **The dependency rule** (AGENTS.md, build plan section
4) says `core` may have no third-party dependency and that `ai` is adapter-only, which
`tests/architecture/boundaries.ts` already encodes with `@internal/decision-jev` listed as a
declared adapter.

M4 also left a precise hole to fill. A `jev` node "**names** a question; it does not define one", a
question is deliberately not a `CapabilityKind`, and `WorkflowDecisionPort` exists with one verb
and the note that "when M3 lands, this port is what its engine is adapted to, and nothing in the
interpreter changes". The M4 runtime already opens a `decision.started` span around a `jev` node
and closes it with `decision.completed` or `decision.failed`.

Full API findings are in `docs/research/vercel/2026-09-20-m3-ai-sdk-evaluate.md`.

## Decision

**1. The decision contract lives in `@internal/core`; the AI SDK evaluation API lives only in
`@internal/decision-jev`.** `packages/core/src/decision.ts` declares questions, `DecisionEngine`,
`DecisionRequest`, `DecisionResult`, confidence bands and the policy API, and imports nothing
third-party. `experimental_evaluate`, `Experimental_EvaluationModel`,
`Experimental_EvaluationQuestion` and `Experimental_EvaluationUnsupportedQuestionTypeError` MUST NOT
appear outside `packages/decision-jev`. The same core/behavior split ADR-0038 made for the workflow
IR.

**2. A question is a versioned, validated declaration of one of three kinds.** `BooleanQuestion`,
`ChoiceQuestion` and `ScoreQuestion` each carry `id` (the shared identifier rule), `version` (exact
semver), `kind` (one of `JEV_QUESTION_KINDS`), `prompt`, and optional `bands`.
`defineQuestion()`/`defineQuestionSet()` are the validating boundary, in the style of
`defineDomain()`. Harness naming follows the SDK where practical and diverges in exactly three
places, all deliberate:

| Harness | AI SDK | Why |
| --- | --- | --- |
| `kind` | `type` | `JevQuestionKind` and `CapabilityKind` already say `kind`; a second word for the same idea would be the drift. |
| `prompt` | `instructions` | `instructions` already names a domain's agent instructions throughout this repository (`DomainDefinition`, the behavior fingerprint's components); reusing it for a question's wording would collide. |
| `choices: readonly string[]` plus optional `choiceDescriptions` | one `criteria` map | A contract has to validate that options are non-empty, ordered and unique. A map cannot express order, and `Object.keys` order is a weak place to put it. |

A `ScoreQuestion` declares `levels`, at least two ordered descriptions, and its scale is
`[0, levels.length - 1]` (`scoreRange()`) rather than a free `min`/`max` pair, because a bare range
says nothing about what a 3 means and a calibration fixture cannot check it.

**3. A result carries the full evidence, JSON-representable, with absence recorded as `null`.**
`DecisionResult` carries `decisionId`, one typed answer per question key, `stateFingerprint`
(`fingerprint(state)`, ADR-0029), `model: { provider, modelId }`, `usage`, `latencyMs`,
`providerMetadata` and `warnings`. Each answer carries `questionId`, `questionVersion`, `kind`, the
typed `value`, `distribution` and `confidence`; a boolean answer additionally carries the raw
`probabilityTrue`. Nothing here is a class, a `Date` or a function, so M3-T3 persists it verbatim
and M12 replays a parsed one.

A missing distribution MUST be `null` and MUST NOT be synthesized — matching the SDK's own refusal
to synthesize one. `usage.costUsd` MUST be `null` until a provider exposes a cost, because the
installed evaluation API exposes none anywhere; an adapter MUST NOT estimate it.

**4. Confidence is a harness-owned derivation, defined once, in core.** Because no portable
confidence exists in the API, `deriveConfidence()` defines one from the distribution alone:

| Kind | Confidence |
| --- | --- |
| `boolean` | the mass on the side answered: `P(true)` for `true`, `1 - P(true)` for `false`. |
| `choice` | the chosen option's probability. |
| `score` | the probability mass within half a level of the score. |

`null` when there is no distribution, when it is empty, or when the relevant entry is not a
probability. A provider's own statistic (`providerMetadata.typesafe.confidence`) is carried verbatim
and MUST NOT be adopted as `confidence`, on the guide's own statement that it is not portable.

**5. Confidence bands are per question and fail closed.** `ConfidenceBands = { auto, agentReview }`,
validated as `0 <= agentReview <= auto <= 1`, maps confidence to `auto`, `agent-review` or
`human-review`. There is no default pair and no global threshold (M3-T5). A `null` confidence maps
to `human-review`, and a question with **no** bands maps to `human-review` whatever its confidence,
because an uncalibrated question has no threshold to clear.

**6. A policy is a deterministic, versioned, I/O-free function object.** `definePolicy({ id,
version, thresholds, route })` returns a `Policy` whose `evaluate(result)` stamps `{ id, version }`
onto a `PolicyOutcome` and requires at least one reason. `thresholds` is exposed as JSON so
`policyFingerprint()` can hash it, making ADR-0009's "thresholds are versioned and replayable"
checkable rather than asserted. A `Policy` MUST perform no I/O, so a `DecisionResult` parsed from
storage is a legitimate argument and a threshold change replays stored decisions without re-invoking
Jev.

**7. Batching is by shared state, and only by shared state.** One `evaluate` call carries one
`state` and a non-empty `QuestionSet`, keyed by the caller's own names. This is not a harness
choice so much as the API's only shape: it "does not ... batch unrelated states".

**8. An engine failure is a `DecisionError` and never an answer.** Provider failure, unsupported
question kind, malformed answer and abort all leave the adapter as one error type with trace-safe
details (ADR-0026). The unsupported-kind case carries `questionId`, `questionKind`, `provider` and
`modelId` from the SDK's own error, detected with its documented marker-based `isInstance`.

**9. Trace emission belongs to the caller, not to the engine.** A `DecisionEngine` MUST NOT emit
`decision.*` events. `DecisionRequest.context` is provenance and cancellation only. The workflow
runtime already owns the `decision.*` span around a `jev` node, and one `evaluate` call may answer
several questions that no single node span describes; an engine that also emitted would double-count
every Jev call in `pnpm harness run show`.

**10. Jev is reached by model id string through the Gateway, with no new dependency.**
`JEV_GATEWAY_MODEL_ID = "typesafe-ai/jev"`, the id `@ai-sdk/gateway@4.0.87`'s
`GatewayEvaluationModelId` enumerates. A caller may pass any `Experimental_EvaluationModel`
instead — a provider factory, a registry entry or a `customProvider` alias. `@ai-sdk/gateway` is
**not** added as a dependency: `ai` depends on it and resolves the string itself, so adding it would
be a new pin under ADR-0024 for nothing. Because the provider name is not in the result and a string
caller never sees the resolved model, a string id records provider `"gateway"` unless the caller
overrides it.

**11. The `jev` node's output shape is fixed.** `createDecisionPort({ engine, questions })` adapts a
`DecisionEngine` to M4's `WorkflowDecisionPort`, looking the node's `question.id@version` up in a
caller-supplied registry and returning
`{ answer, confidence, band, distribution, decisionId }`. It rejects an unregistered question and a
node whose declared `questionKind` disagrees with the registered question, both as `DecisionError`,
before calling the engine.

## Consequences

### Positive

- The experimental surface has exactly one import site, so a patch-level SDK change that the guide
  explicitly warns about is a change to `packages/decision-jev/src/jev-decision-engine.ts` and
  nothing else. `@internal/core`, `@internal/workflow` and every domain see a stable contract.
- ADR-0009's replayability is structural, not aspirational: the policy test parses a stored result
  from JSON, routes it through two threshold versions, gets two routes, and never constructs an
  engine.
- Every place the harness would have had to guess — cost, confidence, a missing distribution — is a
  `null` that a reader can distinguish from a measurement, so a calibration report (M3-T9) cannot be
  quietly contaminated by fabricated numbers.
- Failing closed on missing confidence *and* on missing bands means a question cannot route a case
  automatically until someone has calibrated it, which is what M3-T5 is for.
- Nothing in M4's interpreter changed, exactly as `ports.ts` predicted.

### Negative

- The confidence rule is the harness's, so two harness versions could disagree about the same stored
  distribution. The mitigation is that `distribution` is stored verbatim, so a recomputation is
  always possible; the derived number is a convenience over the evidence, not the evidence.
- The score confidence rule (mass within half a level) is a judgment call with no external authority
  behind it. It is defensible and documented, but a domain whose rubric is very coarse or very fine
  may find it pessimistic, and M3-T9's calibration is the only way to find out.
- `costUsd` is always `null`, so the build plan's decision-evidence list is satisfied by a field
  that carries no information yet. M3-T3 must persist the null rather than omit the column.
- A question is not a `CapabilityKind`, so questions are registered by whoever builds the decision
  port rather than resolved through the capability registry. M5 will have to decide where a
  workflow's question registry actually comes from.

### Neutral

- Three naming divergences from the AI SDK mean the adapter does a small, explicit translation in
  both directions. That translation is the adapter's whole job.
- `QuestionSet` is keyed by the caller's names rather than by question id, matching the SDK, so one
  request may ask the same question twice of different parts of a state.
- `@internal/testing` gains `createFakeDecisionEngine()`, which derives confidence through the same
  core function the real adapter uses, so a banding test exercises the real rule.

## Alternatives considered

- **Put the AI SDK types in `core` and let the adapter be thin.** Rejected outright: the dependency
  rule forbids `core` from depending on `ai`, and the boundary test enforces it. It would also tie
  the harness's persisted evidence shape to a surface the SDK says may change in a patch release.
- **Adopt `providerMetadata.typesafe.confidence` as `confidence`.** Rejected on the installed
  guide's own words — it "is not the selected option's probability or a portable confidence
  measure" — and because it would leave every non-TypeSafe provider with no confidence at all,
  silently changing banding behavior with the model.
- **Treat a boolean's `probability` as confidence directly.** Rejected: the guide states it "is not
  confidence in either outcome", and doing so would band a confident `false` at `0.02` as
  `human-review`, which is backwards.
- **Give confidence a default global threshold of `.90`.** Rejected by M3-T5 in as many words: "do
  not define one global `.90` threshold."
- **Let a question with no bands default to `auto` when confidence is high.** Rejected: it would let
  an uncalibrated question route a case automatically, which is the failure mode per-question
  calibration exists to prevent.
- **Have the engine emit `decision.*` spans.** Rejected: the M4 runtime already emits them around a
  `jev` node, so the inspector would count every Jev call twice, and a batch call answering three
  questions does not correspond to any one node span.
- **Add `@ai-sdk/gateway` as a direct dependency to name the Jev model through
  `gateway.evaluationModel()`.** Rejected under ADR-0024: it is already a transitive dependency of
  `ai`, and `experimental_evaluate` resolves the string id through it with no import. A new pin for
  a constant string is not worth it.
- **Give `ScoreQuestion` a free `min`/`max` range.** Rejected in favor of the SDK's level list,
  which both aligns naming and puts the meaning of a score where a calibration fixture can read it.
- **Ask several `jev` nodes' questions in one batched call.** Rejected: two nodes have different
  inputs by construction, so they are different states, and the API batches only within one state.
  A workflow that genuinely wants several questions over one state uses a `code` node.

## References

- `docs/milestones/build-plan.md` § "Milestone 3 --- Jev as a First-Class Decision Primitive",
  § 5 "Core Contracts" (Decision engine), AD-009, AD-011, AD-016
- `docs/research/vercel/2026-09-20-m3-ai-sdk-evaluate.md` (the installed-API findings this rests on)
- Related ADRs: ADR-0003, ADR-0009, ADR-0011, ADR-0024, ADR-0026, ADR-0029, ADR-0038, ADR-0040
- Related code paths: `packages/core/src/decision.ts`,
  `packages/decision-jev/src/jev-decision-engine.ts`,
  `packages/workflow/src/runtime/decision-port.ts`,
  `packages/testing/src/fake-decision-engine.ts`
- Installed sources: `ai@7.0.107` `docs/03-ai-sdk-core/32-evaluation.mdx`,
  `docs/07-reference/01-ai-sdk-core/14-evaluate.mdx`, `dist/index.d.ts` lines 7606-7654;
  `@ai-sdk/provider@4.0.17` `dist/index.d.ts` lines 2254-2340; `@ai-sdk/gateway@4.0.87`
  `dist/index.d.ts` line 7
