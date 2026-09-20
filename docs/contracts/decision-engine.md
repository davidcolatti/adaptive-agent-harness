---
status: active
owner: core
last_verified: 2026-09-20
related:
  - docs/milestones/build-plan.md
  - docs/contracts/README.md
  - docs/contracts/errors.md
  - docs/contracts/execution-context.md
  - docs/contracts/workflow-ir.md
  - docs/contracts/behavior-fingerprint.md
  - docs/decisions/0009-judgment-jev-is-separate-from-policy-thresholds-versioned-and-replayable.md
  - docs/decisions/0042-the-decision-contract-is-core-the-experimental-evaluation-api-is-the-adapter.md
  - docs/decisions/0026-harness-errors-serialize-to-a-whitelisted-trace-safe-shape.md
  - docs/decisions/0029-canonical-json-and-sha-256-behavior-fingerprints.md
  - docs/research/vercel/2026-09-20-m3-ai-sdk-evaluate.md
implementation:
  - packages/core
  - packages/decision-jev
  - packages/workflow
  - packages/testing
---

# Decision engine

The contract for **bounded probabilistic judgment**: asking a model a small, versioned question
about some evidence, and getting back an answer with enough surrounding fact that the answer can be
stored, audited, banded and replayed.

The governing rule is AD-009/ADR-0009, and it is worth stating before any type: **Jev answers
bounded questions; TypeScript decides what follows.** A `DecisionEngine` produces a judgment and
routes nothing. A `Policy` reads that judgment and routes, with no I/O. They are separate values,
separately versioned and separately stored, which is what makes "changing a policy threshold can
replay stored decisions without rerunning Jev" a property of the design rather than a promise.

Declared in `packages/core/src/decision.ts`, implemented over Jev by `packages/decision-jev`,
bridged to a `jev` workflow node by `packages/workflow`, and faked by `packages/testing`.

## Where the pieces live

| Package | What it owns |
| --- | --- |
| `@internal/core` | Questions, `DecisionEngine`, `DecisionRequest`/`DecisionResult`, confidence bands, `deriveConfidence()`, the policy API. Zero dependencies. |
| `@internal/decision-jev` | `createJevDecisionEngine()` over `experimental_evaluate`. **The only package that may import the AI SDK's evaluation API.** |
| `@internal/workflow` | `createDecisionPort()`, which adapts a `DecisionEngine` to the `WorkflowDecisionPort` a `jev` node is executed through. |
| `@internal/testing` | `createFakeDecisionEngine()`, the default engine for a unit test. |

## Questions

A question has an identity, a version, a kind, a prompt and, once someone has calibrated it, bands.

```ts
interface QuestionBase {
  readonly id: string;              // the shared identifier rule
  readonly version: string;         // exact major.minor.patch
  readonly kind: "boolean" | "choice" | "score";
  readonly prompt: string;
  readonly bands?: ConfidenceBands;
}

interface BooleanQuestion extends QuestionBase {
  readonly kind: "boolean";
  readonly criteria?: { readonly true?: string; readonly false?: string };
}

interface ChoiceQuestion extends QuestionBase {
  readonly kind: "choice";
  readonly choices: readonly string[];                          // non-empty, unique, ordered
  readonly choiceDescriptions?: Readonly<Record<string, string>>;
}

interface ScoreQuestion extends QuestionBase {
  readonly kind: "score";
  readonly levels: readonly string[];                           // at least two, ordered
}
```

**A question is versioned because its answers are evidence.** Two stored decisions are only
comparable when they answered the same question, so rewording a prompt, adding a choice or renaming
a level is a new version, not an edit. A `jev` node names `question.id@version` for exactly this
reason, and `createDecisionPort()` looks the pair up rather than the id alone.

A score's scale is its rubric: the answer is a fraction in `[0, levels.length - 1]`, which
`scoreRange(question)` returns. There is deliberately no free `min`/`max` pair, because a bare
numeric range says nothing about what a 3 means and a calibration fixture cannot check it.

`defineQuestion()` and `defineQuestionSet()` are the validating boundary, in the style of
`defineDomain()`: they report every issue at once with a path, and return the value deeply frozen.
An empty question set is rejected, because a request with no questions has no meaning.

### Naming against the AI SDK

M3-T1 asks for alignment with the AI SDK "where practical". The three kind names are its names
exactly. Three fields diverge, each for a reason internal to this repository, and ADR-0042 records
them:

