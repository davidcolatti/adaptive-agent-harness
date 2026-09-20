import type { VendorTriageOutput } from "../domain/schemas.js";

/**
 * The domain's one policy capability (M1-T9).
 *
 * ADR-0009 separates **judgment** from **policy**: a model (later, Jev) decides
 * how worrying the evidence is, and a plain TypeScript threshold decides what
 * the organization does about it. This function is the policy half. It never
 * asks whether a risk flag is serious; it asks only whether the recommendation
 * is compatible with there being any, which is a rule the organization owns and
 * can change without retraining or re-prompting anything.
 *
 * **Pure and total.** Same output for the same input, no I/O, and every
 * `VendorTriageOutput` gets an answer.
 */

/**
 * The thresholds this policy applies, as data.
 *
 * ADR-0009 separates judgment from policy so that the organization can change
 * what it does about a risk without retraining or re-prompting anything.
 * Changing a threshold is therefore a behavior change that touches no
 * instruction and no SOP, which is exactly the case M2-T8's behavior
 * fingerprint has to catch — and it is one of the three the M2 acceptance
 * criterion names. `src/behavior.ts` hashes this object, and the function below
 * reads it, so the value that is fingerprinted is the value that is enforced.
 */
export const NO_PROCEED_WITH_OPEN_RISK_FLAGS_THRESHOLDS = {
  /**
   * How many open risk flags an unconditional `proceed` may carry. Zero: any
   * open flag rules `proceed` out.
   */
  maxOpenRiskFlagsForProceed: 0,
} as const;

/** What a policy says about an output. */
export interface PolicyDecision {
  /** Whether the output is allowed to stand as written. */
  readonly allowed: boolean;
  /** Why not, when it is not. Absent when `allowed` is `true`. */
  readonly reason?: string;
}

/**
 * Refuse a `proceed` recommendation while any risk flag is still open.
 *
 * ```ts
 * const decision = noProceedWithOpenRiskFlags(output);
 * if (!decision.allowed) {
 *   // Escalate rather than auto-approving.
 * }
 * ```
 *
 * The three other outcomes the domain allows (`proceed_with_conditions`,
 * `request_information`, `escalate`) all leave a human in the loop, so a risk
 * flag alongside them is a description of the work still to do rather than a
 * contradiction. Only an unconditional `proceed` is incompatible with one.
 */
export function noProceedWithOpenRiskFlags(output: VendorTriageOutput): PolicyDecision {
  if (output.recommendation.decision !== "proceed") {
    return { allowed: true };
  }

  const count = output.riskFlags.length;

  if (count <= NO_PROCEED_WITH_OPEN_RISK_FLAGS_THRESHOLDS.maxOpenRiskFlagsForProceed) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: `the recommendation is \`proceed\` while ${count} risk flag${count === 1 ? " is" : "s are"} still open: ${output.riskFlags
      .map((flag) => flag.concern)
      .join("; ")}`,
  };
}
