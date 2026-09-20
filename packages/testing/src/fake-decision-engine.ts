import {
  type DecisionAnswer,
  type DecisionEngine,
  DecisionError,
  type DecisionRequest,
  type DecisionResult,
  type DecisionUsage,
  deriveConfidence,
  fingerprint,
  formatCapabilityRef,
  type JsonObject,
  newDecisionId,
  type Question,
  type QuestionSet,
} from "@internal/core";

/**
 * A scripted {@link DecisionEngine} for unit tests.
 *
 * Milestone 3's acceptance criteria require that "decision tests use fake
 * engines by default; live Jev tests are explicitly tagged". This is the
 * default: it implements the same `DecisionEngine` interface
 * `@internal/decision-jev` does and nothing else, so a test that passes with it
 * is a test about the harness rather than about a model provider.
 *
 * It makes no model call, opens no socket and reads no environment variable.
 */

/** One recorded `evaluate` call. */
export interface FakeDecisionEngineCall {
  /** The shared state the engine was asked about. */
  readonly state: unknown;
  /** The questions it was asked, keyed as the caller keyed them. */
  readonly questions: QuestionSet;
}

/**
 * What the script says about one question.
 *
 * A bare value is the shorthand: `true`, `"software"` or `2` answers with that
 * value and no distribution, which means no confidence and therefore the
 * `human-review` band. The object form is what a test that cares about banding
 * uses.
 */
export type ScriptedAnswer =
  | boolean
  | string
  | number
  | {
      /** The answer itself: a boolean, a chosen option or a score. */
      readonly value: boolean | string | number;
      /**
       * The distribution the fake reports. Omitted means `null`, the honest
       * "this provider gave none" case a real engine produces often.
       */
      readonly distribution?: Readonly<Record<string, number>>;
      /**
       * Override the derived confidence. Without it the fake derives one
       * exactly as the real adapter does, so a banding test exercises the real
       * rule rather than a number the test typed in.
       */
      readonly confidence?: number | null;
    };

/**
 * The script: an answer per question, keyed by the question's `id@version` or
 * by its bare `id`.
 *
 * `id@version` wins when both are present, so a test can pin one version of a
 * question and leave a default for the rest.
 */
export type FakeDecisionScript = Readonly<Record<string, ScriptedAnswer>>;

/** The options {@link createFakeDecisionEngine} accepts. */
export interface CreateFakeDecisionEngineOptions {
  /** What to answer, per question. */
  readonly script?: FakeDecisionScript;
  /**
   * Fail every call with this error instead of answering.
   *
   * A non-`DecisionError` is wrapped, because that is what a real adapter does
   * and what makes "a Jev failure escalates safely rather than silently
   * guessing" testable through this fake.
   */
  readonly failWith?: Error;
  /** What `result.model` reports. Defaults to a fake provider and model. */
  readonly model?: { readonly provider: string; readonly modelId: string };
  /** What `result.usage` reports. Defaults to all-null with no cost. */
  readonly usage?: DecisionUsage;
  /** What `result.latencyMs` reports. Defaults to `0`. */
  readonly latencyMs?: number;
  /** What `result.providerMetadata` reports. Defaults to `null`. */
  readonly providerMetadata?: JsonObject | null;
}

/** A {@link DecisionEngine} that also records what it was asked. */
export interface FakeDecisionEngine extends DecisionEngine {
  /** Every `evaluate` call, in order, including ones that failed. */
  readonly calls: readonly FakeDecisionEngineCall[];
}

const DEFAULT_USAGE: DecisionUsage = {
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
  costUsd: null,
};

/** The script entry for `question`, or `undefined` when there is none. */
function lookup(script: FakeDecisionScript, question: Question): ScriptedAnswer | undefined {
  return script[formatCapabilityRef(question)] ?? script[question.id];
}

