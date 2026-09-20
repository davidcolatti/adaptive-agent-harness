import type { DecisionResult, QuestionSet } from "@internal/core";
import { newDecisionId, policyFingerprint, replayDecisions } from "@internal/core";
import { describe, expect, it } from "vitest";
import {
  createTriagePolicy,
  DEFAULT_TRIAGE_THRESHOLDS,
  TRIAGE_POLICY_ID,
} from "./triage-policy.js";

/**
 * The vendor-triage routing policy (M3-T8, M3-T4).
 *
 * **No engine is constructed in this file.** A policy is a pure function of a
 * result, and every case below hands it a literal, which is the strongest way
 * to state that it performs no I/O and that stored evidence is a legitimate
 * argument for it.
 */

/** A result of the shape the `classify` bundle produces. */
function result(
  lowRisk: { value: boolean; confidence: number | null },
  category: { value: string; confidence: number | null },
  evidenceSufficient: { value: boolean; confidence: number | null },
): DecisionResult<QuestionSet> {
  const decisionId = newDecisionId();

  return {
    decisionId,
    answers: {
      lowRisk: {
        questionId: "vendor-triage.low-risk",
        questionVersion: "1.0.0",
        kind: "boolean",
        value: lowRisk.value,
        probabilityTrue: lowRisk.value ? (lowRisk.confidence ?? 0) : 1 - (lowRisk.confidence ?? 0),
        distribution: null,
        confidence: lowRisk.confidence,
      },
      category: {
        questionId: "vendor-triage.category",
        questionVersion: "1.0.0",
        kind: "choice",
        value: category.value,
        distribution: null,
        confidence: category.confidence,
      },
      evidenceSufficient: {
        questionId: "vendor-triage.evidence-sufficient",
        questionVersion: "1.0.0",
        kind: "boolean",
        value: evidenceSufficient.value,
        probabilityTrue: evidenceSufficient.value
          ? (evidenceSufficient.confidence ?? 0)
          : 1 - (evidenceSufficient.confidence ?? 0),
        distribution: null,
        confidence: evidenceSufficient.confidence,
      },
    },
    stateFingerprint: `sha256:${"a".repeat(64)}`,
    model: { provider: "fixture", modelId: "vendor-triage-fixture" },
    usage: { inputTokens: null, outputTokens: null, totalTokens: null, costUsd: null },
    latencyMs: 0,
    providerMetadata: null,
    warnings: [],
  } as unknown as DecisionResult<QuestionSet>;
}

const CONFIDENT_FINANCE = { value: "finance and accounting", confidence: 0.95 };

