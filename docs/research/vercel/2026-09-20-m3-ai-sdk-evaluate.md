---
status: active
owner: core
last_verified: 2026-09-20
related:
  - docs/development/source-of-truth-protocol.md
  - docs/research/vercel/2026-09-19-m1-eve-ai-sdk-install-survey.md
  - docs/contracts/decision-engine.md
  - docs/decisions/0009-judgment-jev-is-separate-from-policy-thresholds-versioned-and-replayable.md
  - docs/decisions/0011-no-vercel-implementation-detail-may-be-guessed.md
  - docs/decisions/0024-framework-dependency-versioning-policy.md
  - docs/decisions/0042-the-decision-contract-is-core-the-experimental-evaluation-api-is-the-adapter.md
  - docs/milestones/m3-jev-as-a-first-class-decision-primitive.md
implementation:
  - packages/decision-jev
  - packages/core
---

# M3-T1/T2: the AI SDK evaluation API, as installed

The research checkpoint for the harness decision contract and its Jev adapter. It answers, from the
installed packages alone, the four questions Milestone 3 could not start without: **which question
kinds exist and what fields they carry**, **what an answer looks like per kind and whether a
probability distribution or a confidence is exposed**, **how an evaluation model is named and how
Jev in particular is reached**, and **what happens when a model cannot answer a kind**. No behavior
here is inferred from memory, a blog post or an older example.

## Versions and resolution

| Package | Version | How it is reached |
| --- | --- | --- |
| `ai` | 7.0.107 | Direct dependency of `packages/decision-jev` (and of `packages/runtime-ai-sdk` since M1-T1). Resolved at `node_modules/.pnpm/ai@7.0.107_zod@4.6.5/node_modules/ai`. |
| `@ai-sdk/provider` | 4.0.17 | Transitive, through `ai`. Owns the `EvaluationModelV4*` types. |
| `@ai-sdk/gateway` | 4.0.87 | Transitive, through `ai`. Owns `GatewayEvaluationModelId`. |

Resolution was confirmed with the command the source-of-truth protocol prescribes:

```sh
node -e 'console.log(require.resolve("ai/package.json",{paths:["packages/runtime-ai-sdk"]}))'
```

**Neither `@ai-sdk/provider` nor `@ai-sdk/gateway` is a direct dependency of any workspace package,
and neither needs to be.** `ai` depends on both, re-exports the evaluation types under
`Experimental_*` aliases, and resolves a bare model-id string through the Gateway itself. Adding
either one would be a new pinned dependency under ADR-0024 for no gain.

## Sources read

Installed docs, in the order the protocol ranks them:

- `ai/docs/03-ai-sdk-core/32-evaluation.mdx` — the evaluation guide. Question types, provider
  models, model aliases and registries, default-provider strings, "Probabilities and confidence",
  errors and cancellation, and the explicit scope statement.
- `ai/docs/07-reference/01-ai-sdk-core/14-evaluate.mdx` — the `experimental_evaluate()` reference:
  parameters, result fields, the provider specification, errors and model resolution.
- `ai/docs/07-reference/05-ai-sdk-errors/ai-evaluation-unsupported-question-type-error.mdx` — the
  one evaluation-specific error class and its fields.
- `ai/docs/07-reference/01-ai-sdk-core/42-custom-provider.mdx` and `40-provider-registry.mdx` —
  `customProvider({ evaluationModels })` and `registry.evaluationModel('provider:model')`.

Installed types:

- `ai/dist/index.d.ts` lines 7606-7654: `EvaluationModel`, `EvaluationQuestion`,
  `EvaluationAnswer<QUESTION>`, `EvaluationResult<QUESTIONS>` and the `evaluate` declaration
  exported as `experimental_evaluate`.
- `@ai-sdk/provider/dist/index.d.ts` lines 2254-2340: `EvaluationModelV4Input`,
  `EvaluationModelV4Question`, `EvaluationModelV4CallOptions`, `EvaluationModelV4Answer`,
  `EvaluationModelV4Result`, `EvaluationModelV4`.
- `@ai-sdk/gateway/dist/index.d.ts` line 7 and lines 980-986.
- `ai/dist/test/index.d.ts` line 59 and its export map.
- `ai/dist/index.js` lines 14548-14609: the `evaluate` implementation, read to settle two questions
  the types alone do not answer (below).

The runnable examples the guide points at
(`examples/ai-functions/src/evaluate` in `vercel/ai`) are **not** shipped inside `node_modules`, so
levels 1 and 2 of the precedence list are the whole basis for this note.

## The API surface

```ts
import { experimental_evaluate } from "ai";

const result = await experimental_evaluate({
  model,              // Experimental_EvaluationModel = string | Experimental_EvaluationModelV4
  state,              // string | JSON object | JSON array — ONE shared state
  questions,          // Record<string, Experimental_EvaluationQuestion>, non-empty
  maxRetries,         // default 2
  abortSignal,
  headers,
  providerOptions,
});
```

