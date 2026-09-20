import { describe, expect, it } from "vitest";
import type { DecisionResult, QuestionSet } from "./decision.js";
import { ValidationError } from "./errors.js";
import { fingerprint } from "./fingerprint.js";
import { newDecisionId } from "./ids.js";
import type { JsonValue } from "./json.js";
import { type CompiledVerification, compileVerification, readVerification } from "./verify.js";

/**
 * The `verify` primitive (M3-T7).
 *
 * The cases below stand behind Milestone 3's acceptance criterion
 * "verification can identify a deliberately unsupported field": the output has
 * one field the evidence carries and one it plainly does not, and the reading
 * separates them and produces an instruction the same task can be re-run with.
 *
 * **No engine is constructed here.** `compileVerification()` produces
 * questions and `readVerification()` reads answers, and a hand-built
 * `DecisionResult` is a legitimate argument for the second — which is the point
 * of keeping both halves engine-agnostic in core.
 */

const EVIDENCE = [
  {
    source: "vendor website, /security",
    text: "We hold a SOC 2 Type II report, renewed annually.",
  },
];

const OUTPUT = {
  category: "bookkeeping software",
  recommendation: { decision: "proceed", rationale: "The SOC 2 Type II report is on file." },
  riskFlags: [] as JsonValue[],
};

/** Build one boolean answer for a compiled field, keyed as the set keys it. */
function answer(
  key: string,
  value: boolean,
  probabilityTrue: number,
): [string, Record<string, unknown>] {
  const trueMass = probabilityTrue;

  return [
    key,
    {
      questionId: `verify.${key.replace(/[^A-Za-z0-9._-]/gu, "-")}`,
      questionVersion: "1.0.0",
      kind: "boolean",
      value,
      probabilityTrue,
      distribution: { true: trueMass, false: 1 - trueMass },
      // The harness's own rule: the mass on the side answered.
      confidence: value ? trueMass : 1 - trueMass,
    },
  ];
}

function resultFor(
  compiled: CompiledVerification,
  answers: readonly [string, Record<string, unknown>][],
): DecisionResult<QuestionSet> {
  const decisionId = newDecisionId();

  return {
    decisionId,
    answers: Object.fromEntries(answers),
    stateFingerprint: fingerprint(compiled.state),
    model: { provider: "fake", modelId: "fake-decision-engine" },
    usage: { inputTokens: null, outputTokens: null, totalTokens: null, costUsd: null },
    latencyMs: 3,
    providerMetadata: null,
    warnings: [],
  } as unknown as DecisionResult<QuestionSet>;
}

describe("compileVerification", () => {
  it("compiles one boolean question per configured field, over one shared state", () => {
    const compiled = compileVerification({
      output: OUTPUT,
      outputSchema: "vendor-triage.output@1.0.0",
      evidence: EVIDENCE,
      fields: [{ path: ["category"] }, { path: ["recommendation", "decision"] }],
    });

    expect(Object.keys(compiled.questions)).toEqual(["category", "recommendation.decision"]);
    expect(Object.values(compiled.questions).every((one) => one.kind === "boolean")).toBe(true);
    // One state, which is what makes the whole batch one engine call (M3-T6).
    expect(compiled.state).toEqual({
      evidence: EVIDENCE,
      output: OUTPUT,
      outputSchema: "vendor-triage.output@1.0.0",
    });
  });

  it("quotes the field and its value in the generated prompt", () => {
    const compiled = compileVerification({
      output: OUTPUT,
      evidence: EVIDENCE,
      fields: [{ path: ["recommendation", "decision"] }],
    });

    expect(compiled.questions["recommendation.decision"]?.prompt).toBe(
      "Is `recommendation.decision` = `proceed` supported by the evidence?",
    );
  });

  it("uses a caller's own wording when one is given", () => {
    const compiled = compileVerification({
      output: OUTPUT,
      evidence: EVIDENCE,
      fields: [
        { path: ["recommendation", "decision"], question: "Is recommending `proceed` justified?" },
      ],
    });

    expect(compiled.questions["recommendation.decision"]?.prompt).toBe(
      "Is recommending `proceed` justified?",
    );
  });

  it("still asks about a field the output does not carry", () => {
    // Dropping it would make a missing required field indistinguishable from a
    // supported one, which is exactly the failure verification exists to find.
    const compiled = compileVerification({
      output: OUTPUT,
      evidence: EVIDENCE,
      fields: [{ path: ["missingInformation"] }],
    });

    expect(compiled.fields[0]?.present).toBe(false);
    expect(compiled.questions.missingInformation?.prompt).toContain("does not contain");
  });

  it("reads an array index out of a path", () => {
    const compiled = compileVerification({
      output: { evidence: [{ source: "a" }, { source: "b" }] },
      evidence: EVIDENCE,
      fields: [{ path: ["evidence", "1", "source"] }],
    });

    expect(compiled.fields[0]?.value).toBe("b");
    expect(compiled.fields[0]?.present).toBe(true);
  });

  it("carries a field's own bands onto its question", () => {
    const compiled = compileVerification({
      output: OUTPUT,
      evidence: EVIDENCE,
      fields: [{ path: ["category"], bands: { auto: 0.9, agentReview: 0.7 } }],
    });

    expect(compiled.questions.category?.bands).toEqual({ auto: 0.9, agentReview: 0.7 });
  });

  it("rejects an empty field list, an empty path and a duplicate path", () => {
    expect(() => compileVerification({ output: OUTPUT, evidence: EVIDENCE, fields: [] })).toThrow(
      ValidationError,
    );

    expect(() =>
      compileVerification({ output: OUTPUT, evidence: EVIDENCE, fields: [{ path: [] }] }),
    ).toThrow(ValidationError);

    expect(() =>
      compileVerification({
        output: OUTPUT,
        evidence: EVIDENCE,
        fields: [{ path: ["category"] }, { path: ["category"] }],
      }),
    ).toThrow(ValidationError);
  });

  it("rejects a question version that is not exact", () => {
    expect(() =>
      compileVerification({
        output: OUTPUT,
        evidence: EVIDENCE,
        fields: [{ path: ["category"] }],
        questionVersion: "^1.0.0",
      }),
    ).toThrow(ValidationError);
  });
});