describe("createTriagePolicy", () => {
  it("routes a confidently low-risk vendor with sufficient evidence to `clear`", () => {
    const outcome = createTriagePolicy().evaluate(
      result({ value: true, confidence: 0.94 }, CONFIDENT_FINANCE, {
        value: true,
        confidence: 0.92,
      }),
    );

    expect(outcome.route).toBe("clear");
    expect(outcome.reasons[0]).toContain("confidently low risk");
    expect(outcome.policy).toEqual({ id: TRIAGE_POLICY_ID, version: "1.0.0" });
  });

  it("routes a confidently risky vendor to `research`, because the agent must read it", () => {
    const outcome = createTriagePolicy().evaluate(
      result({ value: false, confidence: 0.92 }, CONFIDENT_FINANCE, {
        value: false,
        confidence: 0.88,
      }),
    );

    expect(outcome.route).toBe("research");
  });

  it("routes a confidently insufficient evidence set to `research` even when the vendor looks safe", () => {
    const outcome = createTriagePolicy().evaluate(
      result({ value: true, confidence: 0.91 }, CONFIDENT_FINANCE, {
        value: false,
        confidence: 0.93,
      }),
    );

    expect(outcome.route).toBe("research");
    expect(outcome.reasons[0]).toContain("insufficient");
  });

  it("escalates when the category is not established, whatever the other two say", () => {
    const outcome = createTriagePolicy().evaluate(
      result(
        { value: true, confidence: 0.99 },
        { value: "other", confidence: 0.3 },
        {
          value: true,
          confidence: 0.99,
        },
      ),
    );

    expect(outcome.route).toBe("uncertain");
    expect(outcome.reasons[0]).toContain("below the 0.8");
  });

  it("escalates a null confidence rather than treating it as zero or as fine", () => {
    const outcome = createTriagePolicy().evaluate(
      result(
        { value: true, confidence: null },
        { value: "other", confidence: null },
        {
          value: true,
          confidence: null,
        },
      ),
    );

    expect(outcome.route).toBe("uncertain");
  });

  it("escalates an unconfident answer rather than sending it to an agent that already said it does not know", () => {
    // The asymmetry the policy exists to express: a confident `false` is a
    // judgment that the case needs reading, and an unconfident answer is the
    // absence of a judgment.
    const outcome = createTriagePolicy().evaluate(
      result({ value: false, confidence: 0.55 }, CONFIDENT_FINANCE, {
        value: true,
        confidence: 0.6,
      }),
    );

    expect(outcome.route).toBe("uncertain");
    expect(outcome.reasons[0]).toContain("confident enough");
  });

  it("always gives at least one reason, because an unauditable route defeats the point", () => {
    for (const outcome of [
      createTriagePolicy().evaluate(
        result({ value: true, confidence: 0.94 }, CONFIDENT_FINANCE, {
          value: true,
          confidence: 0.92,
        }),
      ),
      createTriagePolicy().evaluate(
        result({ value: false, confidence: 0.92 }, CONFIDENT_FINANCE, {
          value: false,
          confidence: 0.9,
        }),
      ),
      createTriagePolicy().evaluate(
        result(
          { value: true, confidence: 0.5 },
          { value: "other", confidence: 0.2 },
          {
            value: true,
            confidence: 0.5,
          },
        ),
      ),
    ]) {
      expect(outcome.reasons.length).toBeGreaterThan(0);
    }
  });

  it("exposes its thresholds so two versions that differ are detectable", () => {
    const shipped = createTriagePolicy();
    const strict = createTriagePolicy(
      { ...DEFAULT_TRIAGE_THRESHOLDS, minimumCategoryConfidence: 0.99 },
      "2.0.0",
    );

    expect(shipped.thresholds).toEqual({ ...DEFAULT_TRIAGE_THRESHOLDS });
    expect(policyFingerprint(shipped)).not.toBe(policyFingerprint(strict));
    // And the same numbers under the same version hash identically, so a
    // fingerprint comparison is a real check rather than a nonce.
    expect(policyFingerprint(shipped)).toBe(policyFingerprint(createTriagePolicy()));
  });

  it("re-routes a JSON round trip of a stored result, with no engine anywhere", () => {
    // The acceptance criterion, at the fixture's own level: a result that has
    // been through `JSON.parse(JSON.stringify(...))` is a stored result, and
    // two policy versions over it give two routes.
    const stored = JSON.parse(
      JSON.stringify(
        result({ value: true, confidence: 0.94 }, CONFIDENT_FINANCE, {
          value: true,
          confidence: 0.92,
        }),
      ),
    ) as DecisionResult<QuestionSet>;

    expect(createTriagePolicy().evaluate(stored).route).toBe("clear");
    expect(
      createTriagePolicy(
        { ...DEFAULT_TRIAGE_THRESHOLDS, minimumCategoryConfidence: 0.99 },
        "2.0.0",
      ).evaluate(stored).route,
    ).toBe("uncertain");
  });

  it("works as `replayDecisions`' policy argument over stored records", () => {
    const stored = result({ value: true, confidence: 0.94 }, CONFIDENT_FINANCE, {
      value: true,
      confidence: 0.92,
    });
    const record = {
      id: stored.decisionId,
      runId: "01a0c0a0-3d14-7000-8bad-591aba7df0cc",
      nodeId: "classify",
      result: stored,
      policy: {
        route: "clear",
        policy: { id: TRIAGE_POLICY_ID, version: "1.0.0" },
        reasons: ["the shipped thresholds cleared"],
      },
      createdAt: new Date("2026-09-20T17:00:00.000Z").toISOString(),
    } as const;

    const report = replayDecisions(
      [record as never],
      createTriagePolicy(
        { ...DEFAULT_TRIAGE_THRESHOLDS, minimumCategoryConfidence: 0.99 },
        "2.0.0",
      ),
    );

    expect(report.changed).toBe(1);
    expect(report.decisions[0]?.replayed.route).toBe("uncertain");
  });
});
