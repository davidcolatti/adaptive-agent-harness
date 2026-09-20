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

/** A classification of the shape the `clear` route carries. */
function classification(vendorName: string): VendorTriageClassification {
  return {
    category: "clear",
    rationale: `The frozen evidence for ${vendorName} carries no indicator that needs a model's reading.`,
    vendorName,
  };
}

/** The composite input the workflow's `object` binding builds. */
function finalizeInput(vendorName: string): VendorTriageFinalizeInput {
  return {
    classification: classification(vendorName),
    request: { vendorName, procurementSop: PROCUREMENT_SOP },
  };
}

describe("finalizeClearTriage", () => {
  it("categorizes a vendor by what its own evidence says it sells", () => {
    expect(finalizeClearTriage(finalizeInput("Northwind Ledger")).category).toBe(
      "Cloud bookkeeping and expense reconciliation for small finance teams.",
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