| Harness | AI SDK | Why |
| --- | --- | --- |
| `kind` | `type` | `JevQuestionKind` and `CapabilityKind` already say `kind`. |
| `prompt` | `instructions` | `instructions` already means a domain agent's instructions here. |
| `choices` + `choiceDescriptions` | one `criteria` map | A contract must validate order and uniqueness; a map expresses neither. |

## Asking

```ts
interface DecisionRequest<TQuestions extends QuestionSet> {
  readonly state: JsonValue;          // ONE shared state, whatever the question count
  readonly questions: TQuestions;     // keyed by the names the answers come back under
  readonly signal?: AbortSignal;
  readonly context?: ExecutionContext;
}

interface DecisionEngine {
  evaluate<TQuestions extends QuestionSet>(
    request: DecisionRequest<TQuestions>,
  ): Promise<DecisionResult<TQuestions>>;
}
```

**Batching is by shared state and only by shared state** (M3-T6). One call asks several independent
questions about one body of evidence; two different bodies of evidence are two calls. That is the
harness's rule because it is the installed API's: evaluation "does not ... batch unrelated states".

`context` is **provenance and cancellation, not a trace sink.** An engine records nothing; see
"Trace ownership" below.

## The result

```ts
interface DecisionResult<TQuestions extends QuestionSet> {
  readonly decisionId: DecisionId;
  readonly answers: { readonly [K in keyof TQuestions]: AnswerFor<TQuestions[K]> };
  readonly stateFingerprint: string;              // fingerprint(state), ADR-0029
  readonly model: { readonly provider: string; readonly modelId: string };
  readonly usage: DecisionUsage;
  readonly latencyMs: number;
  readonly providerMetadata: JsonObject | null;
  readonly warnings: readonly string[];
}
```

Every answer carries the question it answered, its kind, its typed value, the distribution and the
confidence; a boolean answer additionally carries the raw `probabilityTrue`.

```ts
interface DecisionAnswerBase {
  readonly questionId: string;
  readonly questionVersion: string;
  readonly kind: QuestionKind;
  readonly distribution: Readonly<Record<string, number>> | null;
  readonly confidence: number | null;
}
```

| Kind | `value` | `distribution` keys |
| --- | --- | --- |
| `boolean` | `boolean`, plus `probabilityTrue` | `"true"` and `"false"` |
| `choice` | the chosen option, typed as the union of that question's choices | the option names |
| `score` | a fraction within `scoreRange()` | zero-based level indices, as strings |

**Everything here is JSON-representable**, so M3-T3 persists a result verbatim and a replay parses
one back. Nothing is a class, a `Date` or a function.

### What is `null`, and why absence is recorded rather than filled in

Three fields are routinely `null`, and each `null` is information:

- **`distribution`** is `null` when the provider supplied none. The installed API makes a
  distribution *optional* for choice and score questions and refuses to synthesize a missing one;
  the harness refuses too. An invented distribution would be indistinguishable from a measured one
  in storage and in a calibration report.
- **`confidence`** is `null` when it cannot be derived, which is usually because there is no
  distribution. It is not zero. `bandFor()` maps it to `human-review`.
- **`usage.costUsd`** is **always** `null` today. The installed evaluation API exposes no cost
  anywhere: `experimental_evaluate`'s `usage` is token counts only, and the provider-level result
  has no cost field at all. M3-T3's build-plan evidence list names cost, so the column is persisted
  as a null rather than filled with an estimate.

Token counts are likewise `null` rather than `0` when a provider does not report them.

## Confidence

There is **no portable confidence in the API**. The installed guide states that the SDK "does not
promise calibration across providers", that a boolean's `probability` "is not confidence in either
outcome", and that TypeSafe's own statistic "is not the selected option's probability or a portable
confidence measure". So the harness defines one, once, in core, and records the rule (ADR-0042):

```ts
deriveConfidence({ kind, value, distribution }): number | null
```

| Kind | Confidence |
| --- | --- |
| `boolean` | the mass on the side answered: `P(true)` for `true`, `1 - P(true)` for `false`. |
| `choice` | the chosen option's probability. |
| `score` | the probability mass within half a level of the score. |

The boolean rule is the one that catches people out: an answer of `false` at `P(true) = 0.02` is a
**confident** answer, and its confidence is `0.98`.

The score rule needs its reasoning stated, because it is the least obvious. A score's distribution
is over rubric levels and the score is its weighted mean, so the distribution describes *spread*,
not certainty in a selected option. Summing the mass within half a level of the answer asks the only
question a band can act on — how concentrated the model is around where it landed — and it degrades
correctly: a distribution split between the two ends produces a middling score with almost no mass
near it, and therefore a low confidence.

