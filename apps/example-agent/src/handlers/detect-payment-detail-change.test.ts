import { describe, expect, it } from "vitest";
import { VENDOR_EVIDENCE_FIXTURES } from "../../agent/lib/vendor-fixtures.js";
import { detectPaymentDetailChange } from "./detect-payment-detail-change.js";

function fixture(vendorName: string) {
  const record = VENDOR_EVIDENCE_FIXTURES.find((entry) => entry.vendorName === vendorName);
  if (record === undefined) {
    throw new Error(`fixture \`${vendorName}\` is missing`);
  }
  return record;
}

describe("detectPaymentDetailChange", () => {
  it("flags Cobalt Harbor's unverified banking-detail change", () => {
    const flag = detectPaymentDetailChange(fixture("Cobalt Harbor Logistics"));

    expect(flag).not.toBeNull();
    expect(flag?.clause).toContain("Payment detail changes");
    expect(flag?.concern).toContain("Cobalt Harbor Logistics");
    expect(flag?.evidence).toBe("inbound email to accounts payable (captured 2026-09-08)");
  });

  it("does not flag the well-documented vendor", () => {
    expect(detectPaymentDetailChange(fixture("Northwind Ledger"))).toBeNull();
  });

  it("does not flag the partly-documented vendor either", () => {
    // Tessellate's gaps are real, but none of them is a payment-detail change.
    // A handler that fired here would be guessing, which is exactly what the
    // full agent is still for.
    expect(detectPaymentDetailChange(fixture("Tessellate Analytics"))).toBeNull();
  });

  it("is pure: the same record always produces the same flag", () => {
    const record = fixture("Cobalt Harbor Logistics");
    expect(detectPaymentDetailChange(record)).toEqual(detectPaymentDetailChange(record));
  });

  it("returns null for a vendor with no documents at all", () => {
    expect(
      detectPaymentDetailChange({
        vendorName: "Empty",
        website: "https://empty.example",
        statedOffering: "Nothing.",
        documents: [],
      }),
    ).toBeNull();
  });

  it("needs all three signals, not just a mention of a bank account", () => {
    const base = {
      vendorName: "Partial",
      website: "https://partial.example",
      statedOffering: "Nothing.",
    };

    // Banking details, but confirmed rather than changed.
    expect(
      detectPaymentDetailChange({
        ...base,
        documents: [
          {
            source: "vendor portal",
            capturedOn: "2026-09-01",
            text: "The bank account on file was confirmed by the vendor's finance team.",
          },
        ],
      }),
    ).toBeNull();

    // A change, from a verified channel.
    expect(
      detectPaymentDetailChange({
        ...base,
        documents: [
          {
            source: "vendor portal",
            capturedOn: "2026-09-01",
            text: "The vendor updated its bank account through the signed portal change process.",
          },
        ],
      }),
    ).toBeNull();
  });
});
