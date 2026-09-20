/**
 * `JevDecisionEngine` (M3-T2): the harness {@link DecisionEngine} implemented
 * over the AI SDK's experimental evaluation API.
 *
 * **This module is the only place in the harness that may see
 * `experimental_evaluate`.** The build plan says so in as many words —
 * "AI SDK 7 exposes evaluation through the experimental evaluation API. Keep
 * that experimental API isolated inside the adapter package" — and the reason
 * is in the installed docs themselves: "This API and the evaluation model
 * specification are experimental and may change in patch releases." Everything
 * outside this package talks to `@internal/core`'s decision contract, so a
 * patch-level change to the SDK is a change to one file.
 *
 * ## What the installed API actually provides (`ai@7.0.107`)
 *
 * Verified against `node_modules/ai/docs/03-ai-sdk-core/32-evaluation.mdx`,
 * `docs/07-reference/01-ai-sdk-core/14-evaluate.mdx`, `ai/dist/index.d.ts`
 * (lines 7606-7654) and `@ai-sdk/provider@4.0.17`'s
 * `EvaluationModelV4*` types (lines 2254-2340):
 *
 * | Kind | Question fields | Answer |
 * | --- | --- | --- |
 * | `boolean` | `instructions`, optional `criteria.true`/`criteria.false` | **required** `probability` = P(true) |
 * | `choice` | `instructions`, `criteria` map of option to description | `choice`, **optional** `probabilities` |
 * | `score` | `instructions`, `criteria` array of >= 2 ordered levels | `score` in `[0, levels-1]`, **optional** `probabilities` |
 *
 * Three consequences shape this adapter. A distribution is optional for
 * `choice` and `score`, so `DecisionAnswer.distribution` is genuinely nullable
 * and the harness never synthesizes one. A boolean's `probability` "is not
 * confidence in either outcome", so it is carried raw as `probabilityTrue` and
 * converted to confidence by core's `deriveConfidence`. And the API exposes no
 * cost at all, so `usage.costUsd` is always `null` here.
 *
 * ## Model naming
 *
 * `model` is an `Experimental_EvaluationModel`: either a v4 model instance from
 * a provider or a registry, or a string id. A string "resolve[s] through Vercel
 * AI Gateway unless you configure an evaluation-capable default provider", and
 * `@ai-sdk/gateway`'s own `GatewayEvaluationModelId` names Jev exactly once, as
 * `'typesafe-ai/jev'` — which is {@link JEV_GATEWAY_MODEL_ID}. `@ai-sdk/gateway`
 * is not a dependency of this package: `ai` depends on it, and reaching it
 * through a string id is the documented path.
 */

import {
  type DecisionAnswer,
  type DecisionEngine,
  DecisionError,
  type DecisionRequest,
  type DecisionResult,
  type DecisionUsage,
  deriveConfidence,
  fingerprint,
  isJsonObject,
  type JsonObject,
  newDecisionId,
  type Question,
  type QuestionSet,
} from "@internal/core";
import {
  type Experimental_EvaluationModel,
  type Experimental_EvaluationQuestion,
  Experimental_EvaluationUnsupportedQuestionTypeError,
  experimental_evaluate,
} from "ai";

/**
 * The AI Gateway model id for Jev, as `@ai-sdk/gateway@4.0.87`'s
 * `GatewayEvaluationModelId` spells it.
 *
 * Named here so that no caller retypes a provider string, and so that the one
 * place it appears is a package that is allowed to know about the Gateway at
 * all.
 */
export const JEV_GATEWAY_MODEL_ID = "typesafe-ai/jev";

/**
 * The provider recorded for a decision made through a bare model-id string.
 *
 * A string id goes to the Gateway unless the application has installed an
 * evaluation-capable default provider, which is a global the SDK reads and this
 * package cannot see. A caller that has installed one passes
 * {@link CreateJevDecisionEngineOptions.provider} to say so, rather than having
 * this adapter guess from a global.
 */
export const DEFAULT_STRING_MODEL_PROVIDER = "gateway";

/** The options `experimental_evaluate` itself accepts, derived from its signature. */
type EvaluateOptions = Parameters<typeof experimental_evaluate>[0];

/**
 * Provider-specific settings, passed straight through.
 *
 * Derived from the public function's own parameter type rather than named from
 * `@ai-sdk/provider`, which is not a dependency of this package and whose
 * `SharedV4ProviderOptions` the `ai` entry point does not re-export.
 */
export type JevProviderOptions = NonNullable<EvaluateOptions["providerOptions"]>;

/** Extra HTTP headers, passed straight through. */
export type JevHeaders = NonNullable<EvaluateOptions["headers"]>;

