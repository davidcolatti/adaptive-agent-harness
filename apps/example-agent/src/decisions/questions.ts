import {
  type BooleanQuestion,
  type ChoiceQuestion,
  defineQuestion,
  defineQuestionSet,
  type QuestionSet,
} from "@internal/core";

/**
 * The vendor-triage domain's registered questions (M3-T8).
 *
 * Milestone 3 names three for this fixture, and these are them, in its words:
 *
 * ```text
 * Is vendor obviously low risk?
 * Which vendor category applies?
 * Is evidence sufficient?
 * ```
 *
 * **All three are one judgment about one vendor, so they are one Jev call.**
 * That is M3-T6's rule exactly — batching is by shared state — and it is why
 * the `classify` node names a *bundle* rather than a single question. What the
 * organization does about the three answers is not one of them: that is
 * `triagePolicy` in `./triage-policy.js`, which is ADR-0009's split ("Jev
 * answers bounded questions. TypeScript decides what follows") made visible in
 * a fixture rather than argued for in a document.
 *
 * ## Why `category` is not `clear | research | uncertain`
 *
 * Before M3, the `classify` node answered with the route directly, because the
 * deterministic placeholder that stood in for Jev had no way to separate the
 * two. It is now the SOP's own category list, because that is a question about
 * the **vendor** and the route is a question about **what the organization
 * does**, and mixing them is the precise failure ADR-0009 exists to prevent. A
 * category is also reusable: `finalize` puts it in the triage output, where the
 * schema asks for "what the vendor sells, in the SOP's own vocabulary".
 *
 * ## Why every question carries bands
 *
 * A question with no {@link ConfidenceBands} can never be auto-routed
 * (`createDecisionPort` maps it to `human-review` whatever its confidence), so
 * an uncalibrated question would make the whole fixture escalate. The numbers
 * below are the ones `pnpm --filter @internal/example-agent run calibrate`
 * reports on, and M3-T9's labeled set is what earns them; they are a fixture's
 * calibration, not a harness default, which is the distinction M3-T5 exists to
 * draw.
 */

/**
 * The five categories the procurement SOP names, in its own words.
 *
 * Kept identical to `PROCUREMENT_SOP`'s "Categories" section, so a change to
 * the SOP that this list does not follow is a visible inconsistency rather than
 * a silent one.
 */
export const VENDOR_CATEGORIES = [
  "finance and accounting",
  "product analytics",
  "logistics and freight",
  "security tooling",
  "other",
] as const;

/** One of {@link VENDOR_CATEGORIES}. */
export type VendorCategory = (typeof VENDOR_CATEGORIES)[number];

/** "Is vendor obviously low risk?" */
export const LOW_RISK_QUESTION = defineQuestion<BooleanQuestion>({
  id: "vendor-triage.low-risk",
  version: "1.0.0",
  kind: "boolean",
  prompt:
    "Is this vendor obviously low risk, judged only on the evidence supplied? Answer `true` only when nothing in the evidence needs a person's reading.",
  criteria: {
    true: "The evidence is complete and consistent, and raises no concern under the SOP.",
    false:
      "The evidence is incomplete, contradicts itself, or raises a concern the SOP cares about.",
  },
  bands: { auto: 0.85, agentReview: 0.6 },
});

/** "Which vendor category applies?" */
export const CATEGORY_QUESTION = defineQuestion<ChoiceQuestion>({
  id: "vendor-triage.category",
  version: "1.0.0",
  kind: "choice",
  prompt: "Which of the procurement SOP's categories does this vendor belong to?",
  choices: VENDOR_CATEGORIES,
  choiceDescriptions: {
    "finance and accounting": "Bookkeeping, payments, expenses, reconciliation, audit.",
    "product analytics": "Product event data, funnels, retention, session replay.",
    "logistics and freight": "Freight, warehousing, customs, delivery.",
    "security tooling": "Security monitoring, scanning, identity, secrets.",
    other: "None of the four fits, or the evidence does not establish which does.",
  },
  bands: { auto: 0.8, agentReview: 0.5 },
});

/** "Is evidence sufficient?" */
export const EVIDENCE_SUFFICIENT_QUESTION = defineQuestion<BooleanQuestion>({
  id: "vendor-triage.evidence-sufficient",
  version: "1.0.0",
  kind: "boolean",
  prompt:
    "Is the supplied evidence sufficient to triage this vendor against the SOP without further research?",
  criteria: {
    true: "Every SOP requirement is either established or explicitly absent, and nothing is ambiguous.",
    false: "At least one SOP requirement is left ambiguous, partial or unanswered.",
  },
  bands: { auto: 0.85, agentReview: 0.6 },
});

/**
 * The three questions the `classify` node asks, keyed as its answers come back.
 *
 * The keys are what the node's output carries under `answers`, and what
 * `triagePolicy` reads, so they are part of the fixture's contract rather than
 * an internal name.
 */
export const TRIAGE_QUESTIONS: QuestionSet = defineQuestionSet({
  lowRisk: LOW_RISK_QUESTION,
  category: CATEGORY_QUESTION,
  evidenceSufficient: EVIDENCE_SUFFICIENT_QUESTION,
});

/**
 * The `verify` node's question: does a triage's own cited evidence support what
 * it concluded?
 *
 * One question rather than a bundle, and **no policy**, because nothing routes
 * on it: `decide-verified-triage` is the rule that consumes it, and it is a
 * `code` node rather than a branch. Its stored record therefore carries
 * `policy: null`, which is the honest record of a judgment nobody routed on.
 */
export const EVIDENCE_SUPPORTS_QUESTION = defineQuestion<BooleanQuestion>({
  id: "vendor-triage.evidence-supports",
  version: "1.0.0",
  kind: "boolean",
  prompt: "Does the evidence the triage itself cites support the conclusion the triage reached?",
  criteria: {
    true: "Every material claim in the triage is carried by a source it cites.",
    false: "The triage concludes something its cited sources do not establish, or cites nothing.",
  },
  bands: { auto: 0.85, agentReview: 0.6 },
});

/** The reference the `classify` node names. */
export const CLASSIFY_BUNDLE_ID = "vendor-triage.classify";

/** The exact version of that bundle. */
export const CLASSIFY_BUNDLE_VERSION = "1.0.0";
