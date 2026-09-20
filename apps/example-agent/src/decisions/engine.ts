import {
  type DecisionEngine,
  type DecisionRequest,
  type DecisionResult,
  isJsonObject,
  type JsonValue,
  type QuestionSet,
} from "@internal/core";
import { createJevDecisionEngine, JEV_GATEWAY_MODEL_ID } from "@internal/decision-jev";
import { createFakeDecisionEngine, type FakeDecisionScript } from "@internal/testing";
import {
  VENDOR_EVIDENCE_FIXTURES,
  type VendorEvidenceRecord,
} from "../../agent/lib/vendor-fixtures.js";
import { detectPaymentDetailChange } from "../handlers/detect-payment-detail-change.js";
import type { VendorCategory } from "./questions.js";

/**
 * Which {@link DecisionEngine} the example agent uses (M3-T8).
 *
 * **Credential present, live Jev; credential absent, the fixture engine.** That
 * is the same rule `pnpm example:run` already follows for the model, and for
 * the same reason: north-star invariant 15 says local development stays a
 * first-class path, so the demo has to produce all three routes on a machine
 * with no AI Gateway account. What the fixture engine cannot show is whether a
 * real model's judgment is any good — that is what the live path and
 * `runCalibration()` against it are for.
 *
 * ## The fixture engine is not Jev, and does not pretend to be
 *
 * `apps/example-agent/src/workflow/fixture-decision-port.ts`, the M4-T10
 * placeholder this replaces, said the same thing and it is still true: reading
 * evidence and weighing it is a judgment, and matching strings is not. What
 * changed is the **shape**: the placeholder was a `WorkflowDecisionPort` that
 * answered a workflow's questions with a workflow's output; this is a
 * `DecisionEngine` that answers *questions* with *answers*, so the policy
 * layer, the confidence derivation, the banding and the persistence are all the
 * real ones. The only fake thing left is the model.
 *
 * It is also scripted through `createFakeDecisionEngine()` from
 * `@internal/testing` rather than hand-rolled, so the answers go through the
 * same validation and the same `deriveConfidence()` a real adapter's do.
 */

/**
 * Terms in the frozen evidence that mean a vendor needs the full agent's
 * reading rather than deterministic finalization.
 *
 * Carried over verbatim from the M4-T10 placeholder, deliberately: the three
 * demo routes must still hold after this file replaces it, and changing the
 * rules and the shape in one step would make a route change impossible to
 * attribute.
 */
const RESEARCH_INDICATOR_TERMS = [
  "type i ",
  "no data processing agreement",
  "does not name",
  "did not say",
  "no security page",
  "no privacy policy",
  "no published terms",
  "no company registration number",
] as const;

/** Terms that place a vendor in one of the SOP's categories. */
const CATEGORY_TERMS: readonly (readonly [VendorCategory, readonly string[]])[] = [
  ["finance and accounting", ["bookkeeping", "expense", "reconcil", "invoice", "ledger"]],
  ["product analytics", ["analytics", "session replay", "funnel", "retention"]],
  ["logistics and freight", ["freight", "customs", "logistics", "depot", "shipper"]],
  ["security tooling", ["security monitoring", "vulnerability", "secrets", "identity provider"]],
];

/** Whether `vendor`'s frozen evidence carries anything that needs reading rather than matching. */
function needsResearch(vendor: VendorEvidenceRecord): boolean {
  // The one deterministic risk the domain already detects counts as an
  // indicator in its own right: an unverified banking-detail change is exactly
  // the case that must never be finalized by a rule.
  if (detectPaymentDetailChange(vendor) !== null) {
    return true;
  }

  const text = documentText(vendor);

  return RESEARCH_INDICATOR_TERMS.some((term) => text.includes(term));
}

/** Every document's text, lowercased and joined. The M4-T10 rule, unchanged. */
function documentText(vendor: VendorEvidenceRecord): string {
  return vendor.documents.map((document) => document.text.toLowerCase()).join("\n");
}

