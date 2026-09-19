/**
 * Frozen fixture evidence for the vendor-triage example domain.
 *
 * Every vendor below is fictional and every document is invented. Nothing here
 * describes a real company, and nothing here is fetched: the milestone's
 * instruction is "use deterministic local fixture tools before adding live web
 * research" (`docs/milestones/build-plan.md`, Milestone 1, Neutral Reference
 * Job), so this module is the whole evidence universe the example agent has.
 *
 * `eve` treats `agent/lib/` as import-only shared authored code
 * (`eve/docs/reference/agent-files.md`, "Agent files and directories"), which is
 * why the data and the lookup live here rather than inside the tool module.
 *
 * The three records are deliberately different in quality, so the agent has
 * something to triage rather than something to rubber-stamp:
 *
 * - `Northwind Ledger` is well documented and should triage cleanly.
 * - `Tessellate Analytics` is partly documented; the gaps are the interesting
 *   part, because the domain's output includes "missing information".
 * - `Cobalt Harbor Logistics` is thinly documented and carries an obvious
 *   payment-change risk flag.
 */

/** One piece of frozen evidence about a vendor. */
export interface VendorEvidenceDocument {
  /** Where the text came from, written the way a reviewer would cite it. */
  readonly source: string;
  /** Frozen capture date. Fixture evidence never changes, so neither does this. */
  readonly capturedOn: string;
  /** The evidence itself. */
  readonly text: string;
}

/** Everything the fixture knows about one vendor. */
export interface VendorEvidenceRecord {
  /** The vendor's name as it appears in the fixture. */
  readonly vendorName: string;
  /** The vendor's (fictional) website. */
  readonly website: string;
  /** What the vendor sells, in one line, as captured from its own site. */
  readonly statedOffering: string;
  /** The frozen evidence documents, in capture order. */
  readonly documents: readonly VendorEvidenceDocument[];
}

export const VENDOR_EVIDENCE_FIXTURES: readonly VendorEvidenceRecord[] = [
  {
    vendorName: "Northwind Ledger",
    website: "https://northwind-ledger.example",
    statedOffering: "Cloud bookkeeping and expense reconciliation for small finance teams.",
    documents: [
      {
        source: "vendor website, /product",
        capturedOn: "2026-09-01",
        text: "Northwind Ledger reconciles bank feeds and expense claims for teams of five to two hundred. Customers connect a read-only bank feed; Northwind Ledger never initiates payments.",
      },
      {
        source: "vendor website, /security",
        capturedOn: "2026-09-01",
        text: "We hold a SOC 2 Type II report covering security and availability, renewed annually and available under NDA. Data is encrypted in transit and at rest. Production data is stored in the EU (Ireland) and is not replicated outside the region.",
      },
      {
        source: "vendor website, /legal/dpa",
        capturedOn: "2026-09-01",
        text: "A standard data processing agreement is published, including standard contractual clauses and a named sub-processor list: one cloud host, one email delivery provider, one error-tracking provider. Sub-processor changes are announced thirty days in advance.",
      },
      {
        source: "vendor questionnaire response",
        capturedOn: "2026-09-02",
        text: "Support is 09:00-18:00 CET on business days. The published uptime commitment is 99.9% monthly. Customer data is deleted within thirty days of contract termination on written request.",
      },
    ],
  },
  {
    vendorName: "Tessellate Analytics",
    website: "https://tessellate-analytics.example",
    statedOffering: "Product usage analytics with session replay.",
    documents: [
      {
        source: "vendor website, /product",
        capturedOn: "2026-09-03",
        text: "Tessellate Analytics records product events and optional session replays, and reports funnels and retention. Session replay is enabled by default on new workspaces.",
      },
      {
        source: "vendor website, /security",
        capturedOn: "2026-09-03",
        text: "We completed a SOC 2 Type I assessment this year. A Type II observation window is described as in progress, with no completion date given. The page does not name a hosting region or a data retention period.",
      },
      {
        source: "vendor sales email",
        capturedOn: "2026-09-04",
        text: "Our team confirmed that personal data can be excluded from session replay through a configuration flag, but did not say whether the flag is on by default or how masking is verified. No data processing agreement was attached and none is published on the site.",
      },
    ],
  },
  {
    vendorName: "Cobalt Harbor Logistics",
    website: "https://cobalt-harbor.example",
    statedOffering: "Regional freight forwarding and customs brokerage.",
    documents: [
      {
        source: "vendor website, /about",
        capturedOn: "2026-09-05",
        text: "Cobalt Harbor Logistics moves palletized freight between regional ports and inland depots, and files customs paperwork on behalf of shippers. The site lists a single office address and no company registration number.",
      },
      {
        source: "vendor website sitemap",
        capturedOn: "2026-09-05",
        text: "The site has no security page, no privacy policy, and no published terms of service. A contact form is the only listed channel.",
      },
      {
        source: "inbound email to accounts payable",
        capturedOn: "2026-09-08",
        text: "An email signed by the account manager asks that the next invoice be paid to a new bank account at a different bank, and asks for the change to be applied before the invoice is issued. The request arrived from a free email domain rather than the vendor's own domain.",
      },
    ],
  },
];
