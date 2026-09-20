import { describe, expect, it } from "vitest";
import { type DecisionResult, definePolicy, type QuestionSet } from "./decision.js";
import { type DecisionRecord, parseDecisionRecord, replayDecisions } from "./decision-record.js";
import { ValidationError } from "./errors.js";
import { fingerprint } from "./fingerprint.js";
import { newDecisionId, newRunId } from "./ids.js";

/**
 * The decision record and its replay (M3-T3).
 *
 * Every case here is about one of two claims: that a stored decision is
 * checked rather than trusted, and that re-routing stored evidence needs no
 * engine. The second is the milestone's acceptance criterion "changing a policy
 * threshold can replay stored decisions without rerunning Jev", and **no
 * `DecisionEngine` is constructed anywhere in this file**, which is the
 * strongest form that assertion can take.
 */

const STATE = { vendor: "Northwind Ledger" };

function makeResult(
  overrides: Partial<DecisionResult<QuestionSet>> = {},
): DecisionResult<QuestionSet> {
  const decisionId = overrides.decisionId ?? newDecisionId();

  return {
    decisionId,
    answers: {
      category: {
        questionId: "vendor-triage.category",
        questionVersion: "1.0.0",
        kind: "choice",
        value: "software",
        distribution: { software: 0.82, services: 0.15, hardware: 0.03 },
        confidence: 0.82,
      },
    },
    stateFingerprint: fingerprint(STATE),
    model: { provider: "fake", modelId: "fake-decision-engine" },
    usage: { inputTokens: null, outputTokens: null, totalTokens: null, costUsd: null },
    latencyMs: 12,
    providerMetadata: null,
    warnings: [],
    ...overrides,
  } as DecisionResult<QuestionSet>;
}

function makeRecord(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  const result = overrides.result ?? makeResult();

  return {
    id: result.decisionId,
    runId: newRunId(),
    nodeId: "classify",
    result,
    policy: {
      route: "clear",
      policy: { id: "vendor-triage.route", version: "1.0.0" },
      reasons: ["confidence 0.82 clears the 0.80 threshold"],
    },
    createdAt: new Date("2026-09-20T16:00:00.000Z").toISOString(),
    ...overrides,
  } as DecisionRecord;
}

/**
 * The issues a parse threw, flattened to `{ path, message }`.
 *
 * `throwIfIssues` gives every read boundary in this repository the same generic
 * message and puts the detail in `issues`, so asserting on the message would
 * assert on the boundary's name rather than on what it found.
 */
function issuesOf(run: () => unknown): readonly { path: string; message: string }[] {
  try {
    run();
  } catch (error) {
    if (error instanceof ValidationError) {
      return error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
    }

    throw error;
  }

  throw new Error("expected a ValidationError");
}

/** A policy that routes on the `category` answer's confidence. */
function thresholdPolicy(version: string, minimum: number) {
  return definePolicy<QuestionSet, "clear" | "uncertain">({
    id: "vendor-triage.route",
    version,
    thresholds: { minimumConfidence: minimum },
    route(result) {
      const confidence = result.answers.category?.confidence ?? null;

      return confidence !== null && confidence >= minimum
        ? { route: "clear", reasons: [`confidence ${confidence} clears ${minimum}`] }
        : {
            route: "uncertain",
            reasons: [`confidence ${confidence ?? "none"} is below ${minimum}`],
          };
    },
  });
}