/** Match `text` against the category term groups, in the SOP's order. */
function matchCategory(text: string): VendorCategory | null {
  return CATEGORY_TERMS.find(([, terms]) => terms.some((term) => text.includes(term)))?.[0] ?? null;
}

/**
 * The SOP category `vendor` sits in.
 *
 * **The stated offering is consulted first**, and the documents only when it
 * says nothing. A vendor's documents mention whatever happened to it — the
 * fixture's freight company has an invoice dispute in its evidence — and
 * matching "invoice" there would file a freight forwarder under finance. What a
 * vendor *sells* is the question the SOP asks.
 */
function categoryOf(vendor: VendorEvidenceRecord): VendorCategory {
  return (
    matchCategory(vendor.statedOffering.toLowerCase()) ??
    matchCategory(documentText(vendor)) ??
    "other"
  );
}

/** The `vendorName` a JSON job input carries, or `null` when it carries none. */
function vendorNameOf(state: JsonValue): string | null {
  if (!isJsonObject(state)) {
    return null;
  }

  const value = state.vendorName;

  return typeof value === "string" && value !== "" ? value : null;
}

/** How many evidence items a JSON triage output cites. */
function citedSourceCount(state: JsonValue): number {
  if (!isJsonObject(state) || !Array.isArray(state.evidence)) {
    return 0;
  }

  return state.evidence.filter(
    (item) => isJsonObject(item) && typeof item.source === "string" && item.source !== "",
  ).length;
}

/**
 * A confident boolean, expressed as the distribution a provider would report.
 *
 * `deriveConfidence()` turns it into the confidence the bands act on, so the
 * fixture states the *evidence* for an answer rather than the confidence
 * directly, exactly as a real provider does.
 */
function booleanAt(
  value: boolean,
  probabilityTrue: number,
): {
  readonly value: boolean;
  readonly distribution: Readonly<Record<string, number>>;
} {
  return {
    value,
    distribution: { true: probabilityTrue, false: 1 - probabilityTrue },
  };
}

/** A choice distribution concentrated on `chosen`, spread evenly over the rest. */
function choiceAt(
  chosen: VendorCategory,
  mass: number,
  others: readonly VendorCategory[],
): {
  readonly value: string;
  readonly distribution: Readonly<Record<string, number>>;
} {
  const spread = others.length === 0 ? 0 : (1 - mass) / others.length;

  return {
    value: chosen,
    distribution: Object.fromEntries([
      [chosen, mass],
      ...others.map((other) => [other, spread] as const),
    ]),
  };
}

const ALL_CATEGORIES: readonly VendorCategory[] = [
  "finance and accounting",
  "product analytics",
  "logistics and freight",
  "security tooling",
  "other",
];

/** The categories other than `chosen`, in the SOP's order. */
function otherCategories(chosen: VendorCategory): readonly VendorCategory[] {
  return ALL_CATEGORIES.filter((category) => category !== chosen);
}

/** What {@link createVendorDecisionEngine} accepts. */
export interface CreateVendorDecisionEngineOptions {
  /**
   * The evidence universe the engine answers from. Defaults to the frozen
   * fixtures.
   *
   * A parameter so M3-T9's calibration set can add synthetic vendors without
   * touching the three the demo runs on: a labeled set of three cases would say
   * nothing about calibration.
   */
  readonly vendors?: readonly VendorEvidenceRecord[];
}

/**
 * The credential-free {@link DecisionEngine}: a script derived from frozen
 * evidence, per call.
 *
 * `createFakeDecisionEngine()` takes a fixed script, and the right answer here
 * depends on the state — which vendor is being triaged — so this wraps it and
 * builds the script for each call. Every answer still goes through the fake's
 * own validation and through `deriveConfidence()`, so a banding or policy test
 * against this engine exercises the real rules.
 */
