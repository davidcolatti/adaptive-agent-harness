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

  if (output.riskFlags.length === 0) {
    return { allowed: true };
  }

  const count = output.riskFlags.length;

  return {
    allowed: false,
    reason: `the recommendation is \`proceed\` while ${count} risk flag${count === 1 ? " is" : "s are"} still open: ${output.riskFlags
      .map((flag) => flag.concern)
      .join("; ")}`,
  };
}