/** Build one answer from a script entry, deriving confidence the real way. */
function toAnswer(question: Question, scripted: ScriptedAnswer): DecisionAnswer {
  const normalized = typeof scripted === "object" ? scripted : ({ value: scripted } as const);
  const distribution = normalized.distribution ?? null;
  const identity = { questionId: question.id, questionVersion: question.version };

  switch (question.kind) {
    case "boolean": {
      if (typeof normalized.value !== "boolean") {
        throw new DecisionError(
          `createFakeDecisionEngine: question \`${formatCapabilityRef(question)}\` is boolean, but the script answers with \`${typeof normalized.value}\``,
        );
      }

      const value = normalized.value;

      return {
        ...identity,
        kind: "boolean",
        value,
        // A boolean's P(true) is the one field a real provider always supplies,
        // so the fake derives a consistent one rather than leaving a hole.
        probabilityTrue: distribution?.true ?? (value ? 1 : 0),
        distribution,
        confidence:
          normalized.confidence === undefined
            ? deriveConfidence({ kind: "boolean", value, distribution })
            : normalized.confidence,
      };
    }

    case "choice": {
      if (typeof normalized.value !== "string" || !question.choices.includes(normalized.value)) {
        throw new DecisionError(
          `createFakeDecisionEngine: \`${String(normalized.value)}\` is not one of \`${formatCapabilityRef(question)}\`'s choices`,
        );
      }

      const value = normalized.value;

      return {
        ...identity,
        kind: "choice",
        value,
        distribution,
        confidence:
          normalized.confidence === undefined
            ? deriveConfidence({ kind: "choice", value, distribution })
            : normalized.confidence,
      };
    }

    case "score": {
      if (typeof normalized.value !== "number" || !Number.isFinite(normalized.value)) {
        throw new DecisionError(
          `createFakeDecisionEngine: question \`${formatCapabilityRef(question)}\` is a score, but the script answers with \`${typeof normalized.value}\``,
        );
      }

      const value = normalized.value;

      return {
        ...identity,
        kind: "score",
        value,
        distribution,
        confidence:
          normalized.confidence === undefined
            ? deriveConfidence({ kind: "score", value, distribution })
            : normalized.confidence,
      };
    }
  }
}

/**
 * Create a scripted decision engine.
 *
 * ```ts
 * const engine = createFakeDecisionEngine({
 *   script: {
 *     "vendor-triage.category@1.0.0": {
 *       value: "software",
 *       distribution: { software: 0.96, services: 0.03, hardware: 0.01 },
 *     },
 *     "vendor-triage.obviously-low-risk": true,
 *   },
 * });
 * ```
 *
 * @throws {DecisionError} on every call when `failWith` is set, and when a
 * question has no script entry. **An unscripted question is an error, not a
 * default**: a fake that invented an answer would be a silent source of wrong
 * judgments in exactly the tests written to prove the harness does not guess.
 */
export function createFakeDecisionEngine(
  options: CreateFakeDecisionEngineOptions = {},
): FakeDecisionEngine {
  const script = options.script ?? {};
  const calls: FakeDecisionEngineCall[] = [];

  return {
    calls,

    evaluate<TQuestions extends QuestionSet>(
      request: DecisionRequest<TQuestions>,
    ): Promise<DecisionResult<TQuestions>> {
      calls.push({ state: request.state, questions: request.questions });

      if (options.failWith !== undefined) {
        const failure = options.failWith;

        return Promise.reject(
          failure instanceof DecisionError
            ? failure
            : new DecisionError(
                `the fake decision engine was scripted to fail: ${failure.message}`,
                {
                  cause: failure,
                  details: { reason: "scripted-failure" },
                },
              ),
        );
      }

      try {
        const entries = Object.entries(request.questions) as [string, Question][];
        const answers = Object.fromEntries(
          entries.map(([key, question]) => {
            const scripted = lookup(script, question);

            if (scripted === undefined) {
              throw new DecisionError(
                `createFakeDecisionEngine: nothing scripted for \`${formatCapabilityRef(question)}\` (key \`${key}\`)`,
                { details: { questionId: question.id, questionVersion: question.version } },
              );
            }

            return [key, toAnswer(question, scripted)];
          }),
        ) as DecisionResult<TQuestions>["answers"];

        return Promise.resolve({
          decisionId: newDecisionId(),
          answers,
          stateFingerprint: fingerprint(request.state),
          model: options.model ?? { provider: "fake", modelId: "fake-decision-engine" },
          usage: options.usage ?? DEFAULT_USAGE,
          latencyMs: options.latencyMs ?? 0,
          providerMetadata: options.providerMetadata ?? null,
          warnings: [],
        });
      } catch (cause) {
        return Promise.reject(cause);
      }
    },
  };
}
