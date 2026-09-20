import { describe, expect, it } from "vitest";
import {
  type Band,
  type BooleanQuestion,
  bandFor,
  bandForConfidence,
  type ChoiceQuestion,
  type ConfidenceBands,
  type DecisionAnswer,
  type DecisionResult,
  defineConfidenceBands,
  definePolicy,
  defineQuestion,
  defineQuestionSet,
  deriveConfidence,
  policyFingerprint,
  QUESTION_KINDS,
  type ScoreQuestion,
  scoreRange,
} from "./decision.js";
import { ValidationError } from "./errors.js";
import { fingerprint } from "./fingerprint.js";
import { newDecisionId } from "./ids.js";

const BANDS: ConfidenceBands = { auto: 0.95, agentReview: 0.7 };

const LOW_RISK: BooleanQuestion = {
  id: "vendor-triage.obviously-low-risk",
  version: "1.0.0",
  kind: "boolean",
  prompt: "Is this vendor obviously low risk?",
  bands: BANDS,
};

const CATEGORY: ChoiceQuestion = {
  id: "vendor-triage.category",
  version: "1.0.0",
  kind: "choice",
  prompt: "Which vendor category applies?",
  choices: ["software", "services", "hardware"],
  bands: BANDS,
};

const SUFFICIENCY: ScoreQuestion = {
  id: "vendor-triage.evidence-sufficiency",
  version: "1.0.0",
  kind: "score",
  prompt: "How sufficient is the evidence?",
  levels: ["absent", "thin", "adequate", "thorough"],
  bands: BANDS,
};

describe("QUESTION_KINDS", () => {
  it("is the same closed list a `jev` node branches on", () => {
    expect([...QUESTION_KINDS]).toEqual(["boolean", "choice", "score"]);
  });
});

describe("defineQuestion", () => {
  it("returns a valid question, deeply frozen", () => {
    const question = defineQuestion(CATEGORY);

    expect(question).toBe(CATEGORY);
    expect(Object.isFrozen(question)).toBe(true);
    expect(Object.isFrozen(question.choices)).toBe(true);
  });

  it("accepts each of the three kinds", () => {
    expect(() => defineQuestion(LOW_RISK)).not.toThrow();
    expect(() => defineQuestion(CATEGORY)).not.toThrow();
    expect(() => defineQuestion(SUFFICIENCY)).not.toThrow();
  });

  it("rejects an identifier or version that breaks the shared rule", () => {
    expect(() => defineQuestion({ ...LOW_RISK, id: "has space" })).toThrow(ValidationError);
    expect(() => defineQuestion({ ...LOW_RISK, version: "^1.0.0" })).toThrow(ValidationError);
  });

  it("rejects an empty prompt", () => {
    expect(() => defineQuestion({ ...LOW_RISK, prompt: "   " })).toThrow(ValidationError);
  });

  it("rejects a choice question with no options", () => {
    expect(() => defineQuestion({ ...CATEGORY, choices: [] })).toThrow(ValidationError);
  });

  it("rejects a duplicated option, because an answer would be ambiguous", () => {
    let issuePaths: readonly (readonly (string | number)[])[] = [];

    try {
      defineQuestion({ ...CATEGORY, choices: ["software", "software"] });
    } catch (error) {
      issuePaths = (error as ValidationError).issues.map((issue) => issue.path);
    }

    expect(issuePaths).toContainEqual(["choices", 1]);
  });

  it("rejects a description for an option that does not exist", () => {
    expect(() =>
      defineQuestion({ ...CATEGORY, choiceDescriptions: { firmware: "not an option" } }),
    ).toThrow(ValidationError);
  });

  it("rejects a score question with fewer than two levels", () => {
    expect(() => defineQuestion({ ...SUFFICIENCY, levels: ["only"] })).toThrow(ValidationError);
  });

  it("reports every issue at once rather than the first", () => {
    try {
      defineQuestion({ ...CATEGORY, id: "has space", version: "1.0", choices: [] });
      expect.unreachable("expected a ValidationError");
    } catch (error) {
      expect((error as ValidationError).issues).toHaveLength(3);
    }
  });
});

