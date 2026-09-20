import type { VendorTriageDecisionInput, VendorTriageOutput } from "../domain/schemas.js";
import { noProceedWithOpenRiskFlags } from "../policies/no-proceed-with-open-risk-flags.js";

/**
 * The `decide` node of the hand-authored vendor workflow (M4-T10).
 *
 * It is the last node of the `research` route: the agent produced a triage, a
 * `jev` node decided whether that triage's own evidence supports it, and this
 * function decides what the organization does about the pair. It is the policy
 * half of ADR-0009's split, applied inside a workflow: **judgment** decided how
 * the evidence reads, and this is the rule the organization owns.
 *
 * **Pure and total.** Same output for the same input, no I/O, and every
 * `VendorTriageDecisionInput` gets a valid `vendor-triage.output`.
 *
 * It reads **both** the triage and the verification, which is why the workflow
 * binds it an explicit `{ kind: "object" }` binding: a `code` node bound to its
 * predecessor would see the verification alone, and the verification is a
 * statement *about* a triage it does not contain.
 *
 * **It only ever narrows.** The two rules below can move a recommendation
 * towards `escalate` and never away from it, so the compiled path cannot
 * approve something the full agent did not, which is what makes running it
 * instead of the agent safe.
 */

/**
 * Apply the domain's policy to a researched triage and its verification.
 *
 * ```ts
 * const output = decideVerifiedTriage({ triage, verification });
 * ```
 *
 * Two rules, in order:
 *
 * 1. **An unsupported triage escalates**, and so does one the harness is not
 *    confident about. The `verify` node answers a bounded question and bands
 *    its own confidence (M3-T5); this rule treats anything but a confident
 *    `true` as unsupported, because an answer the harness cannot trust is not
 *    support, and no deterministic rule can repair a conclusion its evidence
 *    does not carry.
 * 2. **`noProceedWithOpenRiskFlags` is enforced**, and a refusal escalates
 *    rather than being softened to `proceed_with_conditions`: this code cannot
 *    invent the condition that would make an open risk flag acceptable, and a
 *    condition it invented would be the one nobody verifies.
 *
 * @returns the triage unchanged when both rules pass, and otherwise the same
 * triage with its recommendation replaced by an `escalate` naming the reason.
 * Risk flags, missing information and evidence are never edited: they are what
 * the agent found, and a policy that rewrote them would destroy the record the
 * escalation is meant to hand over.
 */
export function decideVerifiedTriage(input: VendorTriageDecisionInput): VendorTriageOutput {
  const { triage, verification } = input;
  // A confident `true`, and nothing else, is support. `band` is `auto` only
  // when the question's own calibration says the confidence clears its
  // threshold, so this one condition covers "the evidence does not support it"
  // and "the harness cannot tell" without conflating them in the rationale.
  const supported = verification.answer === true && verification.band === "auto";

  if (!supported) {
    return {
      ...triage,
      recommendation: {
        decision: "escalate",
        rationale:
          verification.answer === true
            ? `The verification answered that the triage's evidence supports it, but only at confidence ${verification.confidence ?? "(none)"} (band \`${verification.band}\`), which this policy does not act on.`
            : `The triage's own evidence does not support its conclusion (confidence ${verification.confidence ?? "(none)"}, band \`${verification.band}\`, decision ${verification.decisionId}).`,
      },
    };
  }

  const decision = noProceedWithOpenRiskFlags(triage);

  if (!decision.allowed) {
    return {
      ...triage,
      recommendation: {
        decision: "escalate",
        rationale: `The policy \`no-proceed-with-open-risk-flags\` refused the agent's recommendation: ${decision.reason ?? "no reason given"}`,
      },
    };
  }

  return triage;
}
