import {
  type BooleanQuestion,
  bandFor,
  type ChoiceQuestion,
  DecisionError,
  defineQuestion,
  fingerprint,
  type ScoreQuestion,
} from "@internal/core";
import { describe, expect, it } from "vitest";
import { createFakeDecisionEngine } from "./fake-decision-engine.js";

const LOW_RISK = defineQuestion<BooleanQuestion>({
  id: "vendor-triage.obviously-low-risk",
  version: "1.0.0",
  kind: "boolean",
  prompt: "Is this vendor obviously low risk?",
  bands: { auto: 0.95, agentReview: 0.7 },
});

const CATEGORY = defineQuestion<ChoiceQuestion>({
  id: "vendor-triage.category",
  version: "1.0.0",
  kind: "choice",
  prompt: "Which vendor category applies?",
  choices: ["software", "services", "hardware"],
  bands: { auto: 0.95, agentReview: 0.7 },
});

const SUFFICIENCY = defineQuestion<ScoreQuestion>({
  id: "vendor-triage.evidence-sufficiency",
  version: "1.0.0",
  kind: "score",
  prompt: "How sufficient is the evidence?",
  levels: ["absent", "thin", "adequate", "thorough"],
});

const STATE = { vendorName: "Northwind Supply" };

describe("createFakeDecisionEngine", () => {
  it("answers each kind from its shorthand script entry", async () => {
    const engine = createFakeDecisionEngine({
      script: {
        "vendor-triage.obviously-low-risk": true,
        "vendor-triage.category": "services",
        "vendor-triage.evidence-sufficiency": 2,
      },
    });

    const result = await engine.evaluate({
      state: STATE,
      questions: { lowRisk: LOW_RISK, category: CATEGORY, sufficiency: SUFFICIENCY },
    });

    expect(result.answers.lowRisk.value).toBe(true);
    expect(result.answers.category.value).toBe("services");
    expect(result.answers.sufficiency.value).toBe(2);
  });

  it("prefers an `id@version` entry over a bare-id entry", async () => {
    const engine = createFakeDecisionEngine({
      script: {
        "vendor-triage.category": "hardware",
        "vendor-triage.category@1.0.0": "software",
      },
    });

    const result = await engine.evaluate({ state: STATE, questions: { category: CATEGORY } });

    expect(result.answers.category.value).toBe("software");
  });

  it("derives confidence from a scripted distribution exactly as the real adapter does", async () => {
    const engine = createFakeDecisionEngine({
      script: {
        "vendor-triage.category": {
          value: "software",
          distribution: { software: 0.96, services: 0.03, hardware: 0.01 },
        },
      },
    });

    const result = await engine.evaluate({ state: STATE, questions: { category: CATEGORY } });

    expect(result.answers.category.confidence).toBe(0.96);
    expect(bandFor(result.answers.category, CATEGORY.bands as never)).toBe("auto");
  });

  it("leaves confidence null without a distribution, so banding fails closed", async () => {
    const engine = createFakeDecisionEngine({ script: { "vendor-triage.category": "software" } });

    const result = await engine.evaluate({ state: STATE, questions: { category: CATEGORY } });

    expect(result.answers.category.distribution).toBeNull();
    expect(result.answers.category.confidence).toBeNull();
    expect(bandFor(result.answers.category, CATEGORY.bands as never)).toBe("human-review");
  });

  it("accepts an explicit confidence override", async () => {
    const engine = createFakeDecisionEngine({
      script: { "vendor-triage.obviously-low-risk": { value: true, confidence: 0.8 } },
    });

    const result = await engine.evaluate({ state: STATE, questions: { lowRisk: LOW_RISK } });

    expect(result.answers.lowRisk.confidence).toBe(0.8);
    expect(bandFor(result.answers.lowRisk, LOW_RISK.bands as never)).toBe("agent-review");
  });

  it("records every call, including the questions it was asked", async () => {
    const engine = createFakeDecisionEngine({ script: { "vendor-triage.category": "software" } });

    await engine.evaluate({ state: STATE, questions: { category: CATEGORY } });
    await engine.evaluate({ state: { other: 1 }, questions: { category: CATEGORY } });

    expect(engine.calls).toHaveLength(2);
    expect(engine.calls[0]?.state).toEqual(STATE);
    expect(Object.keys(engine.calls[1]?.questions ?? {})).toEqual(["category"]);
  });

  it("fingerprints the state the same way the real engine does", async () => {
    const engine = createFakeDecisionEngine({ script: { "vendor-triage.category": "software" } });

    const result = await engine.evaluate({ state: STATE, questions: { category: CATEGORY } });

    expect(result.stateFingerprint).toBe(fingerprint(STATE));
  });

  it("produces a result that survives a JSON round trip", async () => {
    const engine = createFakeDecisionEngine({
      script: {
        "vendor-triage.obviously-low-risk": {
          value: false,
          distribution: { true: 0.1, false: 0.9 },
        },
      },
    });

    const result = await engine.evaluate({ state: STATE, questions: { lowRisk: LOW_RISK } });

    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("fails with a DecisionError when scripted to fail, and still records the call", async () => {
    const engine = createFakeDecisionEngine({ failWith: new Error("gateway down") });

    await expect(
      engine.evaluate({ state: STATE, questions: { category: CATEGORY } }),
    ).rejects.toBeInstanceOf(DecisionError);
    expect(engine.calls).toHaveLength(1);
  });

  it("passes a DecisionError through unwrapped", async () => {
    const failure = new DecisionError("already typed");
    const engine = createFakeDecisionEngine({ failWith: failure });

    await expect(engine.evaluate({ state: STATE, questions: { category: CATEGORY } })).rejects.toBe(
      failure,
    );
  });

  it("refuses an unscripted question rather than inventing a default", async () => {
    const engine = createFakeDecisionEngine();

    await expect(
      engine.evaluate({ state: STATE, questions: { category: CATEGORY } }),
    ).rejects.toBeInstanceOf(DecisionError);
  });

  it("refuses a script entry of the wrong shape for the question's kind", async () => {
    const engine = createFakeDecisionEngine({
      script: { "vendor-triage.obviously-low-risk": "yes" },
    });

    await expect(
      engine.evaluate({ state: STATE, questions: { lowRisk: LOW_RISK } }),
    ).rejects.toBeInstanceOf(DecisionError);
  });

  it("refuses a choice the question does not offer", async () => {
    const engine = createFakeDecisionEngine({ script: { "vendor-triage.category": "firmware" } });

    await expect(
      engine.evaluate({ state: STATE, questions: { category: CATEGORY } }),
    ).rejects.toBeInstanceOf(DecisionError);
  });
});
