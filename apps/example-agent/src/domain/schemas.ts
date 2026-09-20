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

/**
 * The four schemas the hand-authored vendor workflow introduces (M4-T10).
 *
 * They exist because a workflow has more edges than a full-agent run does. A
 * full agent takes a `vendor-triage.input` and returns a `vendor-triage.output`
 * and nothing in between is a contract; a compiled workflow types **every**
 * edge (north-star invariant 5), so the classification a `jev` node produces,
 * the verification a second one produces, and the two composite inputs the
 * `code` nodes read all need schemas of their own.
 *
 * They live here, beside the domain's own two, rather than in
 * `src/workflow/`, because they are the domain's vocabulary rather than the
 * workflow's wiring: a second workflow over the same domain would reuse them,
 * and `src/capabilities.ts` registers all six from one place.
 */

/**
 * The fields every `jev` node's output carries, whatever it asked (M3-T3).
 *
 * This is `DecisionNodeOutput` from `@internal/workflow`, written as a schema
 * so the runtime's own output validation checks it. It is the same shape for
 * every decision node, which is the point: a node's output is a **judgment**
 * plus the route the organization's policy chose, and what the judgment was
 * about is in `answers`.
 *
 * `distribution`, `confidence` and `route` are all nullable, and each `null`
 * means something different and real: no distribution is what a provider often
 * gives for a choice, no confidence follows from no distribution, and no route
 * means no policy consumed the answer. None of the three is ever invented.
 */
const decisionNodeFields = {
  answer: z
    .union([z.boolean(), z.string(), z.number()])
    .describe("The primary question's judgment: a boolean, the chosen option, or the score."),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .nullable()
    .describe("How much probability mass sits on the answer, or null when none could be derived."),
  band: z
    .enum(["auto", "agent-review", "human-review"])
    .describe("Which of the three bands the primary answer's confidence falls in."),
  distribution: z
    .record(z.string(), z.number())
    .nullable()
    .describe("The provider's probability distribution, verbatim, or null when it gave none."),
  decisionId: z.string().min(1).describe("The stored decision this output points at."),
  route: z
    .string()
    .min(1)
    .nullable()
    .describe("The route the policy chose, or null when no policy consumed the answer."),
  reasons: z
    .array(z.string().min(1))
    .describe("Why the policy chose that route. Empty when there is no policy."),
} as const;

/**
 * What the `classify` node outputs: three judgments about the vendor, and the
 * route the policy chose from them (M3-T8).
 *
 * **`route` is what the branch selects on, and `answers.category` is what
 * `finalize` puts in the triage output.** Before M3 these were one field: the
 * node answered `clear | research | uncertain` directly, because the
 * deterministic placeholder standing in for Jev could not separate a judgment
 * about the vendor from a decision about what to do. They are separate now,
 * which is ADR-0009 in the fixture rather than only in a document.
 */
export const vendorTriageClassificationSchema = z.object({
  ...decisionNodeFields,
  answers: z
    .object({
      lowRisk: z.boolean().describe("Whether the vendor is obviously low risk."),
      category: z
        .string()
        .min(1)
        .describe("Which of the SOP's categories applies, in the SOP's own vocabulary."),
      evidenceSufficient: z
        .boolean()
        .describe("Whether the evidence suffices to triage without research."),
    })
    .describe("Every question's answer, under the bundle's own keys."),
});

/**
 * What the `verify` node outputs: one judgment about whether a triage's own
 * cited evidence supports it.
 *
 * `route` is always `null` here, because nothing branches on this answer:
 * `decide-verified-triage` is the rule that consumes it, and it is a `code`
 * node.
 */
export const vendorTriageVerificationSchema = z.object({
  ...decisionNodeFields,
  answers: z
    .object({
      "vendor-triage.evidence-supports": z
        .boolean()
        .describe("Whether the cited evidence supports the triage's conclusion."),
    })
    .describe("The one question's answer, under its own id."),
});

/**
 * What the `finalize` node reads: the classification **and** the original
 * request.
 *
 * A `code` node bound to the branch would receive the classification only, and
 * finalizing needs the vendor name and the SOP the request carried. The
 * workflow therefore binds an explicit `{ kind: "object" }` binding, and this is
 * the schema that binding satisfies.
 */
export const vendorTriageFinalizeInputSchema = z.object({
  classification: vendorTriageClassificationSchema,
  request: vendorTriageInputSchema,
});

/**
 * What the `decide` node reads: the researching agent's triage **and** the
 * verification of it.
 *
 * The same reason as above: a node bound to its predecessor would see the
 * verification alone, and applying the policy needs the triage the verification
 * is about.
 */
export const vendorTriageDecisionInputSchema = z.object({
  triage: vendorTriageOutputSchema,
  verification: vendorTriageVerificationSchema,
});

/** What the classification step decides. */
export type VendorTriageClassification = z.infer<typeof vendorTriageClassificationSchema>;

/** What the verification step decides. */
export type VendorTriageVerification = z.infer<typeof vendorTriageVerificationSchema>;

/** The `finalize` node's composite input. */
export type VendorTriageFinalizeInput = z.infer<typeof vendorTriageFinalizeInputSchema>;

/** The `decide` node's composite input. */
export type VendorTriageDecisionInput = z.infer<typeof vendorTriageDecisionInputSchema>;