describe("readVerification", () => {
  it("identifies a deliberately unsupported field and leaves the supported one alone", () => {
    // The acceptance criterion. `category` is carried by the evidence;
    // `recommendation.rationale` claims something the evidence does not say,
    // and the answer says so.
    const compiled = compileVerification({
      output: { ...OUTPUT, recommendation: { decision: "proceed", rationale: "Audited in 2019." } },
      evidence: EVIDENCE,
      fields: [{ path: ["category"] }, { path: ["recommendation", "rationale"] }],
    });

    const reading = readVerification(
      resultFor(compiled, [
        answer("category", true, 0.95),
        answer("recommendation.rationale", false, 0.04),
      ]),
      compiled.fields,
    );

    expect(reading.supported.map((field) => field.pathText)).toEqual(["category"]);
    expect(reading.unsupported.map((field) => field.pathText)).toEqual([
      "recommendation.rationale",
    ]);
    expect(reading.unsupported[0]?.repair).toBe(
      "The field `recommendation.rationale` (`Audited in 2019.`) is not supported by the evidence; cite a source that establishes it, or remove it.",
    );
    expect(reading.repairInstructions).toEqual([reading.unsupported[0]?.repair]);
  });

  it("carries the confidence of a false answer as the mass on the side answered", () => {
    const compiled = compileVerification({
      output: OUTPUT,
      evidence: EVIDENCE,
      fields: [{ path: ["category"] }],
    });

    const reading = readVerification(
      resultFor(compiled, [answer("category", false, 0.04)]),
      compiled.fields,
    );

    // 0.96, not 0.04: a confident `no` is a confident answer.
    expect(reading.unsupported[0]?.confidence).toBeCloseTo(0.96, 10);
  });

  it("applies the field's bands: a weakly supported `true` is not support", () => {
    const compiled = compileVerification({
      output: OUTPUT,
      evidence: EVIDENCE,
      fields: [{ path: ["category"], bands: { auto: 0.9, agentReview: 0.6 } }],
    });

    const weak = readVerification(
      resultFor(compiled, [answer("category", true, 0.7)]),
      compiled.fields,
    );

    expect(weak.supported).toEqual([]);
    expect(weak.unsupported[0]?.band).toBe("agent-review");
    expect(weak.unsupported[0]?.repair).toContain("only weakly supported");

    const strong = readVerification(
      resultFor(compiled, [answer("category", true, 0.95)]),
      compiled.fields,
    );

    expect(strong.supported.map((field) => field.pathText)).toEqual(["category"]);
    expect(strong.unsupported).toEqual([]);
  });

  it("judges an unbanded field by its answer alone, and says so with a null band", () => {
    const compiled = compileVerification({
      output: OUTPUT,
      evidence: EVIDENCE,
      fields: [{ path: ["category"] }],
    });

    const reading = readVerification(
      resultFor(compiled, [answer("category", true, 0.51)]),
      compiled.fields,
    );

    expect(reading.supported).toHaveLength(1);
    expect(reading.unsupported).toEqual([]);
  });

  it("asks a missing field to be produced, not cited", () => {
    const compiled = compileVerification({
      output: OUTPUT,
      evidence: EVIDENCE,
      fields: [{ path: ["missingInformation"] }],
    });

    const reading = readVerification(
      resultFor(compiled, [answer("missingInformation", false, 0.1)]),
      compiled.fields,
    );

    expect(reading.unsupported[0]?.repair).toContain("is missing from the output");
    expect(reading.unsupported[0]?.band).toBeNull();
  });

  it("refuses a result that has no answer for a field", () => {
    const compiled = compileVerification({
      output: OUTPUT,
      evidence: EVIDENCE,
      fields: [{ path: ["category"] }, { path: ["riskFlags"] }],
    });

    expect(() =>
      readVerification(resultFor(compiled, [answer("category", true, 0.95)]), compiled.fields),
    ).toThrow(ValidationError);
  });

  it("refuses an answer of the wrong kind", () => {
    const compiled = compileVerification({
      output: OUTPUT,
      evidence: EVIDENCE,
      fields: [{ path: ["category"] }],
    });

    const result = resultFor(compiled, [
      [
        "category",
        {
          questionId: "verify.category",
          questionVersion: "1.0.0",
          kind: "choice",
          value: "yes",
          distribution: null,
          confidence: null,
        },
      ],
    ]);

    expect(() => readVerification(result, compiled.fields)).toThrow(ValidationError);
  });
});
