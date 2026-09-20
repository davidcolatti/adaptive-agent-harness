import { lookupVendorEvidence } from "../../agent/lib/vendor-evidence.js";
import type { VendorEvidenceRecord } from "../../agent/lib/vendor-fixtures.js";
import type { VendorTriageFinalizeInput, VendorTriageOutput } from "../domain/schemas.js";
import { detectPaymentDetailChange } from "./detect-payment-detail-change.js";

/**
 * The `finalize` node of the hand-authored vendor workflow (M4-T10).
 *
 * It is the `clear` route: the classification step decided the frozen evidence
 * is good enough to triage without a model, so this function does the whole
 * triage in deterministic code. That is the last-but-one step of the
 * optimization target
 * `Full Agent -> Specialized Agent -> Jev Decision -> Deterministic Code -> Direct API Call`
 * applied to a real output rather than to a fragment of one.
 *
 * **Pure and total.** It reads its argument and the frozen fixture evidence, and
 * nothing else: no network, no filesystem, no clock, no environment. Every
 * input, including a vendor that is not on file, gets a valid
 * `vendor-triage.output`.
 *
 * It reads the **whole request**, not just the classification, which is why the
 * workflow binds it an explicit `{ kind: "object" }` binding: a `code` node
 * bound to the branch would receive the classification alone, and the vendor
 * name and the SOP live on the request.
 *
 * **It is deliberately conservative.** It never recommends an unconditional
 * `proceed` while anything the SOP requires is unestablished, and it never
 * invents evidence: every item it cites is a document that is actually on file.
 * A handler that guesses is worse than a full agent that reasons.
 */

/** One SOP requirement, and the terms that establish it in the evidence. */
interface SopRequirement {
  /** How the requirement is described when it is not established. */
  readonly missing: string;
  /**
   * Terms whose presence establishes it, lowercased.
   *
   * Every group must match: a requirement with two groups needs one term from
   * each, which is how "the hosting region **and** the retention period are
   * both stated" is expressed without a second entry.
   */
  readonly termGroups: readonly (readonly string[])[];
}

/**
 * The five SOP requirements this handler can check by reading text, in the
 * SOP's own order.
 *
 * The sixth, payment integrity, is not here: it is
 * {@link detectPaymentDetailChange}'s, which answers a different question — not
 * "is it established?" but "is it contradicted?" — and produces a risk flag
 * rather than a gap.
 */
const SOP_REQUIREMENTS: readonly SopRequirement[] = [
  {
    missing:
      "A current SOC 2 Type II report, or an equivalent independent assessment (SOP requirement 1, security assurance). A Type I report alone does not meet it.",
    termGroups: [["soc 2 type ii", "independent assessment"]],
  },
  {
    missing:
      "A published data processing agreement with standard contractual clauses and a named sub-processor list (SOP requirement 2).",
    termGroups: [["data processing agreement", "dpa"], ["sub-processor"]],
  },
  {
    missing:
      "The hosting region and the retention period after contract termination (SOP requirement 3, data residency and retention).",
    termGroups: [
      ["hosting region", "stored in", "data is stored"],
      ["retention", "deleted within"],
    ],
  },
  {
    missing:
      "A company registration number and a registered address (SOP requirement 4, corporate identity).",
    termGroups: [["registration number"]],
  },
  {
    missing:
      "A published uptime commitment and support hours (SOP requirement 6, service commitment).",
    termGroups: [["uptime"], ["support"]],
  },
];

/** Every document's text, lowercased and joined, which is what the terms are matched against. */
function evidenceText(vendor: VendorEvidenceRecord): string {
  return vendor.documents.map((document) => document.text.toLowerCase()).join("\n");
}

/** What the SOP requires that `vendor`'s evidence does not establish. */
function missingInformationFor(vendor: VendorEvidenceRecord): readonly string[] {
  const text = evidenceText(vendor);

  return SOP_REQUIREMENTS.filter(
    (requirement) =>
      !requirement.termGroups.every((group) => group.some((term) => text.includes(term))),
  ).map((requirement) => requirement.missing);
}

/**
 * The evidence a triage of `vendor` rests on: one item per document on file.
 *
 * The claim is the document's first sentence, because a reviewer checking a
 * citation wants to see what was read rather than a summary of it, and the
 * source is written the way `agent/instructions.md` asks for it.
 */
function evidenceFor(vendor: VendorEvidenceRecord): VendorTriageOutput["evidence"] {
  return vendor.documents.map((document) => {
    const sentenceEnd = document.text.indexOf(". ");

    return {
      claim: sentenceEnd === -1 ? document.text : document.text.slice(0, sentenceEnd + 1),
      source: `${document.source} (captured ${document.capturedOn})`,
    };
  });
}

/**
 * Finalize a clearly low-risk vendor from its classification and the original
 * request.
 *
 * ```ts
 * const output = finalizeClearTriage({ classification, request });
 * ```
 *
 * @returns a `vendor-triage.output`. A vendor that is not in the frozen fixture
 * evidence produces a `request_information` recommendation naming the vendors
 * that are, because "no evidence on file" is a documented result of the lookup
 * rather than an error, and a triage that says so is more useful than one that
 * invents evidence.
 */
export function finalizeClearTriage(input: VendorTriageFinalizeInput): VendorTriageOutput {
  const lookup = lookupVendorEvidence(input.request.vendorName);

  if (lookup.status === "unknown") {
    return {
      category: "other",
      riskFlags: [],
      missingInformation: [
        `No evidence is on file for ${input.request.vendorName}. The vendors on file are: ${lookup.knownVendorNames.join(", ")}.`,
      ],
      recommendation: {
        decision: "request_information",
        rationale: `The compiled path classified this request as \`${input.classification.category}\`, but no frozen evidence exists for ${input.request.vendorName}, so nothing about the SOP can be established.`,
      },
      evidence: [
        {
          claim: `The frozen vendor evidence holds no record for ${input.request.vendorName}.`,
          source: "apps/example-agent/agent/lib/vendor-fixtures.ts",
        },
      ],
    };
  }

  const { vendor } = lookup;
  const paymentFlag = detectPaymentDetailChange(vendor);
  const riskFlags = paymentFlag === null ? [] : [paymentFlag];
  const missingInformation = missingInformationFor(vendor);
  const clean = riskFlags.length === 0 && missingInformation.length === 0;

  return {
    category: vendor.statedOffering,
    riskFlags,
    missingInformation: [...missingInformation],
    recommendation: {
      decision: clean ? "proceed" : "proceed_with_conditions",
      rationale: clean
        ? `${input.classification.rationale} Every SOP requirement the frozen evidence can establish is established, and no risk flag is open.`
        : `${input.classification.rationale} The evidence leaves ${missingInformation.length} SOP requirement${missingInformation.length === 1 ? "" : "s"} unestablished and ${riskFlags.length} risk flag${riskFlags.length === 1 ? " is" : "s are"} open, so this may not proceed unconditionally.`,
      // Only when there is something to condition on: the schema makes
      // `conditions` optional, and an empty list beside `proceed` would read as
      // a condition that was forgotten rather than as none being needed.
      ...(clean
        ? {}
        : {
            conditions: [
              ...missingInformation.map(
                (item) => `The procurement owner obtains and files: ${item}`,
              ),
              ...riskFlags.map(
                (flag) => `The finance director resolves the open risk flag: ${flag.concern}`,
              ),
            ],
          }),
    },
    evidence: evidenceFor(vendor),
  };
}