describe("defineQuestionSet", () => {
  it("accepts a set and freezes it", () => {
    const set = defineQuestionSet({ lowRisk: LOW_RISK, category: CATEGORY });

    expect(Object.isFrozen(set)).toBe(true);
    expect(Object.keys(set)).toEqual(["lowRisk", "category"]);
  });

  it("rejects an empty set, because an empty request has no meaning", () => {
    expect(() => defineQuestionSet({})).toThrow(ValidationError);
  });

  it("paths each issue by the set key", () => {
    try {
      defineQuestionSet({ broken: { ...LOW_RISK, id: "has space" } });
      expect.unreachable("expected a ValidationError");
    } catch (error) {
      expect((error as ValidationError).issues[0]?.path).toEqual(["broken", "id"]);
    }
  });
});

describe("scoreRange", () => {
  it("is zero to the last level index", () => {
    expect(scoreRange(SUFFICIENCY)).toEqual({ min: 0, max: 3 });
  });
});

describe("defineConfidenceBands", () => {
  it("accepts an ordered pair and freezes it", () => {
    const bands = defineConfidenceBands({ auto: 0.9, agentReview: 0.6 });

    expect(Object.isFrozen(bands)).toBe(true);
  });

  it("accepts equal thresholds, collapsing the agent-review band", () => {
    const bands = defineConfidenceBands({ auto: 0.8, agentReview: 0.8 });

    expect(bandForConfidence(0.8, bands)).toBe("auto");
    expect(bandForConfidence(0.799, bands)).toBe("human-review");
  });

  it("rejects agentReview above auto, which would make auto unreachable", () => {
    expect(() => defineConfidenceBands({ auto: 0.6, agentReview: 0.9 })).toThrow(ValidationError);
  });

  it("rejects a threshold outside [0, 1]", () => {
    expect(() => defineConfidenceBands({ auto: 1.2, agentReview: 0.5 })).toThrow(ValidationError);
    expect(() => defineConfidenceBands({ auto: 0.9, agentReview: -0.1 })).toThrow(ValidationError);
  });

  it("rejects a non-finite threshold", () => {
    expect(() => defineConfidenceBands({ auto: Number.NaN, agentReview: 0.5 })).toThrow(
      ValidationError,
    );
  });
});

describe("bandForConfidence", () => {
  const cases: readonly (readonly [number | null, Band])[] = [
    [1, "auto"],
    [0.95, "auto"],
    [0.9499999, "agent-review"],
    [0.7, "agent-review"],
    [0.6999999, "human-review"],
    [0, "human-review"],
    [null, "human-review"],
  ];

  for (const [confidence, expected] of cases) {
    it(`maps ${String(confidence)} to ${expected}`, () => {
      expect(bandForConfidence(confidence, BANDS)).toBe(expected);
    });
  }

  it("fails closed on a confidence outside [0, 1]", () => {
    expect(bandForConfidence(1.5, BANDS)).toBe("human-review");
    expect(bandForConfidence(Number.NaN, BANDS)).toBe("human-review");
  });
});

describe("bandFor", () => {
  it("reads the answer's own confidence", () => {
    const answer: DecisionAnswer = {
      questionId: LOW_RISK.id,
      questionVersion: LOW_RISK.version,
      kind: "boolean",
      value: true,
      probabilityTrue: 0.98,
      distribution: { true: 0.98, false: 0.02 },
      confidence: 0.98,
    };

    expect(bandFor(answer, BANDS)).toBe("auto");
  });

  it("escalates an answer with no confidence", () => {
    const answer: DecisionAnswer = {
      questionId: CATEGORY.id,
      questionVersion: CATEGORY.version,
      kind: "choice",
      value: "software",
      distribution: null,
      confidence: null,
    };

    expect(bandFor(answer, BANDS)).toBe("human-review");
  });
});

