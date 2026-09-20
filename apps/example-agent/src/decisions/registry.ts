import type { DecisionEngine, Storage } from "@internal/core";
import {
  createDecisionPort,
  type QuestionRegistry,
  type WorkflowDecisionPort,
} from "@internal/workflow";
import { resolveDecisionEngine } from "./engine.js";
import {
  CLASSIFY_BUNDLE_ID,
  CLASSIFY_BUNDLE_VERSION,
  EVIDENCE_SUPPORTS_QUESTION,
  TRIAGE_QUESTIONS,
} from "./questions.js";
import { createTriagePolicy, type TriageThresholds } from "./triage-policy.js";

/**
 * What the vendor workflow's two `jev` nodes resolve to (M3-T8).
 *
 * The `classify` node names a **bundle** — three questions about one vendor and
 * the policy that routes them — and the `verify` node names a bare question
 * with no policy, because nothing branches on its answer. That asymmetry is the
 * fixture's clearest statement of ADR-0009: a question that routes something
 * has a policy beside it, and a question that only informs a later rule does
 * not, and its stored record says so with `policy: null`.
 */

/** What {@link createVendorDecisionRegistry} accepts. */
export interface CreateVendorDecisionRegistryOptions {
  /** Override the policy's thresholds, e.g. to see what a stricter one would do. */
  readonly thresholds?: TriageThresholds;
  /** The policy version to stamp. Change it whenever `thresholds` changes. */
  readonly policyVersion?: string;
}

/**
 * Build the question registry the decision port is given.
 *
 * ```ts
 * const port = createDecisionPort({
 *   engine,
 *   questions: createVendorDecisionRegistry(),
 *   storage,
 * });
 * ```
 *
 * A function rather than a constant because the policy's thresholds are a
 * parameter: a replay or a calibration run wants to build the same registry
 * with different numbers and a different version, and a module-level constant
 * would make that a mutation.
 */
export function createVendorDecisionRegistry(
  options: CreateVendorDecisionRegistryOptions = {},
): QuestionRegistry {
  const policy =
    options.thresholds === undefined
      ? createTriagePolicy()
      : createTriagePolicy(options.thresholds, options.policyVersion);

  return [
    {
      id: CLASSIFY_BUNDLE_ID,
      version: CLASSIFY_BUNDLE_VERSION,
      // The node declares `choice`, and `category` is the choice question, so
      // it is the bundle's primary: its answer is what the node's `answer`
      // field carries and what `finalize` puts in the triage output.
      kind: "choice",
      primary: "category",
      questions: TRIAGE_QUESTIONS,
      policy,
    },
    EVIDENCE_SUPPORTS_QUESTION,
  ];
}

/** What {@link createVendorDecisionPort} accepts. */
export interface CreateVendorDecisionPortOptions extends CreateVendorDecisionRegistryOptions {
  /**
   * The engine that answers. Defaults to {@link resolveDecisionEngine}'s
   * choice: live Jev with an AI Gateway credential, the fixture engine without.
   */
  readonly engine?: DecisionEngine;
  /** Where each decision's evidence is written (M3-T3). Omitted means nowhere. */
  readonly storage?: Pick<Storage, "saveDecision">;
}

/**
 * Build the `WorkflowDecisionPort` the vendor workflow's `jev` nodes execute
 * through (M3-T8).
 *
 * ```ts
 * const runtime = createWorkflowRuntime({
 *   registry,
 *   agentRuntime,
 *   decisionEngine: createVendorDecisionPort({ storage }),
 * });
 * ```
 *
 * One function so that `src/run.ts` and every test build the port the same way.
 * It replaces `createFixtureDecisionPort()`, the M4-T10 placeholder: the
 * questions, the policy, the confidence derivation, the banding and the
 * persistence are all real now, and only the model is scripted when no
 * credential is present.
 */
export function createVendorDecisionPort(
  options: CreateVendorDecisionPortOptions = {},
): WorkflowDecisionPort {
  return createDecisionPort({
    engine: options.engine ?? resolveDecisionEngine().engine,
    questions: createVendorDecisionRegistry(options),
    ...(options.storage === undefined ? {} : { storage: options.storage }),
  });
}
