import { validateWith } from "@internal/core";
import { describe, expect, it } from "vitest";
import { PROCUREMENT_SOP } from "../domain/procurement-sop.js";
import {
  type VendorTriageClassification,
  type VendorTriageFinalizeInput,
  vendorTriageOutputSchema,
} from "../domain/schemas.js";
import { finalizeClearTriage } from "./finalize-clear-triage.js";

/**
 * The `finalize` node's handler (M4-T10).
 *
 * The property that matters most is the last one: whatever it is given, it
 * produces a value the domain's own output schema accepts. A `code` node's
 * output is validated by the runtime, so a handler that can produce an invalid
 * output turns a deterministic route into an escalation.
 */

/**
 * A classification of the shape the `clear` route carries (M3-T8).
 *
 * The `jev` node's output is now a judgment plus the policy's route rather than
 * prose: `answers.category` is the SOP category the `vendor-triage.category`
 * question chose, and `route` is what the policy decided to do about it.
 */
function classification(
  category = "finance and accounting",
  route: string | null = "clear",
): VendorTriageClassification {
  return {
    answer: category,
    confidence: 0.95,
    band: "auto",
    distribution: { [category]: 0.95 },
    decisionId: "01a0c0a0-3d14-7000-8bad-000000000001",
    route,
    reasons: [
      "the vendor is confidently low risk (0.94) and the evidence is confidently sufficient (0.92)",
    ],
    answers: { lowRisk: true, category, evidenceSufficient: true },
  };
}

/** The composite input the workflow's `object` binding builds. */
function finalizeInput(
  vendorName: string,
  category = "finance and accounting",
): VendorTriageFinalizeInput {
  return {
    classification: classification(category),
    request: { vendorName, procurementSop: PROCUREMENT_SOP },
  };
}

describe("finalizeClearTriage", () => {
  it("categorizes a vendor by the category the decision chose, in the SOP's vocabulary", () => {
    // Since M3-T8 the category is a **judgment** carried on the classification,
    // not a string lifted out of the fixture's stated offering.
    expect(finalizeClearTriage(finalizeInput("Northwind Ledger")).category).toBe(
      "finance and accounting",
    );
  });

  it("names the one SOP requirement Northwind Ledger's evidence leaves unestablished", () => {
    const output = finalizeClearTriage(finalizeInput("Northwind Ledger"));

    expect(output.missingInformation).toHaveLength(1);
    expect(output.missingInformation[0]).toContain("company registration number");
  });

  it("recommends conditions rather than an unconditional proceed while anything is unestablished", () => {
    const output = finalizeClearTriage(finalizeInput("Northwind Ledger"));

    expect(output.recommendation.decision).toBe("proceed_with_conditions");
    expect(output.recommendation.conditions).toHaveLength(1);
  });

  it("cites one evidence item per document actually on file", () => {
    const output = finalizeClearTriage(finalizeInput("Northwind Ledger"));

    expect(output.evidence).toHaveLength(4);
    expect(output.evidence[0]?.source).toBe("vendor website, /product (captured 2026-09-01)");
  });

  it("raises the payment-detail risk flag when the evidence carries one", () => {
    const output = finalizeClearTriage(finalizeInput("Cobalt Harbor Logistics"));

    expect(output.riskFlags).toHaveLength(1);
    expect(output.riskFlags[0]?.concern).toContain("banking details");
    // The policy's rule, honoured by construction: an open risk flag means no
    // unconditional `proceed`.
    expect(output.recommendation.decision).not.toBe("proceed");
  });

  it("asks for information rather than inventing it when the vendor is not on file", () => {
    const output = finalizeClearTriage(finalizeInput("Aurelia Freight"));

    expect(output.recommendation.decision).toBe("request_information");
    expect(output.missingInformation[0]).toContain("Northwind Ledger");
    expect(output.riskFlags).toHaveLength(0);
  });

  it("is pure: the same input produces a deeply equal output", () => {
    expect(finalizeClearTriage(finalizeInput("Tessellate Analytics"))).toEqual(
      finalizeClearTriage(finalizeInput("Tessellate Analytics")),
    );
  });

  it("produces a valid `vendor-triage.output` for every fixture vendor and for an unknown one", async () => {
    for (const vendorName of [
      "Northwind Ledger",
      "Tessellate Analytics",
      "Cobalt Harbor Logistics",
      "Aurelia Freight",
    ]) {
      await expect(
        validateWith(vendorTriageOutputSchema, finalizeClearTriage(finalizeInput(vendorName)), {
          label: `finalize(${vendorName})`,
        }),
      ).resolves.toBeDefined();
    }
  });
});
