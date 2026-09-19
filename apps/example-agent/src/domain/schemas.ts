import { z } from "zod";

/**
 * The vendor-triage domain's input and output schemas.
 *
 * Written in `zod`, which the example agent already depends on for its tool's
 * `inputSchema`. The harness never sees `zod`: `@internal/core` declares the
 * Standard Schema shape structurally (ADR-0027), and every `zod` schema
 * publishes it under `~standard`, so `defineDomain()` accepts these values
 * without an adapter and without `@internal/core` gaining a dependency.
 *
 * The field names are the ones `agent/instructions.md` and
 * `agent/skills/triage-vendor.md` already use, so the schema and the prompt
 * describe one artefact rather than two that drift.
 */

/**
 * What a triage request supplies: the three inputs Milestone 1's neutral
 * reference job names.
 */
export const vendorTriageInputSchema = z.object({
  vendorName: z
    .string()
    .min(1)
    .describe("The vendor's name, exactly as the request gives it. Matching ignores case."),
  evidenceText: z
    .string()
    .optional()
    .describe(
      "Vendor website text or other evidence the requester already has. Optional: the fixture tool is the other source.",
    ),
  procurementSop: z.string().min(1).describe("The procurement SOP to triage against, as Markdown."),
});

/** One concern, tied to a SOP clause and to the evidence that raised it. */
export const riskFlagSchema = z.object({
  clause: z.string().min(1).describe("The SOP requirement this concern relates to."),
  concern: z.string().min(1).describe("What is wrong, in one sentence."),
  evidence: z.string().min(1).describe("The document or quotation the concern rests on."),
});

/** What should happen next, and who decides. */
export const recommendationSchema = z.object({
  decision: z
    .enum(["proceed", "proceed_with_conditions", "request_information", "escalate"])
    .describe("One of the four outcomes the triage skill allows."),
  rationale: z.string().min(1).describe("Why this outcome, in one or two sentences."),
  conditions: z
    .array(z.string().min(1))
    .optional()
    .describe(
      "Each condition and who verifies it. Required in practice for `proceed_with_conditions`.",
    ),
});

/** One claim and the source that supports it. */
export const evidenceItemSchema = z.object({
  claim: z.string().min(1).describe("The claim being supported."),
  source: z.string().min(1).describe("Where it came from, cited the way a reviewer would."),
});

/**
 * The five outputs `agent/instructions.md` requires, in the order it requires
 * them.
 */
export const vendorTriageOutputSchema = z.object({
  category: z.string().min(1).describe("What the vendor sells, in the SOP's own vocabulary."),
  riskFlags: z.array(riskFlagSchema).describe("Every concern found. Empty means none were."),
  missingInformation: z
    .array(z.string().min(1))
    .describe("What the SOP requires that the evidence does not establish."),
  recommendation: recommendationSchema,
  evidence: z.array(evidenceItemSchema).min(1).describe("The sources the triage rests on."),
});

/** What a triage request supplies. */
export type VendorTriageInput = z.infer<typeof vendorTriageInputSchema>;

/**
 * One concern a triage raised.
 *
 * Exported as its own type so that a deterministic handler can produce a risk
 * flag that slots straight into a `VendorTriageOutput` without restating the
 * shape (M1-T9).
 */
export type VendorTriageRiskFlag = z.infer<typeof riskFlagSchema>;

/** What a triage produces. */
export type VendorTriageOutput = z.infer<typeof vendorTriageOutputSchema>;
