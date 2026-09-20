import { describe, expect, it } from "vitest";
import type {
  VendorTriageOutput,
  VendorTriageRiskFlag,
  VendorTriageVerification,
} from "../domain/schemas.js";
import { decideVerifiedTriage } from "./decide-verified-triage.js";

/**
 * The `decide` node's handler (M4-T10).
 *
 * The invariant worth testing hardest is that it only ever narrows: it can move
 * a recommendation towards `escalate` and never away from it, which is what
 * makes running the compiled path instead of the full agent safe.
 */

/** A triage of the shape the `research` route's agent node produces. */
function triage(
  decision: VendorTriageOutput["recommendation"]["decision"],
  riskFlags: readonly VendorTriageRiskFlag[] = [],
): VendorTriageOutput {
  return {
    category: "Regional freight forwarding and customs brokerage.",
    riskFlags: [...riskFlags],
    missingInformation: [],
    recommendation: { decision, rationale: "The agent's own reasoning." },
    evidence: [{ claim: "The vendor files customs paperwork.", source: "vendor website, /about" }],
  };
}

/** One open risk flag, of the shape `detectPaymentDetailChange` produces. */
const OPEN_FLAG: VendorTriageRiskFlag = {
  clause: "Payment detail changes must be verified out of band before any payment is made.",
  concern: "An unverified banking-detail change arrived from a free email domain.",
  evidence: "inbound email to accounts payable (captured 2026-09-08)",
};

/** A verification of the shape the `verify` node produces. */
function verification(supported: boolean): VendorTriageVerification {
  return {
    supported,
    rationale: supported ? "The triage cites 1 source." : "The triage cites no source at all.",
    citedSources: supported ? ["vendor website, /about"] : [],
  };
}

describe("decideVerifiedTriage", () => {
  it("passes a supported, policy-compliant triage through unchanged", () => {
    const input = { triage: triage("proceed"), verification: verification(true) };

    expect(decideVerifiedTriage(input)).toEqual(input.triage);
  });

  it("escalates when the verification says the triage's own evidence does not support it", () => {
    const output = decideVerifiedTriage({
      triage: triage("proceed"),
      verification: verification(false),
    });

    expect(output.recommendation.decision).toBe("escalate");
    expect(output.recommendation.rationale).toContain("cites no source");
  });

  it("escalates when the policy refuses a `proceed` with an open risk flag", () => {
    const output = decideVerifiedTriage({
      triage: triage("proceed", [OPEN_FLAG]),
      verification: verification(true),
    });

    expect(output.recommendation.decision).toBe("escalate");
    expect(output.recommendation.rationale).toContain("no-proceed-with-open-risk-flags");
  });

  it("leaves an open risk flag beside a recommendation that keeps a human in the loop", () => {
    const input = {
      triage: triage("proceed_with_conditions", [OPEN_FLAG]),
      verification: verification(true),
    };

    // The policy allows the other three outcomes with flags open, because each
    // of them leaves someone to act on the flag.
    expect(decideVerifiedTriage(input)).toEqual(input.triage);
  });

  it("never edits the record it escalates with", () => {
    const original = triage("proceed", [OPEN_FLAG]);
    const output = decideVerifiedTriage({ triage: original, verification: verification(false) });

    expect(output.riskFlags).toEqual(original.riskFlags);
    expect(output.missingInformation).toEqual(original.missingInformation);
    expect(output.evidence).toEqual(original.evidence);
    expect(output.category).toBe(original.category);
  });

  it("is pure: the same input produces a deeply equal output", () => {
    const input = { triage: triage("proceed", [OPEN_FLAG]), verification: verification(true) };

    expect(decideVerifiedTriage(input)).toEqual(decideVerifiedTriage(input));
  });
});