A provider's own statistic is carried in `providerMetadata` verbatim and **never** adopted as
`confidence`.

## Confidence bands

```ts
interface ConfidenceBands {
  readonly auto: number;         // confidence >= auto        -> "auto"
  readonly agentReview: number;  // confidence >= agentReview -> "agent-review"
}                                // otherwise, or absent      -> "human-review"
```

Validated as `0 <= agentReview <= auto <= 1`. Equal thresholds are legal and collapse the
agent-review band, which is a calibration a domain may genuinely want.

**Per question, with no default** (M3-T5: "do not define one global `.90` threshold"). Bands are a
property of a calibrated question, and M3-T9's calibration fixture is what earns a question its
pair.

Banding **fails closed twice over**:

1. A `null` confidence is `human-review`. A decision the harness cannot score is one it must not act
   on.
2. A question with **no bands at all** is `human-review`, whatever its confidence. An uncalibrated
   question has no threshold to clear, and letting a high number route a case automatically is the
   exact failure per-question calibration exists to prevent.

## Policy

```ts
const result = await decisionEngine.evaluate(request);
const outcome = policy.evaluate(result);
```

```ts
interface Policy<TQuestions extends QuestionSet, TRoute extends string> {
  readonly id: string;
  readonly version: string;
  readonly thresholds: JsonObject;   // exposed as data, so it can be hashed
  evaluate(result: DecisionResult<TQuestions>): PolicyOutcome<TRoute>;
}

interface PolicyOutcome<TRoute extends string> {
  readonly route: TRoute;
  readonly policy: { readonly id: string; readonly version: string };
  readonly reasons: readonly string[];   // at least one, always
}
```

`definePolicy({ id, version, thresholds, route })` validates the identity, freezes the thresholds
and stamps `{ id, version }` onto every outcome, so a persisted outcome names the policy version
that produced it without anyone remembering to record it. An outcome with no reasons is rejected:
an unauditable route defeats the point of separating judgment from policy.

**A policy performs no I/O.** That is what makes the milestone's acceptance criterion work: a
`DecisionResult` parsed back from stored JSON is a legitimate argument, and a new threshold version
over the same result is a new outcome with no engine call. `packages/core/src/decision.test.ts`
proves it by round-tripping a result through `JSON.stringify`/`parse` and routing it through two
policy versions that disagree.

`policyFingerprint(policy)` is the `sha256:` digest of `{ id, version, thresholds }`, so a policy
whose numbers changed without its version changing is detectable rather than silently equal —
ADR-0009's "thresholds are versioned and replayable", made checkable.

## Failure semantics

An engine that cannot obtain a judgment throws `DecisionError`. It must never return a fabricated
answer, a default choice or a zero confidence, because a caller cannot tell those apart from a real
low-confidence judgment. This covers a provider failure, an unsupported question kind, a malformed
answer and an abort.

`DecisionError.details` is trace-safe (ADR-0026) and names what went wrong:

| `reason` | Extra details |
| --- | --- |
| `unsupported-question-kind` | `unsupportedQuestionId`, `unsupportedQuestionKind`, `modelProvider`, `modelId` |
| `provider-failure` | `modelProvider`, `modelId`, the question refs, `latencyMs` |

**A low-confidence answer is not a failure.** It is a normal result, and banding is what handles it.
The distinction is the whole of "a Jev failure escalates safely rather than silently guessing": the
workflow runtime turns a thrown `DecisionError` into a `decision.failed` span and then into an
escalation, while a `human-review` band is an ordinary route through the graph.

## Trace ownership

**A `DecisionEngine` emits no trace events.** The local workflow runtime already opens a
`decision.started` span around every `jev` node and closes it with `decision.completed` or
`decision.failed`, and one `evaluate` call may answer several questions that no single node span
describes. An engine that also emitted would double-count every Jev call in
`pnpm harness run show`. `DecisionRequest.context` therefore exists for cancellation and provenance
only. Recorded in ADR-0042.

## The Jev adapter

```ts
import { createJevDecisionEngine, JEV_GATEWAY_MODEL_ID } from "@internal/decision-jev";

const engine = createJevDecisionEngine({ model: JEV_GATEWAY_MODEL_ID });
```

`model` is an `Experimental_EvaluationModel`: a v4 model instance from a provider, a registry or a
`customProvider` alias, or a bare model-id string. `JEV_GATEWAY_MODEL_ID` is `"typesafe-ai/jev"`,
the id `@ai-sdk/gateway` enumerates for Jev; a string resolves through the AI Gateway, authenticated
with `AI_GATEWAY_API_KEY` or Vercel OIDC.

