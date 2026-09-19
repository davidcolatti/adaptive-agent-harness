import type { VendorEvidenceRecord } from "../../agent/lib/vendor-fixtures.js";
import type { VendorTriageRiskFlag } from "../domain/schemas.js";

/**
 * The domain's one deterministic handler (M1-T9).
 *
 * The long-term optimization target is
 * `Full Agent -> Specialized Agent -> Jev Decision -> Deterministic Code -> Direct API Call`,
 * and this is the shape of the last-but-one step: a judgment the full agent
 * currently makes in prose that a pure function can make from the same
 * evidence, cheaply and identically every time. It is registered as a
 * `handler` capability so that a compiled workflow (M4-M8) can call it instead
 * of asking a model.
 *
 * **Pure.** It reads the record it is given and nothing else: no network, no
 * filesystem, no clock, no environment. Registering it does not execute it.
 *
 * It is deliberately **narrow and conservative**. It detects one specific,
 * high-signal pattern, an unverified change of banking details arriving from
 * somewhere other than the vendor's own domain, which is the classic invoice
 * redirection fraud. It does not attempt a general risk model: a handler that
 * guesses is worse than a full agent that reasons, and the point of lowering a
 * behavior into code is that the code is obviously right.
 */

/** Terms that indicate the evidence is about where money is sent. */
const BANKING_DETAIL_TERMS = [
  "bank account",
  "banking details",
  "payment details",
  "remittance",
  "account number",
  "iban",
  "sort code",
] as const;

/** Terms that indicate those details are being changed rather than confirmed. */
const CHANGE_TERMS = [
  "new bank",
  "different bank",
  "change",
  "changed",
  "update",
  "updated",
  "paid to a new",
] as const;

/**
 * Terms that indicate the request did not come from the vendor's own verified
 * channel. Absence of one of these is not proof of legitimacy; it only means
 * this handler has nothing deterministic to say, so it says nothing.
 */
const UNVERIFIED_ORIGIN_TERMS = [
  "free email domain",
  "rather than the vendor's own domain",
  "personal email",
  "unverified",
  "unconfirmed",
] as const;

/** The SOP requirement this handler speaks to. */
const CLAUSE = "Payment detail changes must be verified out of band before any payment is made.";

function containsAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

/**
 * Scan a vendor's frozen evidence for an unverified banking-detail change.
 *
 * ```ts
 * const flag = detectPaymentDetailChange(record);
 * if (flag !== null) {
 *   // A `proceed` recommendation is no longer available.
 * }
 * ```
 *
 * @returns the risk flag for the first matching document, or `null` when no
 * document shows the pattern. `null` means "this handler found nothing", not
 * "this vendor is safe"; everything else is still the agent's judgment.
 */
export function detectPaymentDetailChange(
  vendor: VendorEvidenceRecord,
): VendorTriageRiskFlag | null {
  for (const document of vendor.documents) {
    const text = document.text.toLowerCase();

    if (!containsAny(text, BANKING_DETAIL_TERMS)) {
      continue;
    }

    if (!containsAny(text, CHANGE_TERMS)) {
      continue;
    }

    if (!containsAny(text, UNVERIFIED_ORIGIN_TERMS)) {
      continue;
    }

    return {
      clause: CLAUSE,
      concern: `The evidence records a request to change ${vendor.vendorName}'s banking details that did not arrive through the vendor's own verified channel.`,
      evidence: `${document.source} (captured ${document.capturedOn})`,
    };
  }

  return null;
}
