import { ValidationError, validateWith } from "@internal/core";
import { describe, expect, it } from "vitest";
import { vendorTriage } from "./index.js";
import { PROCUREMENT_SOP } from "./procurement-sop.js";
import type { VendorTriageInput, VendorTriageOutput } from "./schemas.js";

/**
 * The example domain's unit tests. No model call is made here and none can be:
 * nothing in this file touches `eve`, and the domain definition is data plus
 * two schemas.
 *
 * These are also where Milestone 1's "input is validated" and "one
 * intentionally invalid output fails closed" criteria are proven at the schema
 * level. The end-to-end versions, through `createHarness()`, belong to M1-T4.
 */

const VALID_INPUT: VendorTriageInput = {
  vendorName: "Northwind Ledger",
  procurementSop: PROCUREMENT_SOP,
};

const VALID_OUTPUT: VendorTriageOutput = {
  category: "finance and accounting",
  riskFlags: [
    {
      clause: "3. Data residency and retention",
      concern: "The retention period after termination is stated only in a questionnaire reply.",
      evidence: "vendor questionnaire response, captured 2026-09-02",
    },
  ],
  missingInformation: ["A company registration number is not published."],
  recommendation: {
    decision: "proceed_with_conditions",
    rationale: "Security assurance and the DPA are evidenced; two SOP items need confirmation.",
    conditions: ["The finance director confirms the registration number before signature."],
  },
  evidence: [
    { claim: "SOC 2 Type II is held.", source: "vendor website, /security" },
    { claim: "A DPA with SCCs is published.", source: "vendor website, /legal/dpa" },
  ],
};

describe("vendorTriage", () => {
  it("is registered with the id and version the milestone names", () => {
    expect(vendorTriage.id).toBe("vendor-triage");
    expect(vendorTriage.version).toBe("1.0.0");
  });

  it("carries its fixture evals", () => {
    expect(vendorTriage.evals.map((item) => item.id)).toEqual([
      "northwind-ledger-well-documented",
      "cobalt-harbor-payment-change",
    ]);
  });

  it("builds a job that names its domain, contracts, budget and permissions", () => {
    const job = vendorTriage.createJob(VALID_INPUT);

    expect(job.domain).toEqual({ id: "vendor-triage", version: "1.0.0" });
    expect(job.jobType).toBe("vendor-triage");
    expect(job.objective).toContain("Northwind Ledger");
    expect(job.contracts).toEqual({
      inputSchema: "vendor-triage.input@1.0.0",
      outputSchema: "vendor-triage.output@1.0.0",
      sop: "procurement-sop",
    });
    expect(job.budget.maxModelCalls).toBe(8);
    expect(job.permissions).toEqual([{ toolId: "lookup_vendor_evidence", mode: "read" }]);
  });
});

describe("vendorTriage input schema", () => {
  it("accepts a valid input and returns it parsed", async () => {
    await expect(validateWith(vendorTriage.inputSchema, VALID_INPUT)).resolves.toEqual(VALID_INPUT);
  });

  it("accepts the optional evidence text", async () => {
    const withEvidence = { ...VALID_INPUT, evidenceText: "Their security page says SOC 2." };

    await expect(validateWith(vendorTriage.inputSchema, withEvidence)).resolves.toEqual(
      withEvidence,
    );
  });

  it("rejects an empty vendor name, pointing the issue at the field", async () => {
    const error = (await validateWith(
      vendorTriage.inputSchema,
      { ...VALID_INPUT, vendorName: "" },
      { label: "vendor-triage job input" },
    ).catch((thrown: unknown) => thrown)) as ValidationError;

    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).toBe("vendor-triage job input failed validation");
    expect(error.issues.map((issue) => issue.path)).toEqual([["vendorName"]]);
  });

  it("rejects a missing procurement SOP", async () => {
    const { procurementSop: _omitted, ...withoutSop } = VALID_INPUT;

    const error = (await validateWith(vendorTriage.inputSchema, withoutSop).catch(
      (thrown: unknown) => thrown,
    )) as ValidationError;

    expect(error.issues.map((issue) => issue.path)).toEqual([["procurementSop"]]);
  });
});

describe("vendorTriage output schema", () => {
  it("accepts a well-formed triage", async () => {
    await expect(validateWith(vendorTriage.outputSchema, VALID_OUTPUT)).resolves.toEqual(
      VALID_OUTPUT,
    );
  });

  it("fails closed on an output that invents a decision the SOP does not allow", async () => {
    const invalid = {
      ...VALID_OUTPUT,
      recommendation: { ...VALID_OUTPUT.recommendation, decision: "approved_and_signed" },
    };

    const error = (await validateWith(vendorTriage.outputSchema, invalid, {
      label: "vendor-triage agent output",
    }).catch((thrown: unknown) => thrown)) as ValidationError;

    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).toBe("vendor-triage agent output failed validation");
    expect(error.issues.map((issue) => issue.path)).toEqual([["recommendation", "decision"]]);
  });

  it("fails closed on a risk flag that cites no evidence", async () => {
    const invalid = {
      ...VALID_OUTPUT,
      riskFlags: [{ clause: "5. Payment integrity", concern: "Bank details changed." }],
    };

    const error = (await validateWith(vendorTriage.outputSchema, invalid).catch(
      (thrown: unknown) => thrown,
    )) as ValidationError;

    expect(error.issues.map((issue) => issue.path)).toEqual([["riskFlags", 0, "evidence"]]);
  });

  it("fails closed on a triage that cites nothing at all", async () => {
    const invalid = { ...VALID_OUTPUT, evidence: [] };

    await expect(validateWith(vendorTriage.outputSchema, invalid)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});