`Experimental_EvaluationModelV4` declares `specificationVersion: 'v4'`, `provider`, `modelId`,
`supportedQuestionTypes` and `doEvaluate(options)`. Evaluation is deliberately isolated from the
stable `ProviderV4` interface, which is the SDK's own statement that this surface is not covered by
its stability guarantees.

### The three question kinds

| Kind | Criteria field | Answer |
| --- | --- | --- |
| `boolean` | optional `criteria.true` / `criteria.false`, each a description or `null` | **required** `probability`: the model's estimate of P(true), finite and in `[0, 1]` |
| `choice` | **required** `criteria`: a non-empty map of option name to description or `null` | `choice` (a key of `criteria`), plus **optional** `probabilities` over every option |
| `score` | **required** `criteria`: an array of at least two ordered level descriptions, indexed from zero | `score`, a fraction in `[0, levels.length - 1]`, plus **optional** `probabilities` keyed by level index as a string |

Every question also carries `instructions`, which may be a string, a JSON object or a JSON array.
Answers "retain question IDs and have the same `type` as their question".

### Is a probability distribution exposed?

**Sometimes, and the difference is load-bearing.**

- `boolean`: **always**. `probability` is required by the type and by the guide.
- `choice` and `score`: **optional**. The guide says so twice ("Choice and Score distributions are
  optional"; "Check for optional distributions before using them") and the reference adds that
  "neither partial results nor missing probability synthesis are supported" — that is, the SDK will
  not invent a distribution a provider did not send.
- The guide records which providers supply what: "TypeSafe AI supplies native Choice, Score, and
  Boolean evaluations", while the OpenAI/Anthropic/Google adapters "adapt structured language-model
  output for all three types" and, for those adapters, "Choice and Score answers do not include
  probability distributions."

When a distribution *is* present it is validated: it covers every option, the selected choice has
maximal probability, a score equals its probability-weighted mean, and the whole thing sums to one
within `0.000001` (widened by declared `rounding` decimals). The harness relies on that validation
rather than repeating it — and one of `packages/decision-jev`'s tests had to be corrected against
it, which is direct evidence that it runs.

### Is a confidence exposed?

**No portable one, and the guide is emphatic about it.**

- A boolean's `probability` "is not confidence in either outcome": `0.98` is a strong yes and
  `0.02` a strong *no*.
- "The SDK does not promise calibration across providers", and the prompted P(true) estimates from
  language-model adapters "are not guaranteed to be calibrated."
- TypeSafe's own statistic lives at `result.providerMetadata?.typesafe?.confidence`, keyed by
  question id, and the guide states in the same paragraph that "it is not the selected option's
  probability or a portable confidence measure."
- The guide's own advice is to "choose Boolean thresholds in application code, using labeled data
  from the task" — which is exactly M3-T5's per-question bands and M3-T9's calibration fixture.

**Consequence for the harness:** a single comparable `confidence` number has to be harness-owned or
not exist. `deriveConfidence()` in `@internal/core` is that rule, recorded in ADR-0042.
`providerMetadata` is carried verbatim so TypeSafe's statistic is never lost, and never adopted.

### Is a cost exposed?

**No.** `experimental_evaluate`'s result carries `usage` with `inputTokens`, `outputTokens` and
`totalTokens` only, each possibly `undefined`; `totalTokens` is computed by the SDK and present only
when both halves are. The provider-level `EvaluationModelV4Result` has `usage`, `rounding`,
`warnings`, `providerMetadata` and `response` — and no cost field at all.

This matters to **M3-T3**, whose build-plan list of decision evidence includes "cost".
`DecisionUsage.costUsd` is therefore `null` on every result the adapter produces today. Persisting
a null is correct; estimating a number would put a fabricated figure into the evidence ledger.

### How is a model named, and how is Jev reached?

Four documented ways, in the guide's own order:

1. A provider factory: `typeSafeAi.evaluationModel('jev-latest')`.
2. A registry: `createProviderRegistry({...}).evaluationModel('providerId:modelId')`.
3. A `customProvider({ evaluationModels: { alias: model } })`, then `.evaluationModel('alias')`.
4. A **bare string**, which "resolve[s] through Vercel AI Gateway unless you configure an
   evaluation-capable default provider" via `globalThis.AI_SDK_DEFAULT_PROVIDER`.

`@ai-sdk/gateway@4.0.87` settles the spelling: `GatewayEvaluationModelId` is
`'typesafe-ai/jev' | (string & {})`, and the Gateway provider exposes both `evaluation(modelId)` and
`evaluationModel(modelId)`. **`typesafe-ai/jev` is therefore the Gateway id, confirmed by the
installed types**, and the build plan's statement that "Vercel currently exposes Jev through AI
Gateway as `typesafe-ai/jev`" is accurate. The guide's own example uses `typesafe-ai/jev-latest`
against the Gateway, which the `(string & {})` half of the type permits; the harness constant
`JEV_GATEWAY_MODEL_ID` is the enumerated `typesafe-ai/jev`.

Gateway authentication is `AI_GATEWAY_API_KEY` or Vercel OIDC — the same two variables M1 already
uses for `pnpm example:run`, which is why the live test guards on both.

Resolution failures reuse existing classes: `NoSuchProviderError`, `NoSuchModelError` with
`modelType: 'evaluationModel'`, and `UnsupportedModelVersionError` for a non-v4 model.
"Evaluation never implicitly falls back to Gateway" when a default provider *is* configured.

### What happens when a model cannot answer a kind?

`Experimental_EvaluationUnsupportedQuestionTypeError`, exported from both `ai` and
`@ai-sdk/provider`, carrying `questionId`, `questionType`, `provider` and `modelId`. Two properties
matter to the adapter:

- It is raised **before any provider I/O**. The `evaluate` implementation loops over the questions
  and checks `model.supportedQuestionTypes` before calling `doEvaluate`, which
  `packages/decision-jev`'s test asserts by observing that the mock model was never called.
- **One unsupported question fails the entire call.** There is no partial success and no automatic
  model substitution, and a registry's `fallbackProvider` "does not ... substitute a model when a
  question type is unsupported."

The documented check is the marker-based `Experimental_EvaluationUnsupportedQuestionTypeError.isInstance(error)`,
which works across duplicate package copies. The adapter uses it.

Other failures: `InvalidArgumentError` for bad input, `InvalidResponseDataError` for a malformed or
out-of-range answer (and "invalid answers are not retried"), and the normal retry policy for
transient provider failures.

## Two things the types do not say, read from `dist/index.js`

Both were read from the compiled implementation (lines 14548-14609) because the declaration files
leave them open, and both shape the adapter:

1. **`response.modelId` is defaulted.** The `ai` type says
   `response: NonNullable<...> & { timestamp: Date; modelId: string }` — always present — and the
   implementation shows why: it falls back to the resolved `model.modelId` when the provider omits
   one. The adapter can therefore read `result.response.modelId` unconditionally.
2. **The provider name is not in the result.** Only `model.provider` has it, and a caller who passed
   a *string* never sees the resolved model object. That is why
   `createJevDecisionEngine` records `DEFAULT_STRING_MODEL_PROVIDER` (`"gateway"`) for a string id
   and accepts a `provider` override, rather than guessing from a global the package cannot see.

## Batching

M3-T6 asks for "one shared state to answer several independent questions in one Jev call". The
installed API has exactly that shape and no other: `state` is "one shared state, even when the
value is an array", and the scope section says evaluation "does not stream answers, perform
multilabel classification, or batch unrelated states. Run separate calls for separate states."

So the harness's batching rule is the SDK's: **batch by shared state, never by convenience.** There
is nothing further to design, and nothing to build around.

## Testing without a credential

`ai/test` exports `Experimental_EvaluationMockModelV4`, a class implementing
`Experimental_EvaluationModelV4` whose constructor takes `provider`, `modelId`,
`supportedQuestionTypes` and `doEvaluate`. The guide names it directly: "For tests, use
`Experimental_EvaluationMockModelV4` from `ai/test`."

`packages/decision-jev`'s unit tests use it rather than a hand-written object literal, which means
they exercise the adapter against the same type a real provider satisfies, including the SDK's own
answer validation. The one live test is `*.integration.test.ts`, tagged `live:jev`, and skips with a
printed reason when neither `AI_GATEWAY_API_KEY` nor `VERCEL_OIDC_TOKEN` is set.

## What is harness-owned, because the API does not provide it

| Concern | Why it is not the SDK's |
| --- | --- |
| Question **identity and versioning** (`id@version`) | The SDK's questions are anonymous map entries built per call. Nothing versions a prompt, and a `jev` node has to name one. |
| A single **confidence** number | Established above: no portable measure exists, by the guide's own statement. |
| **Confidence bands** and the three routes | Application-level, and the guide says to choose thresholds "in application code, using labeled data". |
| The **policy** layer | ADR-0009. The SDK has no notion of routing. |
| **Cost** | Not exposed at all; `null` until a provider surfaces one. |
| A **`DecisionId`**, a **state fingerprint** and a persisted result | The SDK returns a value and forgets it. M3-T3 needs evidence. |

## Verified against the installed version on

2026-09-20, with `ai@7.0.107`, `@ai-sdk/provider@4.0.17` and `@ai-sdk/gateway@4.0.87`. A version
bump under ADR-0024 must re-read `32-evaluation.mdx` and the `EvaluationModelV4*` types, because the
guide itself warns that this API "may change in patch releases".
