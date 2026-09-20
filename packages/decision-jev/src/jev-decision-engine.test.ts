import {
  type BooleanQuestion,
  type ChoiceQuestion,
  DecisionError,
  defineQuestion,
  fingerprint,
  isEntityId,
  type ScoreQuestion,
} from "@internal/core";
import { Experimental_EvaluationMockModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import {
  createJevDecisionEngine,
  DEFAULT_STRING_MODEL_PROVIDER,
  JEV_GATEWAY_MODEL_ID,
} from "./jev-decision-engine.js";

/**
 * Every test drives `Experimental_EvaluationMockModelV4`, the double the
 * installed `ai` package ships from `ai/test`. Nothing here reaches a network,
 * and the double satisfies the same `Experimental_EvaluationModelV4` type a
 * real provider does, so the adapter is exercised against the real contract
 * rather than against a hand-written approximation of it.
 */

type DoEvaluate = ConstructorParameters<typeof Experimental_EvaluationMockModelV4>[0] extends
  | { doEvaluate?: infer T }
  | undefined
  ? NonNullable<T>
  : never;

// The SDK logs provider warnings to `stderr` through its own logger. One test
// below deliberately produces a warning, so the logger is turned off here to
// keep the suite's output clean; the warnings themselves are still asserted on
// through the result.
(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;

const LOW_RISK = defineQuestion<BooleanQuestion>({
  id: "vendor-triage.obviously-low-risk",
  version: "1.0.0",
  kind: "boolean",
  prompt: "Is this vendor obviously low risk?",
  criteria: { true: "No unresolved red flags.", false: "Anything unresolved." },
  bands: { auto: 0.95, agentReview: 0.7 },
});

const CATEGORY = defineQuestion<ChoiceQuestion>({
  id: "vendor-triage.category",
  version: "1.0.0",
  kind: "choice",
  prompt: "Which vendor category applies?",
  choices: ["software", "services", "hardware"],
  choiceDescriptions: { software: "Licensed or hosted software." },
});

const SUFFICIENCY = defineQuestion<ScoreQuestion>({
  id: "vendor-triage.evidence-sufficiency",
  version: "1.0.0",
  kind: "score",
  prompt: "How sufficient is the evidence?",
  levels: ["absent", "thin", "adequate", "thorough"],
});

const STATE = { vendorName: "Northwind Supply", documents: ["soc2", "dpa"] };

/** A mock model that answers with `answers` and records what it was asked. */
function mockModel(
  answers: Record<string, unknown>,
  overrides: {
    readonly supportedQuestionTypes?: ("boolean" | "choice" | "score")[];
    readonly extra?: Record<string, unknown>;
  } = {},
) {
  const calls: Parameters<DoEvaluate>[0][] = [];
  const model = new Experimental_EvaluationMockModelV4({
    provider: "typesafe-ai",
    modelId: "jev",
    supportedQuestionTypes: overrides.supportedQuestionTypes ?? ["boolean", "choice", "score"],
    doEvaluate: (options) => {
      calls.push(options);

      return Promise.resolve({
        answers,
        warnings: [],
        ...overrides.extra,
      } as Awaited<ReturnType<DoEvaluate>>);
    },
  });

  return { model, calls };
}

describe("JEV_GATEWAY_MODEL_ID", () => {
  it("is the id `@ai-sdk/gateway` declares for Jev", () => {
    expect(JEV_GATEWAY_MODEL_ID).toBe("typesafe-ai/jev");
  });
});

describe("createJevDecisionEngine question mapping", () => {
  it("maps a boolean question to the SDK's boolean shape with its criteria", async () => {
    const { model, calls } = mockModel({ lowRisk: { type: "boolean", probability: 0.97 } });

    await createJevDecisionEngine({ model }).evaluate({
      state: STATE,
      questions: { lowRisk: LOW_RISK },
    });

    expect(calls[0]?.questions.lowRisk).toEqual({
      type: "boolean",
      instructions: "Is this vendor obviously low risk?",
      criteria: { true: "No unresolved red flags.", false: "Anything unresolved." },
    });
  });

  it("omits boolean criteria entirely when the question declares none", async () => {
    const { criteria: _criteria, ...withoutCriteria } = LOW_RISK;
    const bare = defineQuestion<BooleanQuestion>(withoutCriteria);
    const { model, calls } = mockModel({ lowRisk: { type: "boolean", probability: 0.5 } });

    await createJevDecisionEngine({ model }).evaluate({
      state: STATE,
      questions: { lowRisk: bare },
    });

    expect(calls[0]?.questions.lowRisk).toEqual({
      type: "boolean",
      instructions: bare.prompt,
    });
  });

  it("maps choices to a criteria map, with null for an undescribed option", async () => {
    const { model, calls } = mockModel({ category: { type: "choice", choice: "software" } });

    await createJevDecisionEngine({ model }).evaluate({
      state: STATE,
      questions: { category: CATEGORY },
    });

    expect(calls[0]?.questions.category).toEqual({
      type: "choice",
      instructions: "Which vendor category applies?",
      criteria: {
        software: "Licensed or hosted software.",
        services: null,
        hardware: null,
      },
    });
  });

  it("maps score levels to the SDK's ordered criteria array", async () => {
    const { model, calls } = mockModel({ sufficiency: { type: "score", score: 2 } });

    await createJevDecisionEngine({ model }).evaluate({
      state: STATE,
      questions: { sufficiency: SUFFICIENCY },
    });

    expect(calls[0]?.questions.sufficiency).toEqual({
      type: "score",
      instructions: "How sufficient is the evidence?",
      criteria: ["absent", "thin", "adequate", "thorough"],
    });
  });

  it("passes the shared state through unchanged", async () => {
    const { model, calls } = mockModel({ lowRisk: { type: "boolean", probability: 0.9 } });

    await createJevDecisionEngine({ model }).evaluate({
      state: STATE,
      questions: { lowRisk: LOW_RISK },
    });

    expect(calls[0]?.state).toEqual(STATE);
  });
});

describe("createJevDecisionEngine answer mapping", () => {
  it("turns P(true) into a judgment, an exact two-point distribution and a confidence", async () => {
    const { model } = mockModel({ lowRisk: { type: "boolean", probability: 0.97 } });

    const result = await createJevDecisionEngine({ model }).evaluate({
      state: STATE,
      questions: { lowRisk: LOW_RISK },
    });

    expect(result.answers.lowRisk).toEqual({
      questionId: LOW_RISK.id,
      questionVersion: LOW_RISK.version,
      kind: "boolean",
      value: true,
      probabilityTrue: 0.97,
      distribution: { true: 0.97, false: expect.closeTo(0.03, 10) },
      confidence: 0.97,
    });
  });

  it("reads a low P(true) as a confident `false`, not as low confidence", async () => {
    const { model } = mockModel({ lowRisk: { type: "boolean", probability: 0.02 } });

    const result = await createJevDecisionEngine({ model }).evaluate({
      state: STATE,
      questions: { lowRisk: LOW_RISK },
    });

    expect(result.answers.lowRisk.value).toBe(false);
    expect(result.answers.lowRisk.probabilityTrue).toBe(0.02);
    expect(result.answers.lowRisk.confidence).toBeCloseTo(0.98, 10);
  });

  it("carries a choice distribution when the provider supplies one", async () => {
    const { model } = mockModel({
      category: {
        type: "choice",
        choice: "services",
        probabilities: { software: 0.1, services: 0.85, hardware: 0.05 },
      },
    });

    const result = await createJevDecisionEngine({ model }).evaluate({
      state: STATE,
      questions: { category: CATEGORY },
    });

    expect(result.answers.category.value).toBe("services");
    expect(result.answers.category.distribution).toEqual({
      software: 0.1,
      services: 0.85,
      hardware: 0.05,
    });
    expect(result.answers.category.confidence).toBe(0.85);
  });

  it("records a missing choice distribution as null rather than inventing one", async () => {
    const { model } = mockModel({ category: { type: "choice", choice: "hardware" } });

    const result = await createJevDecisionEngine({ model }).evaluate({
      state: STATE,
      questions: { category: CATEGORY },
    });

    expect(result.answers.category.distribution).toBeNull();
    expect(result.answers.category.confidence).toBeNull();
  });

  it("carries a score and its level-indexed distribution", async () => {
    const { model } = mockModel({
      sufficiency: {
        type: "score",
        score: 2,
        probabilities: { 0: 0, 1: 0.05, 2: 0.9, 3: 0.05 },
      },
    });

    const result = await createJevDecisionEngine({ model }).evaluate({
      state: STATE,
      questions: { sufficiency: SUFFICIENCY },
    });

    expect(result.answers.sufficiency.value).toBe(2);
    expect(result.answers.sufficiency.confidence).toBeCloseTo(0.9, 10);
  });
});

describe("createJevDecisionEngine batching (M3-T6)", () => {
  it("answers three independent questions from one shared state in one call", async () => {
    const { model, calls } = mockModel({
      lowRisk: { type: "boolean", probability: 0.96 },
      category: {
        type: "choice",
        choice: "software",
        probabilities: { software: 0.8, services: 0.15, hardware: 0.05 },
      },
      // The SDK validates that a score equals its distribution's weighted mean:
      // 2 * 0.2 + 3 * 0.8 = 2.8.
      sufficiency: { type: "score", score: 2.8, probabilities: { 0: 0, 1: 0, 2: 0.2, 3: 0.8 } },
    });

    const result = await createJevDecisionEngine({ model }).evaluate({
      state: STATE,
      questions: { lowRisk: LOW_RISK, category: CATEGORY, sufficiency: SUFFICIENCY },
    });

    expect(calls).toHaveLength(1);
    expect(Object.keys(result.answers)).toEqual(["lowRisk", "category", "sufficiency"]);
    expect(result.answers.lowRisk.kind).toBe("boolean");
    expect(result.answers.category.kind).toBe("choice");
    expect(result.answers.sufficiency.kind).toBe("score");
  });

  it("keys answers by the request's own keys, not by question id", async () => {
    const { model } = mockModel({
      first: { type: "boolean", probability: 0.9 },
      second: { type: "boolean", probability: 0.1 },
    });

    const result = await createJevDecisionEngine({ model }).evaluate({
      state: STATE,
      questions: { first: LOW_RISK, second: LOW_RISK },
    });

    expect(result.answers.first.value).toBe(true);
    expect(result.answers.second.value).toBe(false);
    expect(result.answers.first.questionId).toBe(LOW_RISK.id);
  });

  it("rejects an empty question set before touching the provider", async () => {
    const { model, calls } = mockModel({});

    await expect(
      createJevDecisionEngine({ model }).evaluate({ state: STATE, questions: {} }),
    ).rejects.toBeInstanceOf(DecisionError);
    expect(calls).toHaveLength(0);
  });
});

describe("createJevDecisionEngine result envelope", () => {
  it("records the decision id, state fingerprint, model, usage and latency", async () => {
    const { model } = mockModel(
      { lowRisk: { type: "boolean", probability: 0.9 } },
      { extra: { usage: { inputTokens: 120, outputTokens: 8 } } },
    );
    const now = vi.fn<() => number>().mockReturnValueOnce(1_000).mockReturnValueOnce(1_412);

    const result = await createJevDecisionEngine({ model, now }).evaluate({
      state: STATE,
      questions: { lowRisk: LOW_RISK },
    });

    expect(isEntityId(result.decisionId)).toBe(true);
    expect(result.stateFingerprint).toBe(fingerprint(STATE));
    expect(result.model).toEqual({ provider: "typesafe-ai", modelId: "jev" });
    expect(result.usage).toEqual({
      inputTokens: 120,
      outputTokens: 8,
      totalTokens: 128,
      costUsd: null,
    });
    expect(result.latencyMs).toBe(412);
  });

  it("reports no cost, because the evaluation API exposes none", async () => {
    const { model } = mockModel(
      { lowRisk: { type: "boolean", probability: 0.9 } },
      { extra: { usage: { inputTokens: 10, outputTokens: 2 } } },
    );

    const result = await createJevDecisionEngine({ model }).evaluate({
      state: STATE,
      questions: { lowRisk: LOW_RISK },
    });

    expect(result.usage.costUsd).toBeNull();
  });

  it("leaves unreported token counts null rather than zero", async () => {
    const { model } = mockModel({ lowRisk: { type: "boolean", probability: 0.9 } });

    const result = await createJevDecisionEngine({ model }).evaluate({
      state: STATE,
      questions: { lowRisk: LOW_RISK },
    });

    expect(result.usage).toEqual({
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      costUsd: null,
    });
  });

  it("carries provider metadata verbatim", async () => {
    const { model } = mockModel(
      { category: { type: "choice", choice: "software" } },
      { extra: { providerMetadata: { typesafe: { confidence: { category: 0.71 } } } } },
    );

    const result = await createJevDecisionEngine({ model }).evaluate({
      state: STATE,
      questions: { category: CATEGORY },
    });

    expect(result.providerMetadata).toEqual({ typesafe: { confidence: { category: 0.71 } } });
    // The provider's own statistic is recorded but not adopted as confidence:
    // the installed guide says it "is not ... a portable confidence measure".
    expect(result.answers.category.confidence).toBeNull();
  });

  it("renders provider warnings as strings", async () => {
    const { model } = mockModel(
      { lowRisk: { type: "boolean", probability: 0.9 } },
      { extra: { warnings: [{ type: "unsupported", feature: "rounding" }] } },
    );

    const result = await createJevDecisionEngine({ model }).evaluate({
      state: STATE,
      questions: { lowRisk: LOW_RISK },
    });

    expect(result.warnings).toEqual(["unsupported: rounding"]);
  });

  it("produces a result that survives a JSON round trip", async () => {
    const { model } = mockModel({
      lowRisk: { type: "boolean", probability: 0.9 },
      category: { type: "choice", choice: "software" },
    });

    const result = await createJevDecisionEngine({ model }).evaluate({
      state: STATE,
      questions: { lowRisk: LOW_RISK, category: CATEGORY },
    });

    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("records `gateway` as the provider for a bare model-id string", () => {
    expect(createJevDecisionEngine({ model: JEV_GATEWAY_MODEL_ID }).provider).toBe(
      DEFAULT_STRING_MODEL_PROVIDER,
    );
  });

  it("lets a caller override the provider it records", () => {
    expect(createJevDecisionEngine({ model: "jev-latest", provider: "typesafe-ai" }).provider).toBe(
      "typesafe-ai",
    );
  });
});

describe("createJevDecisionEngine failure semantics", () => {
  it("wraps an unsupported question kind in a DecisionError with the offending fields", async () => {
    const { model, calls } = mockModel(
      { sufficiency: { type: "score", score: 1 } },
      { supportedQuestionTypes: ["boolean"] },
    );

    const error = await createJevDecisionEngine({ model })
      .evaluate({ state: STATE, questions: { sufficiency: SUFFICIENCY } })
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(DecisionError);
    expect((error as DecisionError).details).toMatchObject({
      reason: "unsupported-question-kind",
      unsupportedQuestionId: "sufficiency",
      unsupportedQuestionKind: "score",
      modelProvider: "typesafe-ai",
      modelId: "jev",
    });
    // The SDK checks `supportedQuestionTypes` before provider I/O, so nothing
    // was asked.
    expect(calls).toHaveLength(0);
  });

  it("wraps a provider failure in a DecisionError rather than guessing an answer", async () => {
    const model = new Experimental_EvaluationMockModelV4({
      provider: "typesafe-ai",
      modelId: "jev",
      supportedQuestionTypes: ["boolean"],
      doEvaluate: () => Promise.reject(new Error("gateway unavailable")),
    });

    const error = await createJevDecisionEngine({ model, maxRetries: 0 })
      .evaluate({ state: STATE, questions: { lowRisk: LOW_RISK } })
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(DecisionError);
    expect((error as DecisionError).message).toContain("gateway unavailable");
    expect((error as DecisionError).details).toMatchObject({ reason: "provider-failure" });
  });

  it("serializes to a trace-safe shape with no stack", async () => {
    const model = new Experimental_EvaluationMockModelV4({
      provider: "typesafe-ai",
      modelId: "jev",
      supportedQuestionTypes: ["boolean"],
      doEvaluate: () => Promise.reject(new Error("boom")),
    });

    const error = (await createJevDecisionEngine({ model, maxRetries: 0 })
      .evaluate({ state: STATE, questions: { lowRisk: LOW_RISK } })
      .catch((cause: unknown) => cause)) as DecisionError;

    const serialized = JSON.parse(JSON.stringify(error.toJSON()));

    expect(serialized.code).toBe("DECISION");
    expect(JSON.stringify(serialized)).not.toContain("jev-decision-engine.ts");
  });

  it("wraps a malformed provider answer rather than passing it on", async () => {
    // A choice the question does not offer: the SDK validates answers and
    // throws `InvalidResponseDataError`, which must not reach the caller raw.
    const { model } = mockModel({ category: { type: "choice", choice: "firmware" } });

    const error = await createJevDecisionEngine({ model, maxRetries: 0 })
      .evaluate({ state: STATE, questions: { category: CATEGORY } })
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(DecisionError);
  });

  it("aborts through the request signal", async () => {
    const controller = new AbortController();
    const model = new Experimental_EvaluationMockModelV4({
      provider: "typesafe-ai",
      modelId: "jev",
      supportedQuestionTypes: ["boolean"],
      doEvaluate: () => {
        // Abort mid-flight, then answer anyway: `experimental_evaluate` checks
        // the signal again after `doEvaluate` resolves, so a late answer to a
        // cancelled call is discarded rather than returned.
        controller.abort();

        return Promise.resolve({
          answers: { lowRisk: { type: "boolean" as const, probability: 0.9 } },
          warnings: [],
        });
      },
    });

    const pending = createJevDecisionEngine({ model, maxRetries: 0 }).evaluate({
      state: STATE,
      questions: { lowRisk: LOW_RISK },
      signal: controller.signal,
    });

    await expect(pending).rejects.toBeInstanceOf(DecisionError);
  });

  it("aborts when a signal is already aborted before the call", async () => {
    const { model, calls } = mockModel({ lowRisk: { type: "boolean", probability: 0.9 } });

    await expect(
      createJevDecisionEngine({ model, maxRetries: 0 }).evaluate({
        state: STATE,
        questions: { lowRisk: LOW_RISK },
        signal: AbortSignal.abort(),
      }),
    ).rejects.toBeInstanceOf(DecisionError);
    expect(calls).toHaveLength(0);
  });
});
