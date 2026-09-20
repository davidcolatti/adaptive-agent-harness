import { describe, expect, it } from "vitest";
import { PROCUREMENT_SOP } from "../domain/procurement-sop.js";
import {
  createVendorDecisionEngine,
  hasGatewayCredential,
  resolveDecisionEngine,
} from "./engine.js";
import { EVIDENCE_SUPPORTS_QUESTION, TRIAGE_QUESTIONS } from "./questions.js";
import { createTriagePolicy } from "./triage-policy.js";

/**
 * The example agent's engine selection and its credential-free fixture engine
 * (M3-T8).
 *
 * The cases that matter most are the three demo routes: `pnpm example:run:mock
 * -- --workflow` with each of three vendors has to reach `clear`, `research`
 * and the escalation exactly as it did under M4-T10's placeholder port, or
 * replacing the placeholder changed the demo rather than the implementation.
 */

function request(vendorName?: string): { readonly [key: string]: string } {
  return vendorName === undefined
    ? { procurementSop: PROCUREMENT_SOP }
    : { vendorName, procurementSop: PROCUREMENT_SOP };
}

/** Ask the three questions about one vendor and route the answers. */
async function route(vendorName?: string): Promise<string> {
  const result = await createVendorDecisionEngine().evaluate({
    state: request(vendorName),
    questions: TRIAGE_QUESTIONS,
  });

  return createTriagePolicy().evaluate(result).route;
}

describe("createVendorDecisionEngine", () => {
  it("keeps the three demo routes the M4-T10 placeholder produced", async () => {
    expect(await route("Northwind Ledger")).toBe("clear");
    expect(await route("Tessellate Analytics")).toBe("research");
    expect(await route("Cobalt Harbor Logistics")).toBe("research");
    expect(await route("Aurelia Freight")).toBe("uncertain");
    expect(await route()).toBe("uncertain");
  });

  it("answers the vendor's SOP category from what it sells, not from what happened to it", async () => {
    // Cobalt Harbor's evidence contains an invoice dispute. A rule that read
    // the documents first would file a freight forwarder under finance.
    const result = await createVendorDecisionEngine().evaluate({
      state: request("Cobalt Harbor Logistics"),
      questions: TRIAGE_QUESTIONS,
    });

    expect(result.answers.category?.value).toBe("logistics and freight");
  });

  it("answers all three questions in one call, because they share one state", async () => {
    const result = await createVendorDecisionEngine().evaluate({
      state: request("Northwind Ledger"),
      questions: TRIAGE_QUESTIONS,
    });

    expect(Object.keys(result.answers)).toStrictEqual([
      "lowRisk",
      "category",
      "evidenceSufficient",
    ]);
  });

  it("reports a flat distribution for a vendor with no evidence, rather than guessing", async () => {
    const result = await createVendorDecisionEngine().evaluate({
      state: request("Aurelia Freight"),
      questions: TRIAGE_QUESTIONS,
    });

    // Confidence 0.2 over five equally likely categories: the honest statement
    // that nothing is established, and the reason the policy escalates.
    expect(result.answers.category?.confidence).toBeCloseTo(0.2, 10);
  });

  it("reports no cost, because the evaluation API exposes none", async () => {
    const result = await createVendorDecisionEngine().evaluate({
      state: request("Northwind Ledger"),
      questions: TRIAGE_QUESTIONS,
    });

    expect(result.usage.costUsd).toBeNull();
    expect(result.model).toEqual({ provider: "fixture", modelId: "vendor-triage-fixture" });
  });

  it("is deterministic: the same request twice produces the same answers", async () => {
    const first = await createVendorDecisionEngine().evaluate({
      state: request("Tessellate Analytics"),
      questions: TRIAGE_QUESTIONS,
    });
    const second = await createVendorDecisionEngine().evaluate({
      state: request("Tessellate Analytics"),
      questions: TRIAGE_QUESTIONS,
    });

    // Everything but the minted decision id, which is a fresh UUIDv7 by design.
    expect(second.answers).toEqual(first.answers);
    expect(second.stateFingerprint).toBe(first.stateFingerprint);
  });

  it("answers the verification question from what a triage cites", async () => {
    const supports = await createVendorDecisionEngine().evaluate({
      state: { evidence: [{ claim: "x", source: "vendor website, /about" }] },
      questions: { supported: EVIDENCE_SUPPORTS_QUESTION },
    });
    const doesNot = await createVendorDecisionEngine().evaluate({
      state: { evidence: [] },
      questions: { supported: EVIDENCE_SUPPORTS_QUESTION },
    });

    expect(supports.answers.supported?.value).toBe(true);
    expect(doesNot.answers.supported?.value).toBe(false);
  });

  it("answers from a supplied evidence universe, so a calibration set can extend it", async () => {
    const engine = createVendorDecisionEngine({
      vendors: [
        {
          vendorName: "Synthetic Books",
          website: "https://synthetic-books.example",
          statedOffering: "Bookkeeping for small teams.",
          documents: [
            {
              source: "vendor website, /security",
              capturedOn: "2026-09-10",
              text: "We hold a SOC 2 Type II report and publish a data processing agreement.",
            },
          ],
        },
      ],
    });

    const result = await engine.evaluate({
      state: request("Synthetic Books"),
      questions: TRIAGE_QUESTIONS,
    });

    expect(result.answers.category?.value).toBe("finance and accounting");
    expect(createTriagePolicy().evaluate(result).route).toBe("clear");
  });
});

describe("resolveDecisionEngine", () => {
  it("chooses the fixture engine with no credential, and says so", () => {
    const resolved = resolveDecisionEngine({});

    expect(resolved.kind).toBe("fixture");
    expect(resolved.description).toContain("AI_GATEWAY_API_KEY");
  });

  it("chooses live Jev when either credential is present", () => {
    for (const name of ["AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN"]) {
      const resolved = resolveDecisionEngine({ [name]: "a-value" });

      expect(resolved.kind).toBe("jev");
      expect(resolved.description).toContain("typesafe-ai/jev");
    }
  });

  it("treats an empty credential as absent, rather than as configured", () => {
    expect(hasGatewayCredential({ AI_GATEWAY_API_KEY: "" })).toBe(false);
    expect(hasGatewayCredential({ AI_GATEWAY_API_KEY: "x" })).toBe(true);
  });
});
