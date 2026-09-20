import {
  type BooleanQuestion,
  type ChoiceQuestion,
  DecisionError,
  type DecisionRecord,
  definePolicy,
  defineQuestion,
  defineQuestionSet,
  type QuestionSet,
  replayDecisions,
  StorageError,
  ValidationError,
} from "@internal/core";
import { createFakeDecisionEngine, createInMemoryStorage } from "@internal/testing";
import { describe, expect, it } from "vitest";
import {
  createDecisionPort,
  type DecisionNodeOutput,
  type QuestionBundle,
} from "./decision-port.js";
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
      // No policy on this entry, so nothing routed the answer and the node says
      // so rather than inventing a route (M3-T3).
      route: null,
      reasons: [],
      answers: { "vendor-triage.category": "research" },
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

/**
 * A bundle: three bounded questions about one vendor, and the policy that
 * turns the three answers into one route (M3-T4, M3-T6, M3-T8).
 */
const TRIAGE_QUESTIONS: QuestionSet = defineQuestionSet({
  lowRisk: defineQuestion<BooleanQuestion>({
    id: "vendor-triage.low-risk",
    version: "1.0.0",
    kind: "boolean",
    prompt: "Is the vendor obviously low risk?",
    bands: { auto: 0.85, agentReview: 0.6 },
  }),
  category: defineQuestion<ChoiceQuestion>({
    id: "vendor-triage.category",
    version: "1.0.0",
    kind: "choice",
    prompt: "Which vendor category applies?",
    choices: ["clear", "research", "uncertain"],
    bands: { auto: 0.9, agentReview: 0.6 },
  }),
  evidenceSufficient: defineQuestion<BooleanQuestion>({
    id: "vendor-triage.evidence-sufficient",
    version: "1.0.0",
    kind: "boolean",
    prompt: "Is the evidence sufficient to triage without research?",
    bands: { auto: 0.85, agentReview: 0.6 },
  }),
});

function triagePolicy(version: string, minimum: number) {
  return definePolicy<QuestionSet, "clear" | "research" | "uncertain">({
    id: "vendor-triage.route",
    version,
    thresholds: { minimumConfidence: minimum },
    route(result) {
      const category = result.answers.category;
      const confidence = category?.confidence ?? null;

      if (confidence === null || confidence < minimum) {
        return {
          route: "uncertain",
          reasons: [`the category's confidence ${confidence ?? "(none)"} is below ${minimum}`],
        };
      }

      return category?.value === "clear"
        ? { route: "clear", reasons: ["a confident `clear` category"] }
        : { route: "research", reasons: [`a confident \`${String(category?.value)}\` category`] };
    },
  });
}

const TRIAGE_BUNDLE: QuestionBundle = {
  id: "vendor-triage.classify",
  version: "1.0.0",
  kind: "choice",
  primary: "category",
  questions: TRIAGE_QUESTIONS,
  policy: triagePolicy("1.0.0", 0.8),
};

/** A script that answers all three of the bundle's questions confidently. */
const CONFIDENT_CLEAR = {
  "vendor-triage.low-risk": { value: true, distribution: { true: 0.95, false: 0.05 } },
  "vendor-triage.category": {
    value: "clear",
    distribution: { clear: 0.93, research: 0.05, uncertain: 0.02 },
  },
  "vendor-triage.evidence-sufficient": {
    value: true,
    distribution: { true: 0.91, false: 0.09 },
  },
} as const;

describe("createDecisionPort: bundles and policy (M3-T4, M3-T6)", () => {
  it("answers a bundle's three questions in one engine call and routes them", async () => {
    const engine = createFakeDecisionEngine({ script: CONFIDENT_CLEAR });
    const { context } = createRunFixture();

    const output = (await createDecisionPort({
      engine,
      questions: [TRIAGE_BUNDLE],
    }).decide({
      node: jevNode("classify", TRIAGE_BUNDLE.id, "choice", null),
      input: INPUT,
      context,
    })) as unknown as DecisionNodeOutput;

    // One call, because the three questions share one state. That is M3-T6's
    // rule, and this is what makes a batch cheaper than three decisions.
    expect(engine.calls).toHaveLength(1);
    expect(Object.keys(engine.calls[0]?.questions ?? {})).toEqual([
      "lowRisk",
      "category",
      "evidenceSufficient",
    ]);
    expect(output.answers).toEqual({
      lowRisk: true,
      category: "clear",
      evidenceSufficient: true,
    });
    // The primary question's answer, additionally at the top level, so a branch
    // can select on one path.
    expect(output.answer).toBe("clear");
    expect(output.route).toBe("clear");
    expect(output.reasons).toEqual(["a confident `clear` category"]);
  });

  it("routes to `uncertain` when the policy's threshold is not cleared", async () => {
    const engine = createFakeDecisionEngine({
      script: {
        ...CONFIDENT_CLEAR,
        "vendor-triage.category": {
          value: "clear",
          distribution: { clear: 0.55, research: 0.4, uncertain: 0.05 },
        },
      },
    });
    const { context } = createRunFixture();

    const output = (await createDecisionPort({
      engine,
      questions: [TRIAGE_BUNDLE],
    }).decide({
      node: jevNode("classify", TRIAGE_BUNDLE.id, "choice", null),
      input: INPUT,
      context,
    })) as unknown as DecisionNodeOutput;

    expect(output.answer).toBe("clear");
    expect(output.route).toBe("uncertain");
  });

  it("refuses a bundle whose primary key or declared kind is wrong, at construction", () => {
    const engine = createFakeDecisionEngine({ script: CONFIDENT_CLEAR });

    expect(() =>
      createDecisionPort({
        engine,
        questions: [{ ...TRIAGE_BUNDLE, primary: "nonexistent" }],
      }),
    ).toThrow(ValidationError);

    expect(() =>
      createDecisionPort({ engine, questions: [{ ...TRIAGE_BUNDLE, kind: "boolean" }] }),
    ).toThrow(ValidationError);
  });
});

