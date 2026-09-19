/**
 * The pure lookup behind the `lookup_vendor_evidence` tool.
 *
 * It is separated from `agent/tools/lookup_vendor_evidence.ts` for two reasons.
 * First, `eve` derives a tool's name and identity from its file path and
 * `defineTool` stamps a brand that only eve's lifecycle code may execute
 * (`eve/dist/src/tools/definition.d.ts`), so the tool module is not a function a
 * unit test can call. Second, keeping the decision logic pure is what makes the
 * "read-only, no side effects, no network" claim testable rather than asserted:
 * this module imports nothing but the frozen fixture data.
 */

import { VENDOR_EVIDENCE_FIXTURES, type VendorEvidenceRecord } from "./vendor-fixtures.js";

/** The result of looking a vendor up in the frozen fixture evidence. */
export type VendorEvidenceLookup =
  | {
      readonly status: "found";
      readonly vendor: VendorEvidenceRecord;
    }
  | {
      /**
       * The vendor is not in the fixture. This is a normal, documented result,
       * not an error: the domain's output includes "missing information", and a
       * triage that says "no evidence on file" is more useful than one that
       * invents some.
       */
      readonly status: "unknown";
      readonly requestedVendorName: string;
      /** Every vendor the fixture does know, so the caller can suggest one. */
      readonly knownVendorNames: readonly string[];
    };

/**
 * Normalize a vendor name for comparison: case-insensitive, with surrounding
 * and repeated whitespace collapsed. Deliberately conservative; it does not
 * strip legal suffixes or attempt fuzzy matching, because an approximate match
 * on a vendor name is exactly the kind of quiet guess this domain must not make.
 */
function normalizeVendorName(vendorName: string): string {
  return vendorName.trim().replaceAll(/\s+/gu, " ").toLowerCase();
}

/** Every vendor name the fixture holds, in fixture order. */
export function knownVendorNames(): readonly string[] {
  return VENDOR_EVIDENCE_FIXTURES.map((record) => record.vendorName);
}

/**
 * Look up the frozen evidence for one vendor.
 *
 * Deterministic and side-effect free: the same name always produces the same
 * result, and the function performs no I/O of any kind.
 */
export function lookupVendorEvidence(vendorName: string): VendorEvidenceLookup {
  const wanted = normalizeVendorName(vendorName);
  const vendor = VENDOR_EVIDENCE_FIXTURES.find(
    (record) => normalizeVendorName(record.vendorName) === wanted,
  );

  if (vendor === undefined) {
    return {
      status: "unknown",
      requestedVendorName: vendorName,
      knownVendorNames: knownVendorNames(),
    };
  }

  return { status: "found", vendor };
}
