import {
  type BooleanQuestion,
  type ChoiceQuestion,
  DecisionError,
  defineQuestion,
} from "@internal/core";
import { createFakeDecisionEngine } from "@internal/testing";
import { describe, expect, it } from "vitest";
import { createDecisionPort, type DecisionNodeOutput } from "./decision-port.js";
import { createRunFixture, jevNode } from "./test-fixtures.js";

const CATEGORY = defineQuestion<ChoiceQuestion>({
  id: "vendor-triage.category",
  version: "1.0.0",
  kind: "choice",
  prompt: "Which vendor category applies?",
  choices: ["clear", "research", "uncertain"],
  bands: { auto: 0.9, agentReview: 0.6 },
});

const SUPPORTED = defineQuestion<BooleanQuestion>({
  id: "vendor-triage.evidence-supports",
  version: "1.0.0",
  kind: "boolean",
  prompt: "Does the cited evidence support the triage?",
  bands: { auto: 0.9, agentReview: 0.6 },
});

/** A question with no calibration, to prove an uncalibrated one cannot auto-route. */
const UNCALIBRATED = defineQuestion<ChoiceQuestion>({
  id: "vendor-triage.uncalibrated",
  version: "1.0.0",
  kind: "choice",
  prompt: "Which category, before anyone calibrated this question?",
  choices: ["clear", "research"],
});

const INPUT = { vendorName: "Northwind Supply" };

/** Ask one `jev` node's question through a port built over a scripted engine. */
async function decide(
  port: ReturnType<typeof createDecisionPort>,
  questionId: string,
  kind: "boolean" | "choice" | "score",
): Promise<DecisionNodeOutput> {
  const { context } = createRunFixture();
  const node = jevNode("classify", questionId, kind, null);

  return (await port.decide({ node, input: INPUT, context })) as unknown as DecisionNodeOutput;
}

describe("createDecisionPort", () => {
  it("answers a `jev` node's question and returns the documented output shape", async () => {
    const engine = createFakeDecisionEngine({
      script: {
        "vendor-triage.category@1.0.0": {
          value: "research",
          distribution: { clear: 0.05, research: 0.93, uncertain: 0.02 },
        },
      },
    });

    const output = await decide(
      createDecisionPort({ engine, questions: [CATEGORY] }),
      CATEGORY.id,
      "choice",
    );

    expect(output).toEqual({
      answer: "research",
      confidence: 0.93,
      band: "auto",
      distribution: { clear: 0.05, research: 0.93, uncertain: 0.02 },
      decisionId: expect.any(String),
    });
  });

  it("passes the node's input through as the decision's shared state", async () => {
    const engine = createFakeDecisionEngine({ script: { "vendor-triage.category": "clear" } });

    await decide(createDecisionPort({ engine, questions: [CATEGORY] }), CATEGORY.id, "choice");

    expect(engine.calls).toHaveLength(1);
    expect(engine.calls[0]?.state).toEqual(INPUT);
  });

  it("answers a boolean question with its judgment and derived confidence", async () => {
    const engine = createFakeDecisionEngine({
      script: {
        "vendor-triage.evidence-supports": {
          value: false,
          distribution: { true: 0.3, false: 0.7 },
        },
      },
    });

    const output = await decide(
      createDecisionPort({ engine, questions: [SUPPORTED] }),
      SUPPORTED.id,
      "boolean",
    );

    expect(output.answer).toBe(false);
    expect(output.confidence).toBeCloseTo(0.7, 10);
    expect(output.band).toBe("agent-review");
  });

  it("escalates an answer with no distribution to human review", async () => {
    const engine = createFakeDecisionEngine({ script: { "vendor-triage.category": "clear" } });

    const output = await decide(
      createDecisionPort({ engine, questions: [CATEGORY] }),
      CATEGORY.id,
      "choice",
    );

    expect(output.confidence).toBeNull();
    expect(output.band).toBe("human-review");
  });

  it("never auto-routes an uncalibrated question, however confident the answer", async () => {
    const engine = createFakeDecisionEngine({
      script: {
        "vendor-triage.uncalibrated": { value: "clear", distribution: { clear: 1, research: 0 } },
      },
    });

    const output = await decide(
      createDecisionPort({ engine, questions: [UNCALIBRATED] }),
      UNCALIBRATED.id,
      "choice",
    );

    expect(output.confidence).toBe(1);
    expect(output.band).toBe("human-review");
  });

  it("accepts a keyed record as well as an array", async () => {
    const engine = createFakeDecisionEngine({ script: { "vendor-triage.category": "clear" } });

    const output = await decide(
      createDecisionPort({ engine, questions: { anything: CATEGORY } }),
      CATEGORY.id,
      "choice",
    );

    expect(output.answer).toBe("clear");
  });

  it("returns JSON: the output survives a round trip", async () => {
    const engine = createFakeDecisionEngine({
      script: {
        "vendor-triage.category": {
          value: "clear",
          distribution: { clear: 1, research: 0, uncertain: 0 },
        },
      },
    });

    const output = await decide(
      createDecisionPort({ engine, questions: [CATEGORY] }),
      CATEGORY.id,
      "choice",
    );

    expect(JSON.parse(JSON.stringify(output))).toEqual(output);
  });
});

describe("createDecisionPort failure semantics", () => {
  it("refuses a question the registry does not hold", async () => {
    const engine = createFakeDecisionEngine({ script: { "vendor-triage.category": "clear" } });

    const error = await decide(
      createDecisionPort({ engine, questions: [CATEGORY] }),
      "vendor-triage.not-registered",
      "choice",
    ).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(DecisionError);
    expect((error as DecisionError).details).toMatchObject({
      question: "vendor-triage.not-registered@1.0.0",
      registered: ["vendor-triage.category@1.0.0"],
    });
    expect(engine.calls).toHaveLength(0);
  });

  it("refuses a node whose declared kind disagrees with the registered question", async () => {
    const engine = createFakeDecisionEngine({ script: { "vendor-triage.category": "clear" } });

    const error = await decide(
      createDecisionPort({ engine, questions: [CATEGORY] }),
      CATEGORY.id,
      "boolean",
    ).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(DecisionError);
    expect((error as DecisionError).details).toMatchObject({
      declaredKind: "boolean",
      registeredKind: "choice",
    });
    expect(engine.calls).toHaveLength(0);
  });

  it("lets an engine failure through as a DecisionError rather than guessing", async () => {
    const engine = createFakeDecisionEngine({ failWith: new Error("gateway down") });

    await expect(
      decide(createDecisionPort({ engine, questions: [CATEGORY] }), CATEGORY.id, "choice"),
    ).rejects.toBeInstanceOf(DecisionError);
  });
});