describe("createDecisionPort: persistence (M3-T3)", () => {
  it("stores one record per decision, with the raw result and the policy outcome separate", async () => {
    const storage = createInMemoryStorage();
    const engine = createFakeDecisionEngine({ script: CONFIDENT_CLEAR });
    const { context } = createRunFixture();

    const output = (await createDecisionPort({
      engine,
      questions: [TRIAGE_BUNDLE],
      storage,
      now: () => new Date("2026-09-20T17:00:00.000Z"),
    }).decide({
      node: jevNode("classify", TRIAGE_BUNDLE.id, "choice", null),
      input: INPUT,
      context,
    })) as unknown as DecisionNodeOutput;

    const stored = await storage.listDecisions(context.runId);

    expect(stored).toHaveLength(1);
    const record = stored[0] as DecisionRecord;

    expect(record.id).toBe(output.decisionId);
    expect(record.runId).toBe(context.runId);
    expect(record.nodeId).toBe("classify");
    expect(record.createdAt).toBe("2026-09-20T17:00:00.000Z");
    // The raw judgment, untouched.
    expect(record.result.answers.category?.value).toBe("clear");
    expect(record.result.answers.category?.distribution).toEqual({
      clear: 0.93,
      research: 0.05,
      uncertain: 0.02,
    });
    // The organization's decision about it, beside it and not inside it.
    expect(record.policy?.route).toBe("clear");
    expect(record.policy?.policy).toEqual({ id: "vendor-triage.route", version: "1.0.0" });
  });

  it("stores `policy: null` when nothing routed the answer, with identical result bytes", async () => {
    // Milestone 3's "raw Jev result is stored separately from policy outcome",
    // demonstrated: the same script through a policied and an unpolicied entry
    // produces byte-identical `answers`, and only `policy` differs.
    const { context } = createRunFixture();

    async function record(policy: QuestionBundle["policy"]): Promise<DecisionRecord> {
      const storage = createInMemoryStorage();
      const engine = createFakeDecisionEngine({ script: CONFIDENT_CLEAR });
      // Built by omission rather than by `policy: undefined`, because
      // `exactOptionalPropertyTypes` treats the two as different types, and an
      // entry with no policy is exactly what the unpolicied case is.
      const { policy: _omitted, ...withoutPolicy } = TRIAGE_BUNDLE;
      const bundle: QuestionBundle =
        policy === undefined ? withoutPolicy : { ...withoutPolicy, policy };

      await createDecisionPort({ engine, questions: [bundle], storage }).decide({
        node: jevNode("classify", TRIAGE_BUNDLE.id, "choice", null),
        input: INPUT,
        context,
      });

      return (await storage.listDecisions(context.runId))[0] as DecisionRecord;
    }

    const without = await record(undefined);
    const with_ = await record(triagePolicy("1.0.0", 0.8));

    expect(without.policy).toBeNull();
    expect(with_.policy?.route).toBe("clear");
    expect(JSON.stringify(without.result.answers)).toBe(JSON.stringify(with_.result.answers));
    expect(without.result.stateFingerprint).toBe(with_.result.stateFingerprint);
  });

  it("fails the node when the store fails, rather than continuing unrecorded", async () => {
    const engine = createFakeDecisionEngine({ script: CONFIDENT_CLEAR });
    const { context } = createRunFixture();
    const storage = {
      saveDecision(): Promise<never> {
        return Promise.reject(new StorageError("storage: the decisions table is unreachable"));
      },
    };

    await expect(
      createDecisionPort({ engine, questions: [TRIAGE_BUNDLE], storage }).decide({
        node: jevNode("classify", TRIAGE_BUNDLE.id, "choice", null),
        input: INPUT,
        context,
      }),
    ).rejects.toBeInstanceOf(StorageError);
  });

  it("replays stored decisions through a tightened policy with no further engine call", async () => {
    // The acceptance criterion end to end: decide once, store, then re-route
    // the stored evidence and observe that the engine's call count did not
    // move and that at least one route changed.
    const storage = createInMemoryStorage();
    const engine = createFakeDecisionEngine({
      script: {
        ...CONFIDENT_CLEAR,
        "vendor-triage.category": {
          value: "clear",
          distribution: { clear: 0.84, research: 0.1, uncertain: 0.06 },
        },
      },
    });
    const { context } = createRunFixture();

    await createDecisionPort({ engine, questions: [TRIAGE_BUNDLE], storage }).decide({
      node: jevNode("classify", TRIAGE_BUNDLE.id, "choice", null),
      input: INPUT,
      context,
    });

    const callsAfterDeciding = engine.calls.length;
    const stored = await storage.listDecisions(context.runId);

    expect(stored[0]?.policy?.route).toBe("clear");

    const report = replayDecisions(stored, triagePolicy("2.0.0", 0.9));

    expect(engine.calls).toHaveLength(callsAfterDeciding);
    expect(report.changed).toBe(1);
    expect(report.decisions[0]?.replayed.route).toBe("uncertain");
    expect(report.decisions[0]?.replayed.policy).toEqual({
      id: "vendor-triage.route",
      version: "2.0.0",
    });
    // And the stored evidence is untouched, which is what makes the replay
    // repeatable.
    expect((await storage.listDecisions(context.runId))[0]?.policy?.route).toBe("clear");
  });
});
