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
 * 1. **An unsupported triage escalates.** `supported: false` means the triage
 *    concluded something its own cited evidence does not carry, and no
 *    deterministic rule can repair that.
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

  if (!verification.supported) {
    return {
      ...triage,
      recommendation: {
        decision: "escalate",
        rationale: `The triage's own evidence does not support its conclusion: ${verification.rationale}`,
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