describe("deriveConfidence", () => {
  it("is the mass on the side a boolean answered", () => {
    const distribution = { true: 0.02, false: 0.98 };

    expect(deriveConfidence({ kind: "boolean", value: false, distribution })).toBe(0.98);
    expect(deriveConfidence({ kind: "boolean", value: true, distribution })).toBe(0.02);
  });

  it("is the chosen option's probability for a choice", () => {
    expect(
      deriveConfidence({
        kind: "choice",
        value: "services",
        distribution: { software: 0.1, services: 0.85, hardware: 0.05 },
      }),
    ).toBe(0.85);
  });

  it("is the mass within half a level of a score", () => {
    // Concentrated on level 2: the score lands there and takes its mass.
    expect(
      deriveConfidence({
        kind: "score",
        value: 2,
        distribution: { 0: 0.02, 1: 0.05, 2: 0.9, 3: 0.03 },
      }),
    ).toBeCloseTo(0.9, 10);
  });

  it("gives a split distribution a low score confidence", () => {
    // Half at each end: the weighted mean is 1.5, and nothing sits near it.
    expect(deriveConfidence({ kind: "score", value: 1.5, distribution: { 0: 0.5, 3: 0.5 } })).toBe(
      0,
    );
  });

  it("includes both levels a score sits exactly between", () => {
    expect(deriveConfidence({ kind: "score", value: 1.5, distribution: { 1: 0.5, 2: 0.5 } })).toBe(
      1,
    );
  });

  it("returns null when there is no distribution", () => {
    expect(deriveConfidence({ kind: "choice", value: "software", distribution: null })).toBeNull();
    expect(deriveConfidence({ kind: "score", value: 1, distribution: null })).toBeNull();
  });

  it("returns null for an empty distribution", () => {
    expect(deriveConfidence({ kind: "choice", value: "software", distribution: {} })).toBeNull();
  });

  it("returns null when the answered key is missing from the distribution", () => {
    expect(
      deriveConfidence({ kind: "choice", value: "firmware", distribution: { software: 1 } }),
    ).toBeNull();
  });

  it("clamps a rounded distribution that sums past one", () => {
    // Both levels sit exactly half a step away, so both count; rounded
    // provider output makes them sum past one, and the contract promises [0, 1].
    const confidence = deriveConfidence({
      kind: "score",
      value: 0.5,
      distribution: { 0: 0.6, 1: 0.6 },
    });

    expect(confidence).toBe(1);
  });
});

/** A result with one boolean answer, built for the policy tests. */
function resultWith(
  confidence: number | null,
  value: boolean,
): DecisionResult<{
  lowRisk: BooleanQuestion;
}> {
  return {
    decisionId: newDecisionId(),
    answers: {
      lowRisk: {
        questionId: LOW_RISK.id,
        questionVersion: LOW_RISK.version,
        kind: "boolean",
        value,
        probabilityTrue: value ? (confidence ?? 0.5) : 1 - (confidence ?? 0.5),
        distribution: confidence === null ? null : { true: 0.5, false: 0.5 },
        confidence,
      },
    },
    stateFingerprint: fingerprint({ vendor: "Northwind Supply" }),
    model: { provider: "gateway", modelId: "typesafe-ai/jev" },
    usage: { inputTokens: 120, outputTokens: 8, totalTokens: 128, costUsd: null },
    latencyMs: 412,
    providerMetadata: null,
    warnings: [],
  };
}

/** The policy both replay tests route with, parameterised by its auto threshold. */
function triagePolicy(version: string, auto: number) {
  return definePolicy<{ lowRisk: BooleanQuestion }, "continue" | "review">({
    id: "vendor-triage.route",
    version,
    thresholds: { auto },
    route(result) {
      const answer = result.answers.lowRisk;

      if (answer.value && (answer.confidence ?? 0) >= auto) {
        return { route: "continue", reasons: [`low risk at ${String(answer.confidence)}`] };
      }

      return { route: "review", reasons: ["not confidently low risk"] };
    },
  });
}

