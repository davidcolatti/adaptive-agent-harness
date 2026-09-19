import { describe, expect, it } from "vitest";
import type { VendorTriageOutput } from "../domain/schemas.js";
import { noProceedWithOpenRiskFlags } from "./no-proceed-with-open-risk-flags.js";

const RISK_FLAG = {
  clause: "Payment detail changes must be verified out of band.",
  concern: "An unverified banking-detail change is on file.",
  evidence: "inbound email to accounts payable",
};

function output(overrides: Partial<VendorTriageOutput> = {}): VendorTriageOutput {
  return {
    category: "freight forwarding",
    riskFlags: [],
    missingInformation: [],
    recommendation: { decision: "proceed", rationale: "Everything checks out." },
    evidence: [{ claim: "The vendor exists.", source: "vendor website, /about" }],
    ...overrides,
  };
}

describe("noProceedWithOpenRiskFlags", () => {
  it("allows `proceed` when no risk flag is open", () => {
    expect(noProceedWithOpenRiskFlags(output())).toEqual({ allowed: true });
  });

  it("refuses `proceed` while a risk flag is open, and says why", () => {
    const decision = noProceedWithOpenRiskFlags(output({ riskFlags: [RISK_FLAG] }));

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("1 risk flag is still open");
    expect(decision.reason).toContain(RISK_FLAG.concern);
  });

  it("pluralizes the reason for more than one flag", () => {
    const decision = noProceedWithOpenRiskFlags(
      output({ riskFlags: [RISK_FLAG, { ...RISK_FLAG, concern: "A second concern." }] }),
    );

    expect(decision.reason).toContain("2 risk flags are still open");
  });

  it("allows every other decision, because each leaves a human in the loop", () => {
    for (const decision of [
      "proceed_with_conditions",
      "request_information",
      "escalate",
    ] as const) {
      expect(
        noProceedWithOpenRiskFlags(
          output({
            riskFlags: [RISK_FLAG],
            recommendation: { decision, rationale: "There is an open concern." },
          }),
        ),
      ).toEqual({ allowed: true });
    }
  });
});