export function createVendorDecisionEngine(
  options: CreateVendorDecisionEngineOptions = {},
): DecisionEngine {
  const vendors = options.vendors ?? VENDOR_EVIDENCE_FIXTURES;

  function find(vendorName: string): VendorEvidenceRecord | null {
    const wanted = vendorName.trim().replaceAll(/\s+/gu, " ").toLowerCase();

    return (
      vendors.find(
        (record) => record.vendorName.trim().replaceAll(/\s+/gu, " ").toLowerCase() === wanted,
      ) ?? null
    );
  }

  function scriptFor(state: JsonValue): FakeDecisionScript {
    // The `verify` node's state is a triage, not a request. Its one question is
    // answered from what the triage cites, which is the weakest honest test a
    // deterministic rule can make, and the reason this file is not Jev.
    const citations = citedSourceCount(state);
    const verification = booleanAt(citations > 0, citations > 0 ? 0.94 : 0.05);

    const vendorName = vendorNameOf(state);
    const vendor = vendorName === null ? null : find(vendorName);

    if (vendor === null) {
      // Not on file, or no vendor name at all. **Nothing is established**, and
      // the flat category distribution is what says so: its confidence falls
      // below every threshold, so the policy escalates rather than guessing.
      const spread = 1 / ALL_CATEGORIES.length;

      return {
        "vendor-triage.low-risk": booleanAt(false, 0.5),
        "vendor-triage.category": {
          value: "other",
          distribution: Object.fromEntries(
            ALL_CATEGORIES.map((category) => [category, spread] as const),
          ),
        },
        "vendor-triage.evidence-sufficient": booleanAt(false, 0.5),
        "vendor-triage.evidence-supports": verification,
      };
    }

    const research = needsResearch(vendor);
    const category = categoryOf(vendor);

    return {
      "vendor-triage.low-risk": research ? booleanAt(false, 0.08) : booleanAt(true, 0.94),
      "vendor-triage.category": choiceAt(category, 0.95, otherCategories(category)),
      "vendor-triage.evidence-sufficient": research
        ? booleanAt(false, 0.12)
        : booleanAt(true, 0.92),
      "vendor-triage.evidence-supports": verification,
    };
  }

  return {
    evaluate<TQuestions extends QuestionSet>(
      request: DecisionRequest<TQuestions>,
    ): Promise<DecisionResult<TQuestions>> {
      return createFakeDecisionEngine({
        script: scriptFor(request.state),
        model: { provider: "fixture", modelId: "vendor-triage-fixture" },
      }).evaluate(request);
    },
  };
}

/** The credentials the AI Gateway accepts, either of which is enough. */
const GATEWAY_CREDENTIALS = ["AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN"] as const;

/** Whether a Gateway credential is present in this process's environment. */
export function hasGatewayCredential(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return GATEWAY_CREDENTIALS.some((name) => (env[name] ?? "") !== "");
}

/** What {@link resolveDecisionEngine} returns: the engine, and which one it is. */
export interface ResolvedDecisionEngine {
  /** The engine itself. */
  readonly engine: DecisionEngine;
  /** `jev` when a credential selected live Jev, `fixture` otherwise. */
  readonly kind: "jev" | "fixture";
  /** What to report on stderr, so the mode is never silent. */
  readonly description: string;
}

/**
 * Choose the engine this process should use.
 *
 * ```ts
 * const { engine, description } = resolveDecisionEngine();
 * ```
 *
 * Live Jev is reached as the model-id string `typesafe-ai/jev`, which the AI
 * Gateway resolves; `@internal/decision-jev` is the only package that may see
 * the AI SDK's experimental evaluation API, and this file reaches it through
 * that package's own contract.
 */
export function resolveDecisionEngine(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ResolvedDecisionEngine {
  if (hasGatewayCredential(env)) {
    return {
      engine: createJevDecisionEngine({ model: JEV_GATEWAY_MODEL_ID }),
      kind: "jev",
      description: `live Jev through the AI Gateway (${JEV_GATEWAY_MODEL_ID})`,
    };
  }

  return {
    engine: createVendorDecisionEngine(),
    kind: "fixture",
    description:
      "the deterministic fixture engine (no AI Gateway credential; set AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN for live Jev)",
  };
}