describe("parseDecisionRecord", () => {
  it("accepts a complete record and returns it deeply frozen", () => {
    const record = parseDecisionRecord(makeRecord());

    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.result)).toBe(true);
    expect(record.result.answers.category?.value).toBe("software");
  });

  it("reaches every item on the build plan's evidence list", () => {
    // M3-T3 names nine things to store. This case is the checklist: if a future
    // change moves one of them, this fails rather than the documentation
    // quietly becoming wrong.
    const record = parseDecisionRecord(makeRecord());
    const answer = record.result.answers.category;

    expect(answer?.questionId).toBe("vendor-triage.category");
    expect(answer?.questionVersion).toBe("1.0.0");
    expect(record.result.stateFingerprint).toBe(fingerprint(STATE));
    expect(answer?.value).toBe("software");
    expect(answer?.distribution).toEqual({ software: 0.82, services: 0.15, hardware: 0.03 });
    expect(answer?.confidence).toBe(0.82);
    expect(record.result.model).toEqual({ provider: "fake", modelId: "fake-decision-engine" });
    expect(record.result.usage.costUsd).toBeNull();
    expect(record.result.latencyMs).toBe(12);
    expect(record.policy?.policy).toEqual({ id: "vendor-triage.route", version: "1.0.0" });
  });

  it("accepts a record no policy consumed", () => {
    expect(parseDecisionRecord(makeRecord({ policy: null })).policy).toBeNull();
  });

  it("accepts a decision made outside a node", () => {
    expect(parseDecisionRecord(makeRecord({ nodeId: null })).nodeId).toBeNull();
  });

  it("rejects a record whose id and evidence disagree about which decision it is", () => {
    const record = makeRecord();

    expect(() =>
      parseDecisionRecord({
        ...record,
        result: { ...record.result, decisionId: newDecisionId() },
      }),
    ).toThrow(ValidationError);
  });

  it("rejects a state fingerprint that is not a sha256 digest", () => {
    const record = makeRecord();

    expect(
      issuesOf(() =>
        parseDecisionRecord({
          ...record,
          result: { ...record.result, stateFingerprint: "deadbeef" },
        }),
      ),
    ).toContainEqual({
      path: "result.stateFingerprint",
      message: expect.stringContaining("sha256:"),
    });
  });

  it("rejects a stored policy outcome with no reason, because it is unauditable", () => {
    expect(
      issuesOf(() =>
        parseDecisionRecord(
          makeRecord({
            policy: { route: "clear", policy: { id: "p", version: "1.0.0" }, reasons: [] },
          }),
        ),
      ),
    ).toContainEqual({ path: "policy.reasons", message: "expected at least one reason" });
  });

  it("rejects an unknown field rather than dropping it", () => {
    expect(issuesOf(() => parseDecisionRecord({ ...makeRecord(), surprise: 1 }))).toContainEqual({
      path: "surprise",
      message: "unknown field",
    });
  });

  it("rejects a distribution entry that is not a probability", () => {
    const result = makeResult();

    expect(() =>
      parseDecisionRecord(
        makeRecord({
          result: {
            ...result,
            answers: {
              category: { ...result.answers.category, distribution: { software: 4 } },
            },
          } as DecisionResult<QuestionSet>,
        }),
      ),
    ).toThrow(ValidationError);
  });

  it("reports every problem at once, each with a path", () => {
    try {
      parseDecisionRecord({
        id: "not-an-id",
        runId: "also-not",
        nodeId: 7,
        result: 5,
        policy: null,
        createdAt: "not a date",
      });
      expect.unreachable("expected a ValidationError");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const issues = (error as ValidationError).issues;

      expect(issues.length).toBeGreaterThanOrEqual(5);
      expect(issues.map((issue) => issue.path.join("."))).toContain("createdAt");
    }
  });

  it("survives a JSON round trip, because a stored record is JSON", () => {
    const record = parseDecisionRecord(makeRecord());

    expect(parseDecisionRecord(JSON.parse(JSON.stringify(record)))).toEqual(record);
  });
});

describe("replayDecisions", () => {
  it("re-routes stored evidence through a tightened threshold with no engine", () => {
    // The acceptance criterion, in one case. The records below were never
    // produced by an engine in this test; they are bytes, and a policy is a
    // pure function of bytes.
    const stored = [
      parseDecisionRecord(makeRecord()),
      parseDecisionRecord(
        makeRecord({
          result: makeResult({
            answers: {
              category: {
                questionId: "vendor-triage.category",
                questionVersion: "1.0.0",
                kind: "choice",
                value: "services",
                distribution: { services: 0.99, software: 0.01 },
                confidence: 0.99,
              },
            },
          } as Partial<DecisionResult<QuestionSet>>),
        }),
      ),
    ];

    const report = replayDecisions(stored, thresholdPolicy("2.0.0", 0.9));

    expect(report.total).toBe(2);
    expect(report.changed).toBe(1);
    expect(report.unchanged).toBe(1);
    expect(report.decisions[0]?.replayed.route).toBe("uncertain");
    expect(report.decisions[0]?.stored?.route).toBe("clear");
    expect(report.decisions[1]?.replayed.route).toBe("clear");
    expect(report.routeChanges).toEqual([{ from: "clear", to: "uncertain", count: 1 }]);
  });

  it("leaves every stored record untouched", () => {
    const stored = [parseDecisionRecord(makeRecord())];
    const before = JSON.stringify(stored);

    replayDecisions(stored, thresholdPolicy("2.0.0", 0.99));

    expect(JSON.stringify(stored)).toBe(before);
  });

  it("counts a record no policy consumed as changed, because something routes it now", () => {
    const report = replayDecisions(
      [parseDecisionRecord(makeRecord({ policy: null }))],
      thresholdPolicy("1.0.0", 0.8),
    );

    expect(report.changed).toBe(1);
    expect(report.routeChanges).toEqual([{ from: null, to: "clear", count: 1 }]);
  });

  it("reports nothing changed when the same policy is replayed", () => {
    const report = replayDecisions(
      [parseDecisionRecord(makeRecord())],
      thresholdPolicy("1.0.0", 0.8),
    );

    expect(report.changed).toBe(0);
    expect(report.routeChanges).toEqual([]);
  });

  it("replays an empty history without complaint", () => {
    const report = replayDecisions([], thresholdPolicy("1.0.0", 0.8));

    expect(report).toMatchObject({ total: 0, changed: 0, unchanged: 0, routeChanges: [] });
  });
});