/** How to build a {@link createJevDecisionEngine}. */
export interface CreateJevDecisionEngineOptions {
  /**
   * The evaluation model: a v4 instance from a provider or registry, or a model
   * id string such as {@link JEV_GATEWAY_MODEL_ID}.
   */
  readonly model: Experimental_EvaluationModel;
  /**
   * The provider name to record, when `model` is a string.
   *
   * Ignored for a model instance, which carries its own `provider`. Defaults to
   * {@link DEFAULT_STRING_MODEL_PROVIDER}.
   */
  readonly provider?: string;
  /** Retries for transient provider failures. The SDK's own default is 2. */
  readonly maxRetries?: number;
  /** Extra request headers. */
  readonly headers?: JevHeaders;
  /** Provider-specific settings. */
  readonly providerOptions?: JevProviderOptions;
  /**
   * The clock used to measure latency, for tests that need a fixed number.
   * Defaults to `Date.now`.
   */
  readonly now?: () => number;
}

/** A {@link DecisionEngine} with the model it was built for, for inspection. */
export interface JevDecisionEngine extends DecisionEngine {
  /** The provider recorded on every result this engine produces. */
  readonly provider: string;
}

/** Translate one harness question into the SDK's question shape. */
function toSdkQuestion(question: Question): Experimental_EvaluationQuestion {
  switch (question.kind) {
    case "boolean": {
      const criteria = question.criteria;

      // `criteria` is omitted rather than sent empty, because the SDK's boolean
      // criteria are optional per side and an empty object says nothing.
      return criteria === undefined || (criteria.true === undefined && criteria.false === undefined)
        ? { type: "boolean", instructions: question.prompt }
        : {
            type: "boolean",
            instructions: question.prompt,
            criteria: {
              ...(criteria.true === undefined ? {} : { true: criteria.true }),
              ...(criteria.false === undefined ? {} : { false: criteria.false }),
            },
          };
    }

    case "choice": {
      const descriptions = question.choiceDescriptions ?? {};

      return {
        type: "choice",
        instructions: question.prompt,
        // `null` is the SDK's documented "no description", and it is what an
        // undescribed option gets: the alternative would be inventing prose
        // that the model then treats as criteria.
        criteria: Object.fromEntries(
          question.choices.map((choice) => [choice, descriptions[choice] ?? null]),
        ),
      };
    }

    case "score":
      return {
        type: "score",
        instructions: question.prompt,
        criteria: [...question.levels],
      };
  }
}

/** The union of answer shapes `experimental_evaluate` can return for one question. */
type SdkAnswer =
  | { readonly type: "boolean"; readonly probability: number }
  | {
      readonly type: "choice";
      readonly choice: string;
      readonly probabilities?: Record<string, number>;
    }
  | {
      readonly type: "score";
      readonly score: number;
      readonly probabilities?: Record<string, number>;
    };

/**
 * Translate one SDK answer back into the harness's answer shape.
 *
 * The boolean case is the only one that derives anything. `probability` is
 * P(true), so the judgment is `probability >= 0.5` and the distribution is the
 * exact two-point `{ true: p, false: 1 - p }`. That is arithmetic on a number
 * the provider supplied, not the "probability synthesis" the SDK declines to
 * do: nothing is guessed, and the raw number survives as `probabilityTrue`.
 */
function toHarnessAnswer(question: Question, answer: SdkAnswer): DecisionAnswer {
  const identity = { questionId: question.id, questionVersion: question.version };

  switch (answer.type) {
    case "boolean": {
      const probabilityTrue = answer.probability;
      const value = probabilityTrue >= 0.5;
      const distribution = { true: probabilityTrue, false: 1 - probabilityTrue };

      return {
        ...identity,
        kind: "boolean",
        value,
        probabilityTrue,
        distribution,
        confidence: deriveConfidence({ kind: "boolean", value, distribution }),
      };
    }

    case "choice": {
      const distribution = answer.probabilities ?? null;

      return {
        ...identity,
        kind: "choice",
        value: answer.choice,
        distribution,
        confidence: deriveConfidence({ kind: "choice", value: answer.choice, distribution }),
      };
    }

    case "score": {
      const distribution = answer.probabilities ?? null;

      return {
        ...identity,
        kind: "score",
        value: answer.score,
        distribution,
        confidence: deriveConfidence({ kind: "score", value: answer.score, distribution }),
      };
    }
  }
}

/** Render one provider warning as a string, whatever variant it is. */
function formatWarning(warning: unknown): string {
  if (typeof warning === "string") {
    return warning;
  }

  if (!isJsonObject(warning as never)) {
    return String(warning);
  }

  const record = warning as Record<string, unknown>;
  const parts = [record.type, record.feature, record.message, record.details].filter(
    (part): part is string => typeof part === "string" && part !== "",
  );

  return parts.length === 0 ? JSON.stringify(warning) : parts.join(": ");
}

/** The token counts the SDK reports, as the harness records them. */
function toUsage(usage: {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  totalTokens: number | undefined;
}): DecisionUsage {
  return {
    inputTokens: usage.inputTokens ?? null,
    outputTokens: usage.outputTokens ?? null,
    totalTokens: usage.totalTokens ?? null,
    // The evaluation API exposes no cost: `experimental_evaluate`'s result has
    // token counts only, and `EvaluationModelV4Result` has no cost field at all.
    // Estimating one here would put a fabricated number into persisted evidence.
    costUsd: null,
  };
}