describe("definePolicy", () => {
  it("stamps its own id and version onto every outcome", () => {
    const outcome = triagePolicy("1.0.0", 0.9).evaluate(resultWith(0.97, true));

    expect(outcome).toEqual({
      route: "continue",
      policy: { id: "vendor-triage.route", version: "1.0.0" },
      reasons: ["low risk at 0.97"],
    });
  });

  it("is deterministic: the same result routes the same way every time", () => {
    const policy = triagePolicy("1.0.0", 0.9);
    const result = resultWith(0.97, true);

    expect(policy.evaluate(result)).toEqual(policy.evaluate(result));
  });

  it("rejects an invalid id or version", () => {
    expect(() => triagePolicy("1.0", 0.9)).toThrow(ValidationError);
  });

  it("rejects an outcome with no reason, because it would be unauditable", () => {
    const silent = definePolicy<{ lowRisk: BooleanQuestion }, "continue">({
      id: "silent",
      version: "1.0.0",
      thresholds: {},
      route: () => ({ route: "continue", reasons: [] }),
    });

    expect(() => silent.evaluate(resultWith(1, true))).toThrow(ValidationError);
  });

  it("freezes the thresholds it exposes", () => {
    expect(Object.isFrozen(triagePolicy("1.0.0", 0.9).thresholds)).toBe(true);
  });
});

describe("policy replay (M3 acceptance criterion)", () => {
  it("routes a stored result through a changed threshold without re-evaluating", () => {
    const original = resultWith(0.93, true);

    // The evidence is persisted and read back exactly as M3-T3 will store it.
    const stored: DecisionResult<{ lowRisk: BooleanQuestion }> = JSON.parse(
      JSON.stringify(original),
    );

    expect(stored).toEqual(original);

    const strict = triagePolicy("1.0.0", 0.95).evaluate(stored);
    const relaxed = triagePolicy("2.0.0", 0.9).evaluate(stored);

    expect(strict.route).toBe("review");
    expect(relaxed.route).toBe("continue");
    expect(strict.policy.version).toBe("1.0.0");
    expect(relaxed.policy.version).toBe("2.0.0");
  });

  it("performs no I/O: a policy is a pure function of the result it is handed", () => {
    // The proof is structural rather than mocked: the policy is called with a
    // value parsed from a string, in a test with no engine, no clock and no
    // network, and still produces a complete outcome.
    const fromJson: DecisionResult<{ lowRisk: BooleanQuestion }> = JSON.parse(
      JSON.stringify(resultWith(0.5, false)),
    );

    expect(triagePolicy("1.0.0", 0.9).evaluate(fromJson).route).toBe("review");
  });
});

describe("policyFingerprint", () => {
  it("changes when a threshold changes, even at the same version", () => {
    const a = policyFingerprint(triagePolicy("1.0.0", 0.9));
    const b = policyFingerprint(triagePolicy("1.0.0", 0.95));

    expect(a).not.toBe(b);
    expect(a.startsWith("sha256:")).toBe(true);
  });

  it("is stable for the same policy", () => {
    expect(policyFingerprint(triagePolicy("1.0.0", 0.9))).toBe(
      policyFingerprint(triagePolicy("1.0.0", 0.9)),
    );
  });
});

describe("DecisionResult JSON round trip", () => {
  it("survives JSON.stringify/parse unchanged", () => {
    const result = resultWith(0.81, true);

    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("keeps a null distribution and a null confidence distinguishable from zero", () => {
    const result = resultWith(null, false);
    const roundTripped: DecisionResult<{ lowRisk: BooleanQuestion }> = JSON.parse(
      JSON.stringify(result),
    );

    expect(roundTripped.answers.lowRisk.distribution).toBeNull();
    expect(roundTripped.answers.lowRisk.confidence).toBeNull();
  });
});
