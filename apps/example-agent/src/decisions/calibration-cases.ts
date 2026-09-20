import {
  VENDOR_EVIDENCE_FIXTURES,
  type VendorEvidenceRecord,
} from "../../agent/lib/vendor-fixtures.js";
import { PROCUREMENT_SOP } from "../domain/procurement-sop.js";
import type { CalibrationCase } from "./calibration.js";
import type { TriageRoute } from "./triage-policy.js";

/**
 * The labeled set behind `pnpm --filter @internal/example-agent run calibrate`
 * (M3-T9).
 *
 * **The three frozen demo vendors are not enough on their own**, and that is
 * the whole reason this file exists. A labeled set of three cases, each of
 * which the fixture engine was built around, reports 100% accuracy and tells
 * nobody anything. The eleven synthetic vendors below are variations on the
 * three — a well-documented one in each category, one missing each of the SOP's
 * requirements, one with the payment-integrity flag — so the set exercises each
 * route several times and through several causes.
 *
 * Every vendor here is fictional and every document is invented, exactly as
 * `vendor-fixtures.ts` says of its three. Nothing is fetched.
 *
 * **The labels are the SOP's judgment, not the engine's.** Each case says what
 * a careful procurement reviewer would decide, and the report says how often
 * the engine and the policy agree. A case whose label was copied from what the
 * engine happens to do would make the accuracy number meaningless.
 */

/** One synthetic vendor, written compactly. */
function vendor(
  vendorName: string,
  statedOffering: string,
  documents: readonly (readonly [string, string])[],
): VendorEvidenceRecord {
  return {
    vendorName,
    website: `https://${vendorName.toLowerCase().replaceAll(/\s+/gu, "-")}.example`,
    statedOffering,
    documents: documents.map(([source, text]) => ({
      source,
      capturedOn: "2026-09-10",
      text,
    })),
  };
}

/** The evidence every SOP requirement needs, in one document. */
const COMPLETE_ASSURANCE =
  "We hold a SOC 2 Type II report covering security and availability, renewed annually. A standard data processing agreement is published with standard contractual clauses and a named sub-processor list. Production data is stored in the EU (Ireland) and is deleted within thirty days of contract termination on written request. Company registration number 09 442 118, registered at 4 Harbour Row. The published uptime commitment is 99.9% monthly and support is 09:00-18:00 CET.";

/**
 * Eleven synthetic vendors, added to the three frozen ones.
 *
 * Each one differs from `COMPLETE_ASSURANCE` in exactly one way, so a
 * miscalibration shows up attached to a cause rather than to a vendor.
 */
export const SYNTHETIC_VENDORS: readonly VendorEvidenceRecord[] = [
  vendor("Quillstone Books", "Bookkeeping and invoice reconciliation for agencies.", [
    ["vendor website, /security", COMPLETE_ASSURANCE],
  ]),
  vendor("Lattice Insight", "Product usage analytics and funnel reporting.", [
    ["vendor website, /security", COMPLETE_ASSURANCE],
  ]),
  vendor("Sentinel Watchtower", "Security monitoring and vulnerability management.", [
    ["vendor website, /security", COMPLETE_ASSURANCE],
  ]),
  vendor("Westmoor Depot", "Warehousing and regional freight consolidation.", [
    ["vendor website, /security", COMPLETE_ASSURANCE],
  ]),
  vendor("Meridian Signals", "Product analytics with session replay.", [
    [
      "vendor website, /security",
      "We completed a SOC 2 Type I assessment this year; a Type II window is in progress. A data processing agreement is published with a named sub-processor list. Data is stored in the EU and deleted within thirty days. Company registration number 11 208 776. Uptime 99.9%, support 09:00-17:00.",
    ],
  ]),
  vendor("Verdant Payroll", "Payroll and expense reconciliation.", [
    [
      "vendor website, /security",
      "We hold a SOC 2 Type II report, renewed annually. There is no data processing agreement published on this site. Data is stored in the EU and deleted within thirty days. Company registration number 07 991 004. Uptime 99.9%, support 09:00-18:00.",
    ],
  ]),
  vendor("Harborlight Customs", "Customs brokerage and freight forwarding.", [
    [
      "vendor website, /about",
      "We file customs paperwork for shippers across three regional ports. There is no company registration number on the site, and no registered address is given.",
    ],
    ["vendor website, /security", COMPLETE_ASSURANCE],
  ]),
  vendor("Pinnacle Vaults", "Secrets management and identity provider integration.", [
    [
      "vendor website, /sitemap",
      "The site has a security page and a status page. There is no privacy policy and no published terms of service.",
    ],
    ["vendor website, /security", COMPLETE_ASSURANCE],
  ]),
  vendor("Ironvale Freight", "Palletized freight between inland depots.", [
    ["vendor website, /security", COMPLETE_ASSURANCE],
    [
      "inbound email to accounts payable",
      "An email signed by the account manager asks that the next invoice be paid to a new bank account at a different bank, and asks for the change to be applied before the invoice is issued. The request arrived from a free email domain rather than the vendor's own domain.",
    ],
  ]),
  vendor("Solace Reconcile", "Bank feed reconciliation for finance teams.", [
    ["vendor website, /security", COMPLETE_ASSURANCE],
  ]),
  vendor("Calderwood Ledger", "Expense and ledger management.", [
    ["vendor website, /security", COMPLETE_ASSURANCE],
  ]),
];

/**
 * The evidence universe a calibration run answers from: the frozen three plus
 * the synthetic eleven.
 *
 * `createVendorDecisionEngine({ vendors: CALIBRATION_VENDORS })` is how a run
 * uses it. The three frozen records are **unchanged**, so a calibration run and
 * a demo run see the same evidence for the same vendor.
 */
