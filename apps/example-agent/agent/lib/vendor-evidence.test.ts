import { describe, expect, it } from "vitest";
import { knownVendorNames, lookupVendorEvidence } from "./vendor-evidence.js";
import { VENDOR_EVIDENCE_FIXTURES } from "./vendor-fixtures.js";

/**
 * The fixture lookup is the behaviour behind the `lookup_vendor_evidence` tool.
 * The tool module itself is not callable from a test: `defineTool` stamps a
 * brand that only eve's lifecycle code executes, and eve derives the tool's
 * identity from its file path, so there is no exported function to invoke. The
 * pure module is therefore what is tested, which is also what makes the tool's
 * "read-only, deterministic, offline" claim verifiable rather than asserted.
 *
 * No model is called here, and none may be: this is the `unit` layer.
 */

describe("lookupVendorEvidence", () => {
  it("returns the evidence on file for a known vendor", () => {
    const result = lookupVendorEvidence("Northwind Ledger");

    expect(result.status).toBe("found");
    if (result.status !== "found") {
      throw new Error("expected the known vendor to be found");
    }
    expect(result.vendor.vendorName).toBe("Northwind Ledger");
    expect(result.vendor.website).toBe("https://northwind-ledger.example");
    expect(result.vendor.documents.length).toBeGreaterThan(0);
    expect(result.vendor.documents.map((document) => document.source)).toContain(
      "vendor website, /security",
    );
  });

  it("is deterministic: the same name returns the same evidence every time", () => {
    expect(lookupVendorEvidence("Tessellate Analytics")).toEqual(
      lookupVendorEvidence("Tessellate Analytics"),
    );
  });

  it("matches a known vendor regardless of case and surrounding whitespace", () => {
    expect(lookupVendorEvidence("  cobalt   harbor logistics ")).toEqual(
      lookupVendorEvidence("Cobalt Harbor Logistics"),
    );
  });

  it("reports an unknown vendor as unknown and names the vendors it does hold", () => {
    const result = lookupVendorEvidence("Vendor That Is Not On File");

    expect(result.status).toBe("unknown");
    if (result.status !== "unknown") {
      throw new Error("expected an unknown vendor to be reported as unknown");
    }
    expect(result.requestedVendorName).toBe("Vendor That Is Not On File");
    expect(result.knownVendorNames).toEqual([
      "Northwind Ledger",
      "Tessellate Analytics",
      "Cobalt Harbor Logistics",
    ]);
  });

  it("does not fuzzy-match a near miss onto a real vendor", () => {
    expect(lookupVendorEvidence("Northwind").status).toBe("unknown");
    expect(lookupVendorEvidence("Northwind Ledger Inc.").status).toBe("unknown");
  });

  it("returns a JSON-serializable result, as eve requires of tool output", () => {
    const found = lookupVendorEvidence("Northwind Ledger");
    const unknown = lookupVendorEvidence("Nobody");

    expect(JSON.parse(JSON.stringify(found))).toEqual(found);
    expect(JSON.parse(JSON.stringify(unknown))).toEqual(unknown);
  });
});

describe("the vendor fixture data", () => {
  it("holds every vendor knownVendorNames reports, in fixture order", () => {
    expect(knownVendorNames()).toEqual(VENDOR_EVIDENCE_FIXTURES.map((r) => r.vendorName));
  });

  it("gives every vendor at least one captured evidence document", () => {
    for (const record of VENDOR_EVIDENCE_FIXTURES) {
      expect(record.documents.length, `${record.vendorName} has no evidence`).toBeGreaterThan(0);
      for (const document of record.documents) {
        expect(document.capturedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
        expect(document.text.length).toBeGreaterThan(0);
      }
    }
  });

  it("uses only reserved example domains, so no fixture points at a real site", () => {
    for (const record of VENDOR_EVIDENCE_FIXTURES) {
      expect(record.website, `${record.vendorName} website`).toMatch(
        /^https:\/\/[a-z0-9-]+\.example$/u,
      );
    }
  });
});