`@ai-sdk/gateway` is **not** a dependency of the adapter. `ai` depends on it and resolves the string
itself, so naming Jev costs no new pin (ADR-0024).

Because the provider name is not in the result and a string caller never sees the resolved model,
a string id records provider `"gateway"`; a caller who has configured an evaluation-capable default
provider passes `provider` to say so.

What the adapter translates, in both directions, is set out in
`docs/research/vercel/2026-09-20-m3-ai-sdk-evaluate.md`. The one derivation worth naming here: a
boolean answer's `P(true)` becomes a judgment (`>= 0.5`), an exact two-point distribution
(`{ true: p, false: 1 - p }`) and a confidence, while the raw number survives as `probabilityTrue`.
That is arithmetic on a number the provider supplied, not the probability synthesis the SDK
declines to perform.

## The `jev` node bridge

```ts
const runtime = createWorkflowRuntime({
  registry,
  agentRuntime,
  decisionEngine: createDecisionPort({ engine, questions: [classify, verify] }),
});
```

A `jev` node names a question and does not define one, so the missing half was always a registry of
questions; `createDecisionPort()` takes it, as an array or a keyed record, and indexes it by each
question's own `id@version`. The node's validated input becomes the decision's `state`, and the
node outputs:

```ts
interface DecisionNodeOutput {
  readonly answer: boolean | string | number;
  readonly confidence: number | null;
  readonly band: "auto" | "agent-review" | "human-review";
  readonly distribution: Readonly<Record<string, number>> | null;
  readonly decisionId: string;
}
```

Flat and small on purpose: a node's output is consumed through the five-case `Binding` model rather
than by code, so every field here is something a `branch` node can select on.

The port rejects, as `DecisionError` and before calling the engine, a question the registry does not
hold and a node whose declared `questionKind` disagrees with the registered question's kind.

Nothing in the interpreter changed when this landed, which is what `runtime/ports.ts` predicted.

## Testing

`createFakeDecisionEngine()` in `@internal/testing` is the default engine for a decision test, which
is Milestone 3's own rule: "decision tests use fake engines by default; live Jev tests are
explicitly tagged."

```ts
const engine = createFakeDecisionEngine({
  script: {
    "vendor-triage.category@1.0.0": {
      value: "software",
      distribution: { software: 0.96, services: 0.03, hardware: 0.01 },
    },
    "vendor-triage.obviously-low-risk": true,
  },
});
```

Entries are keyed by `id@version` or by bare `id`, with the versioned key winning. A bare value is
shorthand for an answer with no distribution, and therefore no confidence and the `human-review`
band. The fake derives confidence through the **same** core function the real adapter uses, so a
banding test exercises the real rule rather than a number the test typed in. `failWith` makes every
call fail, which is how the escalation path is tested. An **unscripted question is an error**: a
fake that invented a default would be a silent source of wrong judgments in exactly the tests
written to prove the harness does not guess.

The adapter's own unit tests drive `Experimental_EvaluationMockModelV4` from `ai/test`, the double
the installed package ships, so they run against the same type a real provider satisfies — including
the SDK's own answer validation. The single live test is `*.integration.test.ts`, tagged
`live:jev`, excluded from the `unit` project by file suffix and therefore from pre-commit, and it
skips with a printed reason when neither `AI_GATEWAY_API_KEY` nor `VERCEL_OIDC_TOKEN` is set.

## Persistence (M3-T3)

A decision's evidence is **one** `DecisionRecord`:

```ts
interface DecisionRecord {
  readonly id: DecisionId;          // always equal to result.decisionId
  readonly runId: RunId;
  readonly nodeId: NodeId | null;   // null when no workflow node asked
  readonly result: DecisionResult<QuestionSet>;   // exactly what the engine produced
  readonly policy: PolicyOutcome<string> | null;  // exactly what the organization decided
  readonly createdAt: string;
}
```

**The two halves are separate fields of one record**, and that is Milestone 3's acceptance criterion
"raw Jev result is stored separately from policy outcome" made structural: adding, changing or
removing a policy cannot alter a byte of `result`. They are one row because they were produced by
one call about one state.

The build plan lists nine things to store. Every one is reachable from the record:

| Build plan item | Where |
| --- | --- |
| question ID/version | `result.answers[key].questionId` / `.questionVersion` |
| input-state fingerprint | `result.stateFingerprint` |
| answer | `result.answers[key].value` |
| available probability distribution | `result.answers[key].distribution`, `null` when the provider gave none |
| confidence metadata | `result.answers[key].confidence` (harness-derived) and `result.providerMetadata` (the provider's own, verbatim) |
| model/provider | `result.model.modelId` / `.provider` |
| cost | `result.usage.costUsd`, plus three token counts |
| latency | `result.latencyMs` |
| policy version that consumed the answer | `policy.policy.id` / `.version` |

`costUsd` is `null` on every row this milestone writes. That is a measurement rather than an
omission: the installed evaluation API exposes no cost anywhere, and an estimate would be
indistinguishable from a reported number once it was in a column.

`parseDecisionRecord()` is the strict read boundary, in `parseJob()`'s style. Three of its checks
are the ones a corrupted row fails: `id` must equal `result.decisionId`, `stateFingerprint` must be
a `sha256:<64 hex>` digest, and a `policy` that is present must carry at least one reason.

`Storage.saveDecision()` and `Storage.listDecisions()` are the port; see
[`storage.md`](storage.md). Writing happens **inside** `createDecisionPort()`, the one place that
already turns a `jev` node into an engine call, and a storage failure is a `StorageError` that
**fails the node**: a workflow must not act on a judgment nobody recorded.

## Replay (M3-T3)

```ts
const stored = await storage.listDecisions(runId);
const report = replayDecisions(stored, tighterPolicy);

report.changed;      // how many cases the new thresholds would route differently
report.routeChanges; // each `from -> to` move, with a count
```

`replayDecisions()` is pure, lives in `@internal/core`, and **takes no engine**, which is the
strongest available statement of "changing a policy threshold can replay stored decisions without
rerunning Jev": there is no engine parameter to call. It reads only the `result` half of each
record, which is exactly the half a policy is contractually allowed to see, and it modifies nothing.

A record whose stored `policy` is `null` counts as changed, because nothing routed it before and
something routes it now.

## `verify` (M3-T7)

```ts
const compiled = compileVerification({
  output: triage,
  outputSchema: "vendor-triage.output@1.0.0",
  evidence: documents,
  fields: [
    { path: ["category"] },
    { path: ["recommendation", "decision"], bands: { auto: 0.9, agentReview: 0.7 } },
  ],
});

const result = await engine.evaluate({ state: compiled.state, questions: compiled.questions });
const reading = readVerification(result, compiled.fields);

reading.unsupported[0]?.repair;
// "The field `recommendation.decision` (`proceed`) is not supported by the evidence;
//  cite a source that establishes it, or remove it."
```

It lives in `@internal/core`, **not** in the Jev adapter, because composing questions is
engine-agnostic: the compiled set goes to the Jev adapter, to the fake engine, or to anything else
implementing `DecisionEngine`.

**One boolean question per configured field**, and all of them in one call, because they share one
state. A single "is this output supported?" question would answer with one bit for an object with
ten fields and give a re-run nothing to act on; per-field questions are what make "identify a
deliberately unsupported field" mean the field. A field the output does **not** carry is still asked
about, because a missing required field must not be indistinguishable from a supported one.

A field counts as supported when the answer is `true` **and**, when its question declares bands, the
band is `auto`. A field whose question declares no bands is judged by its answer alone: there is no
calibration to apply, and inventing one would be the global threshold M3-T5 forbids.

The `repair` string is a **sentence**, not a code, because it is appended to the same logical agent
task's input. There are three wordings for the three failures: the evidence contradicts the value,
the evidence supports it only weakly, or the output never produced it.

## Calibration (M3-T9)

`runCalibration({ engine, questions, policy, cases, primary, fallbackRoute })` runs a labeled set
one case at a time and reports the five metrics the build plan names:

| Metric | Definition |
| --- | --- |
| confusion matrix | one cell per `(expected route, actual route)` pair that occurred, with a count |
| accuracy | the fraction of cases routed as labeled |
| uncertain-band rate | the fraction whose **primary** answer did not land in `auto` |
| false-auto rate | the fraction whose primary answer landed in `auto`, whose route was **not** the fallback, and whose route was wrong |
| fallback rate | the fraction routed to `fallbackRoute` |

The false-auto rate excludes fallbacks deliberately, so raising a threshold can cost accuracy but
can never raise the one number that measures being confidently wrong. The report does not combine
accuracy and fallback rate into a single score, because falling back is the safe outcome and being
confidently wrong is not, and a reader comparing two threshold sets needs to watch the two move
against each other.

`renderCalibrationReport()` renders it as plain text, for a terminal. The vendor-triage
implementation lives in `apps/example-agent/src/decisions/` and runs as
`pnpm --filter @internal/example-agent run calibrate`; see
[`../examples/README.md`](../examples/README.md).
