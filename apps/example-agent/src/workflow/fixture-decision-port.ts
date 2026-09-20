import { formatCapabilityRef, isJsonObject, type JsonValue } from "@internal/core";
import type { WorkflowDecisionPort, WorkflowDecisionRequest } from "@internal/workflow";
import { lookupVendorEvidence } from "../../agent/lib/vendor-evidence.js";
import type { VendorEvidenceRecord } from "../../agent/lib/vendor-fixtures.js";
import { detectPaymentDetailChange } from "../handlers/detect-payment-detail-change.js";
import { CLASSIFY_QUESTION_REF, VERIFY_QUESTION_REF } from "./vendor-triage-workflow.js";

/**
 * A deterministic stand-in for Jev, and **a placeholder until M3** (M4-T10).
 *
 * **This is not Jev and does not approximate it.** Jev is a judgment primitive:
 * it reads evidence, weighs it and answers a registered question, and M3 owns
 * the question contract, the engine and the answer shape
 * (`docs/milestones/build-plan.md`, Milestone 3). This module answers the
 * workflow's two questions from the input with a handful of string matches,
 * because Milestone 4's own status file says a fake decision port stands in
 * until M3 lands and because a `jev` node that cannot execute would leave five
 * of the milestone's eight acceptance criteria unverifiable.
 *
 * **What has to happen when M3 lands.** M3 registers the two questions,
 * implements `DecisionEngine`, and `src/run.ts` passes an adapter over it as
 * `decisionEngine` instead of this. Nothing in
 * `vendor-triage-workflow.ts` changes: a `jev` node names a question, and the
 * runtime reaches whatever port it was given. This file is then deleted, and
 * its tests with it.
 *
 * **What it is good for meanwhile.** It is deterministic, so a workflow run is
 * reproducible; it is pure, so a test needs no fixture server; and its answers
 * validate against the `jev` nodes' own `outputSchema`s, so the runtime's
 * output validation is genuinely exercised rather than bypassed.
 */

/**
 * Terms in the frozen evidence that mean a vendor needs the full agent's
 * reading rather than deterministic finalization.
 *
 * Two kinds, and both are reasons to research rather than to finalize: an
 * assurance that is explicitly *not* what the SOP requires, and a statement
 * that something the SOP requires is absent or unanswered. They are not a risk
 * model — that is the agent's job, and the whole point of routing to it.
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

/** Whether `vendor`'s frozen evidence carries anything that needs reading rather than matching. */
function needsResearch(vendor: VendorEvidenceRecord): boolean {
  // The one deterministic risk the domain already detects counts as an
  // indicator in its own right: an unverified banking-detail change is exactly
  // the case that must never be finalized by a rule.
  if (detectPaymentDetailChange(vendor) !== null) {
    return true;
  }

  const text = vendor.documents.map((document) => document.text.toLowerCase()).join("\n");

  return RESEARCH_INDICATOR_TERMS.some((term) => text.includes(term));
}

/** The `vendorName` a JSON job input carries, or `null` when it carries none. */
function vendorNameOf(input: JsonValue): string | null {
  if (!isJsonObject(input)) {
    return null;
  }

  const value = input.vendorName;

  return typeof value === "string" && value !== "" ? value : null;
}

/** How many evidence items a JSON triage output cites. */
function citedSourcesOf(input: JsonValue): readonly string[] {
  if (!isJsonObject(input)) {
    return [];
  }

  const evidence = input.evidence;

  if (!Array.isArray(evidence)) {
    return [];
  }

  return evidence.flatMap((item) => {
    if (!isJsonObject(item)) {
      return [];
    }

    const source = item.source;

    return typeof source === "string" && source !== "" ? [source] : [];
  });
}

/**
 * Answer `vendor-triage.classify-route@1.0.0` from the job input.
 *
 * | Input | Answer |
 * | --- | --- |
 * | on file, nothing that needs reading | `clear` |
 * | on file, a research indicator | `research` |
 * | not on file, or no vendor name | `uncertain` |
 *
 * `uncertain` is the honest default, and the graph routes it to the escalation.
 */
function classify(input: JsonValue): JsonValue {
  const vendorName = vendorNameOf(input);

  if (vendorName === null) {
    return {
      category: "uncertain",
      rationale: "The request carries no vendor name, so nothing can be classified.",
      vendorName: "(none)",
    };
  }

  const lookup = lookupVendorEvidence(vendorName);

  if (lookup.status === "unknown") {
    return {
      category: "uncertain",
      rationale: `No frozen evidence is on file for ${vendorName}, so neither route can be justified.`,
      vendorName,
    };
  }

  if (needsResearch(lookup.vendor)) {
    return {
      category: "research",
      rationale: `The frozen evidence for ${vendorName} contains something that has to be read rather than matched.`,
      vendorName,
    };
  }

  return {
    category: "clear",
    rationale: `The frozen evidence for ${vendorName} carries no indicator that needs a model's reading.`,
    vendorName,
  };
}

/**
 * Answer `vendor-triage.evidence-supports@1.0.0` from the triage the agent
 * produced.
 *
 * `supported` is true when the triage cites at least one source. That is a
 * deliberately weak test and the reason this file says it is not Jev: whether a
 * citation *supports* a conclusion is a judgment, and counting citations is
 * the most a pure function can honestly claim.
 */
function verify(input: JsonValue): JsonValue {
  const citedSources = citedSourcesOf(input);

  return {
    supported: citedSources.length > 0,
    rationale:
      citedSources.length > 0
        ? `The triage cites ${citedSources.length} source${citedSources.length === 1 ? "" : "s"}.`
        : "The triage cites no source at all, so nothing in it can be checked.",
    citedSources: [...citedSources],
  };
}

/**
 * Create the fixture decision port.
 *
 * ```ts
 * const runtime = createWorkflowRuntime({
 *   registry,
 *   agentRuntime,
 *   decisionEngine: createFixtureDecisionPort(),
 * });
 * ```
 *
 * It holds no state, so one instance may serve any number of runs.
 *
 * @throws {Error} when asked a question this workflow does not contain. A
 * decision port that answered an unknown question with a default would be a
 * silent source of wrong judgments, which is the one thing a placeholder must
 * not become.
 */
export function createFixtureDecisionPort(): WorkflowDecisionPort {
  return {
    decide(request: WorkflowDecisionRequest): Promise<JsonValue> {
      const ref = formatCapabilityRef(request.node.question);

      switch (ref) {
        case CLASSIFY_QUESTION_REF:
          return Promise.resolve(classify(request.input));

        case VERIFY_QUESTION_REF:
          return Promise.resolve(verify(request.input));

        default:
          return Promise.reject(
            new Error(
              `createFixtureDecisionPort: node \`${request.node.id}\` asks \`${ref}\`, which this placeholder does not answer. M3 owns the real questions.`,
            ),
          );
      }
    },
  };
}
