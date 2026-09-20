import {
  type BooleanDecisionAnswer,
  type ChoiceDecisionAnswer,
  type DecisionResult,
  definePolicy,
  type Policy,
  type QuestionSet,
} from "@internal/core";

/**
 * The rule that turns three bounded judgments into one route (M3-T8, M3-T4).
 *
 * **This is the "TypeScript decides what follows" half of ADR-0009**, and it is
 * deliberately boring: it reads a {@link DecisionResult} and returns a route
 * and a reason. It performs no I/O, constructs no engine, reads no clock and
 * has no branch that depends on anything but its argument, which is what makes
 * "changing a policy threshold can replay stored decisions without rerunning
 * Jev" true of this fixture rather than only of the contract.
 *
 * ## The rule, in order
 *
 * | Condition | Route |
 * | --- | --- |
 * | the category is not confidently established | `uncertain` |
 * | the vendor is confidently low risk **and** the evidence is confidently sufficient | `clear` |
 * | either of those is confidently **false** | `research` |
 * | anything else | `uncertain` |
 *
 * The asymmetry in the last two rows is the point. A confident `false` is a
 * **judgment** that the case needs reading, so it routes to the agent; an
 * unconfident answer is the absence of a judgment, so it escalates. Treating
 * them the same would send every ambiguous case to a model that has already
 * said it does not know.
 *
 * The thresholds are exposed as data because ADR-0009 requires them to be
 * "versioned and replayable": `policyFingerprint()` hashes them, so a policy
 * whose numbers changed without its version changing is detectable.
 */

/** The three routes the vendor workflow's branch selects on. */
export const TRIAGE_ROUTES = ["clear", "research", "uncertain"] as const;

/** One of {@link TRIAGE_ROUTES}. */
export type TriageRoute = (typeof TRIAGE_ROUTES)[number];

/** The confidence a policy requires before it acts on an answer. */
export interface TriageThresholds {
  /** Below this, the category is not established and the case escalates. */
  readonly minimumCategoryConfidence: number;
  /** Below this, a `low-risk` answer is not acted on in either direction. */
  readonly minimumLowRiskConfidence: number;
  /** Below this, an `evidence-sufficient` answer is not acted on in either direction. */
  readonly minimumEvidenceConfidence: number;
}

/**
 * The thresholds the shipped policy applies.
 *
 * Exported so a caller can tighten one and replay history against it, which is
 * exactly what `runCalibration()` and `replayDecisions()` are for.
 */
export const DEFAULT_TRIAGE_THRESHOLDS: TriageThresholds = {
  minimumCategoryConfidence: 0.8,
  minimumLowRiskConfidence: 0.8,
  minimumEvidenceConfidence: 0.8,
};

/** The shipped policy's id. */
export const TRIAGE_POLICY_ID = "vendor-triage.route";

/** The shipped policy's exact version. */
export const TRIAGE_POLICY_VERSION = "1.0.0";

/** An answer's confidence, or `null` when the answer is missing entirely. */
function confidenceOf(
  answer: BooleanDecisionAnswer | ChoiceDecisionAnswer | undefined,
): number | null {
  return answer?.confidence ?? null;
}

/** Whether `answer` says `expected` with at least `minimum` confidence. */
function confidently(
  answer: BooleanDecisionAnswer | undefined,
  expected: boolean,
  minimum: number,
): boolean {
  const confidence = confidenceOf(answer);

  return answer?.value === expected && confidence !== null && confidence >= minimum;
}

/**
 * Build the vendor-triage routing policy.
 *
 * ```ts
 * const policy = createTriagePolicy();
 * const outcome = policy.evaluate(result);
 * ```
 *
 * `version` and `thresholds` are parameters so a calibration run, or a replay,
 * can ask "what would a stricter policy have done?" without editing this file.
 * A different threshold set **must** carry a different version, because two
 * policies that share a version and not a threshold are a lie the fingerprint
 * would catch.
 */
export function createTriagePolicy(
  thresholds: TriageThresholds = DEFAULT_TRIAGE_THRESHOLDS,
  version: string = TRIAGE_POLICY_VERSION,
): Policy<QuestionSet, TriageRoute> {
  return definePolicy<QuestionSet, TriageRoute>({
    id: TRIAGE_POLICY_ID,
    version,
    thresholds: { ...thresholds },
    route(result: DecisionResult<QuestionSet>) {
      const category = result.answers.category as ChoiceDecisionAnswer | undefined;
      const lowRisk = result.answers.lowRisk as BooleanDecisionAnswer | undefined;
      const evidence = result.answers.evidenceSufficient as BooleanDecisionAnswer | undefined;
      const categoryConfidence = confidenceOf(category);

      if (
        categoryConfidence === null ||
        categoryConfidence < thresholds.minimumCategoryConfidence
      ) {
        return {
          route: "uncertain",
          reasons: [
            `the category is \`${String(category?.value ?? "(unanswered)")}\` at confidence ${categoryConfidence ?? "(none)"}, below the ${thresholds.minimumCategoryConfidence} this policy requires`,
          ],
        };
      }

      const confidentlyLowRisk = confidently(lowRisk, true, thresholds.minimumLowRiskConfidence);
      const confidentlySufficient = confidently(
        evidence,
        true,
        thresholds.minimumEvidenceConfidence,
      );

      if (confidentlyLowRisk && confidentlySufficient) {
        return {
          route: "clear",
          reasons: [
            `the vendor is confidently low risk (${lowRisk?.confidence ?? 0}) and the evidence is confidently sufficient (${evidence?.confidence ?? 0}), in category \`${String(category?.value)}\``,
          ],
        };
      }

      const confidentlyRisky = confidently(lowRisk, false, thresholds.minimumLowRiskConfidence);
      const confidentlyInsufficient = confidently(
        evidence,
        false,
        thresholds.minimumEvidenceConfidence,
      );

      if (confidentlyRisky || confidentlyInsufficient) {
        return {
          route: "research",
          reasons: [
            confidentlyRisky
              ? "the vendor is confidently **not** obviously low risk, so the full agent reads the evidence"
              : "the evidence is confidently insufficient to triage without research",
          ],
        };
      }

      return {
        route: "uncertain",
        reasons: [
          `neither \`low risk\` (${String(lowRisk?.value)} at ${lowRisk?.confidence ?? "(none)"}) nor \`evidence sufficient\` (${String(evidence?.value)} at ${evidence?.confidence ?? "(none)"}) is confident enough to act on`,
        ],
      };
    },
  });
}