export const CALIBRATION_VENDORS: readonly VendorEvidenceRecord[] = [
  ...VENDOR_EVIDENCE_FIXTURES,
  ...SYNTHETIC_VENDORS,
];

/** Build one case's state: the job input the `classify` node would receive. */
function triageOf(vendorName: string): { readonly [key: string]: string } {
  return { vendorName, procurementSop: PROCUREMENT_SOP };
}

/**
 * Fifteen labeled cases.
 *
 * | Expected route | Cases | Why |
 * | --- | --- | --- |
 * | `clear` | 6 | every SOP requirement established, nothing that needs reading |
 * | `research` | 7 | one requirement contradicted, absent, or a payment flag raised |
 * | `uncertain` | 2 | no evidence on file at all, or no vendor named |
 */
export const CALIBRATION_CASES: readonly CalibrationCase<TriageRoute>[] = [
  {
    id: "northwind-ledger",
    description: "The frozen well-documented finance vendor: the demo's `clear` route.",
    state: triageOf("Northwind Ledger"),
    expectedRoute: "clear",
    expectedAnswers: {
      lowRisk: true,
      category: "finance and accounting",
      evidenceSufficient: true,
    },
  },
  {
    id: "tessellate-analytics",
    description: "The frozen partly-documented analytics vendor: the demo's `research` route.",
    state: triageOf("Tessellate Analytics"),
    expectedRoute: "research",
    expectedAnswers: {
      lowRisk: false,
      category: "product analytics",
      evidenceSufficient: false,
    },
  },
  {
    id: "cobalt-harbor-logistics",
    description: "The frozen thinly-documented freight vendor with a payment-integrity flag.",
    state: triageOf("Cobalt Harbor Logistics"),
    expectedRoute: "research",
    expectedAnswers: {
      lowRisk: false,
      category: "logistics and freight",
      evidenceSufficient: false,
    },
  },
  {
    id: "aurelia-freight",
    description: "Not on file at all: the demo's escalation route.",
    state: triageOf("Aurelia Freight"),
    expectedRoute: "uncertain",
  },
  {
    id: "no-vendor-named",
    description: "A request that names no vendor: nothing can be classified.",
    state: { procurementSop: PROCUREMENT_SOP },
    expectedRoute: "uncertain",
  },
  {
    id: "quillstone-books",
    description: "A complete finance vendor. Every SOP requirement established.",
    state: triageOf("Quillstone Books"),
    expectedRoute: "clear",
    expectedAnswers: {
      lowRisk: true,
      category: "finance and accounting",
      evidenceSufficient: true,
    },
  },
  {
    id: "lattice-insight",
    description: "A complete analytics vendor, to prove the category does not drive the route.",
    state: triageOf("Lattice Insight"),
    expectedRoute: "clear",
    expectedAnswers: { lowRisk: true, category: "product analytics", evidenceSufficient: true },
  },
  {
    id: "sentinel-watchtower",
    description: "A complete security-tooling vendor: the fourth category, represented.",
    state: triageOf("Sentinel Watchtower"),
    expectedRoute: "clear",
    expectedAnswers: { lowRisk: true, category: "security tooling", evidenceSufficient: true },
  },
  {
    id: "westmoor-depot",
    description: "A complete freight vendor, so `logistics and freight` is not always `research`.",
    state: triageOf("Westmoor Depot"),
    expectedRoute: "clear",
    expectedAnswers: {
      lowRisk: true,
      category: "logistics and freight",
      evidenceSufficient: true,
    },
  },
  {
    id: "solace-reconcile",
    description: "A second complete finance vendor, so `clear` is not a single case.",
    state: triageOf("Solace Reconcile"),
    expectedRoute: "clear",
    expectedAnswers: {
      lowRisk: true,
      category: "finance and accounting",
      evidenceSufficient: true,
    },
  },
  {
    id: "calderwood-ledger",
    description: "A third complete finance vendor.",
    state: triageOf("Calderwood Ledger"),
    expectedRoute: "clear",
    expectedAnswers: {
      lowRisk: true,
      category: "finance and accounting",
      evidenceSufficient: true,
    },
  },
  {
    id: "meridian-signals",
    description:
      "SOP requirement 1 met only at Type I: the assurance is not what the SOP asks for.",
    state: triageOf("Meridian Signals"),
    expectedRoute: "research",
    expectedAnswers: { lowRisk: false, category: "product analytics", evidenceSufficient: false },
  },
  {
    id: "verdant-payroll",
    description: "SOP requirement 2 absent: no published data processing agreement.",
    state: triageOf("Verdant Payroll"),
    expectedRoute: "research",
    expectedAnswers: {
      lowRisk: false,
      category: "finance and accounting",
      evidenceSufficient: false,
    },
  },
  {
    id: "harborlight-customs",
    description: "SOP requirement 4 absent: no company registration number.",
    state: triageOf("Harborlight Customs"),
    expectedRoute: "research",
    expectedAnswers: {
      lowRisk: false,
      category: "logistics and freight",
      evidenceSufficient: false,
    },
  },
  {
    id: "pinnacle-vaults",
    description: "No privacy policy and no published terms: the paperwork needs reading.",
    state: triageOf("Pinnacle Vaults"),
    expectedRoute: "research",
    expectedAnswers: { lowRisk: false, category: "security tooling", evidenceSufficient: false },
  },
  {
    id: "ironvale-freight",
    description:
      "SOP requirement 5: an unverified banking-detail change. Complete paperwork does not make this `clear`.",
    state: triageOf("Ironvale Freight"),
    expectedRoute: "research",
    expectedAnswers: {
      lowRisk: false,
      category: "logistics and freight",
      evidenceSufficient: false,
    },
  },
];