/**
 * Turn any failure into a {@link DecisionError} with trace-safe details.
 *
 * The unsupported-question-type case is singled out because it is the one
 * failure the SDK raises **before any provider I/O** and the one whose fields
 * tell an operator exactly what to fix: which question, which kind, which
 * model. The marker-based `isInstance` check is the one the installed error
 * documentation prescribes, precisely because it survives duplicate copies of
 * the package.
 */
function toDecisionError(cause: unknown, details: JsonObject): DecisionError {
  if (Experimental_EvaluationUnsupportedQuestionTypeError.isInstance(cause)) {
    return new DecisionError(
      `the evaluation model cannot answer question \`${cause.questionId}\` of kind \`${cause.questionType}\``,
      {
        cause,
        details: {
          ...details,
          reason: "unsupported-question-kind",
          unsupportedQuestionId: cause.questionId,
          unsupportedQuestionKind: cause.questionType,
          modelProvider: cause.provider,
          modelId: cause.modelId,
        },
      },
    );
  }

  const message = cause instanceof Error ? cause.message : String(cause);

  return new DecisionError(`the evaluation model could not answer: ${message}`, {
    cause,
    details: { ...details, reason: "provider-failure" },
  });
}

/**
 * Create a {@link DecisionEngine} backed by Jev, or by any other evaluation
 * model the AI SDK can resolve.
 *
 * ```ts
 * const engine = createJevDecisionEngine({ model: JEV_GATEWAY_MODEL_ID });
 *
 * const result = await engine.evaluate({
 *   state: { vendor, documents },
 *   questions: { lowRisk, category },
 * });
 * ```
 *
 * **It emits no trace events, deliberately** (ADR-0042). The workflow runtime
 * already opens a `decision.started`/`decision.completed`/`decision.failed`
 * span around a `jev` node, and one `evaluate` call may answer several
 * questions that no single node span describes, so the caller owns the span and
 * the engine owns the answer. A `context` passed in the request is used for
 * cancellation and nothing else.
 *
 * **Every failure is a `DecisionError`.** A provider error, an unsupported
 * question kind, a malformed answer and an abort all leave this function as one
 * error type carrying trace-safe details, so a caller's only options are to
 * escalate or to fail — never to proceed with an invented answer.
 */
export function createJevDecisionEngine(
  options: CreateJevDecisionEngineOptions,
): JevDecisionEngine {
  const { model, maxRetries, headers, providerOptions } = options;
  const now = options.now ?? Date.now;
  const provider =
    options.provider ??
    (typeof model === "string" ? DEFAULT_STRING_MODEL_PROVIDER : model.provider);
  const requestedModelId = typeof model === "string" ? model : model.modelId;

  return {
    provider,

    async evaluate<TQuestions extends QuestionSet>(
      request: DecisionRequest<TQuestions>,
    ): Promise<DecisionResult<TQuestions>> {
      const entries = Object.entries(request.questions) as [string, Question][];
      const details: JsonObject = {
        modelProvider: provider,
        modelId: requestedModelId,
        questions: entries.map(([key, question]) => `${key}:${question.id}@${question.version}`),
      };

      if (entries.length === 0) {
        throw new DecisionError(
          "a decision request must carry at least one question; the evaluation API rejects an empty question map",
          { details },
        );
      }

      const sdkQuestions: Record<string, Experimental_EvaluationQuestion> = Object.fromEntries(
        entries.map(([key, question]) => [key, toSdkQuestion(question)]),
      );

      // Both signals matter and neither subsumes the other: the request's own
      // signal is the caller's, the context's is the run's, and either aborting
      // must abort the call.
      const signals = [request.signal, request.context?.signal].filter(
        (signal): signal is AbortSignal => signal !== undefined,
      );
      const abortSignal =
        signals.length === 0
          ? undefined
          : signals.length === 1
            ? signals[0]
            : AbortSignal.any(signals);

      const startedAt = now();

      try {
        const evaluation = await experimental_evaluate({
          model,
          // `state` is the one shared state every question is asked about, and
          // an array is "one state, not a batch of unrelated inputs" (M3-T6).
          state: request.state as EvaluateOptions["state"],
          questions: sdkQuestions,
          ...(maxRetries === undefined ? {} : { maxRetries }),
          ...(abortSignal === undefined ? {} : { abortSignal }),
          ...(headers === undefined ? {} : { headers }),
          ...(providerOptions === undefined ? {} : { providerOptions }),
        });

        const latencyMs = now() - startedAt;
        const answers = Object.fromEntries(
          entries.map(([key, question]) => [
            key,
            toHarnessAnswer(question, evaluation.answers[key] as SdkAnswer),
          ]),
        ) as DecisionResult<TQuestions>["answers"];

        const metadata: unknown = evaluation.providerMetadata;

        return {
          decisionId: newDecisionId(),
          answers,
          stateFingerprint: fingerprint(request.state),
          model: { provider, modelId: evaluation.response.modelId },
          usage: toUsage(evaluation.usage),
          latencyMs,
          providerMetadata: isJsonObject(metadata) ? metadata : null,
          warnings: evaluation.warnings.map(formatWarning),
        };
      } catch (cause) {
        throw toDecisionError(cause, { ...details, latencyMs: now() - startedAt });
      }
    },
  };
}
