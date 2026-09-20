import {
  type Band,
  bandFor,
  type DecisionAnswer,
  type DecisionEngine,
  DecisionError,
  type DecisionRecord,
  formatCapabilityRef,
  type JsonObject,
  type JsonValue,
  type Policy,
  type PolicyOutcome,
  type Question,
  type QuestionKind,
  type QuestionSet,
  type Storage,
  ValidationError,
  type ValidationIssue,
} from "@internal/core";
import type { WorkflowDecisionPort, WorkflowDecisionRequest } from "./ports.js";

/**
 * The bridge from M4's {@link WorkflowDecisionPort} to M3's
 * {@link DecisionEngine} (M3-T2), with the policy layer and the persistence
 * M3-T3 adds around it.
 *
 * `ports.ts` says exactly what this file is for: "When M3 lands, this port is
 * what its engine is adapted to, and nothing in the interpreter changes."
 * Nothing in the interpreter does. A `jev` node **names** a question
 * (`question.id@version`) and does not define one, so the missing half has
 * always been a registry of questions; that is what the caller supplies here.
 *
 * ## One node, one engine call, one stored record
 *
 * Executing a `jev` node is four steps in a fixed order, and the order is the
 * whole design:
 *
 * 1. the engine answers every question the node's registry entry names, in
 *    **one** call, because they share one state (M3-T6);
 * 2. the entry's {@link Policy}, when it has one, reads that result and
 *    produces a route (ADR-0009: Jev answers, TypeScript decides);
 * 3. both are written as **one** {@link DecisionRecord} whose `result` and
 *    `policy` are separate fields, so a policy can never alter the judgment it
 *    consumed;
 * 4. the node outputs a small flat value a `branch` can select on.
 *
 * **Persistence lives here rather than in the interpreter** because this is the
 * one place that already turns a node into an engine call; putting it in
 * `workflow-runtime.ts` would make the runtime depend on `Storage` for one node
 * type. A storage failure is a `StorageError` and **fails the node**, never
 * swallowed: a decision nobody recorded is a decision nobody can replay, and
 * Milestone 2's rule that "storage failures cannot silently turn into
 * successful runs" is not weaker for a decision than for a run.
 *
 * **This adapter emits no trace events.** `workflow-runtime.ts` already opens a
 * `decision.started` span around every `jev` node and closes it with
 * `decision.completed` or `decision.failed`, and the engine is contractually
 * silent (ADR-0042), so a decision produces exactly one span whichever path it
 * takes. Anything else would double-count a Jev call in the inspector's "Jev
 * calls" line.
 */

/**
 * Several questions asked of one `jev` node's input, and the policy that routes
 * them (M3-T6, M3-T4).
 *
 * A `jev` node names one reference, and a bundle is what that reference may
 * resolve to when one judgment needs several bounded questions about one state
 * — "is this vendor obviously low risk, which category is it, and is the
 * evidence sufficient?" is three questions and one Jev call, because the state
 * is one vendor.
 *
 * **The policy belongs to the bundle, not to the port.** A port serves every
 * `jev` node in a workflow, and two nodes ask different questions, so a
 * port-level policy would necessarily be wrong for one of them. Attaching it
 * here means a question that nothing routes on simply has none, and its record
 * stores `policy: null`.
 */
export interface QuestionBundle {
  /** The bundle's stable id, which is what a `jev` node's `question.id` names. */
  readonly id: string;
  /** The bundle's exact version, which is what the node's `question.version` names. */
  readonly version: string;
  /**
   * The kind the node declares, which must be the kind of {@link primary}.
   *
   * A `jev` node carries `questionKind` so the IR can be validated without a
   * registry; this is what that declaration is checked against.
   */
  readonly kind: QuestionKind;
  /**
   * Which key of {@link questions} is the node's answer.
   *
   * The node's output carries every answer under `answers`, and this one
   * additionally at the top level, because a `branch` selecting on a single
   * path is the common case and `["answer"]` reads better than
   * `["answers", "category"]`.
   */
  readonly primary: string;
  /** The questions, keyed by the names their answers come back under. */
  readonly questions: QuestionSet;
  /** The deterministic rule from the result to a route, when there is one. */
  readonly policy?: Policy<QuestionSet, string>;
}

/**
 * What a `jev` node's reference may resolve to: one question, or a bundle.
 *
 * A bare {@link Question} is the shorthand for a one-question bundle whose
 * `primary` key is the question's own id, which is what its answer appears
 * under in the node's `answers` map.
 */
export type DecisionQuestionEntry = Question | QuestionBundle;

/**
 * The questions a decision port can answer, by `id@version`.
 *
 * A caller may pass an array or a keyed record; either way the lookup key is
 * derived from each entry's own `id` and `version`, so a record key cannot
 * disagree with the entry it points at.
 */
export type QuestionRegistry =
  | readonly DecisionQuestionEntry[]
  | Readonly<Record<string, DecisionQuestionEntry>>;

/** How to build a {@link createDecisionPort}. */
export interface CreateDecisionPortOptions {
  /** The engine that answers. `@internal/decision-jev` provides the real one. */
  readonly engine: DecisionEngine;
  /** Every question or bundle any `jev` node in the workflow may name. */
  readonly questions: QuestionRegistry;
  /**
   * Where each decision's complete evidence is written (M3-T3).
   *
   * Optional, because a workflow run with no database is still a legitimate run
   * (north-star invariant 15) and because M4's own tests run without one. When
   * it is supplied, a failed write **fails the node**.
   */
  readonly storage?: Pick<Storage, "saveDecision">;
  /**
   * What time it is, for a record's `createdAt`. Defaults to the system clock.
   *
   * Injectable for the same reason the trace recorder's clock is: a test that
   * asserts on a stored timestamp should not have to assert on "roughly now".
   */
  readonly now?: () => Date;
}

/** One question's answer as a node's output carries it. */
export type DecisionNodeAnswer = boolean | string | number;

/**
 * What a `jev` node outputs, and what its `outputSchema` validates.
 *
 * Deliberately small and flat, because a node's output is bound into other
 * nodes through the five-case `Binding` model rather than read by code: every
 * field here is something a `branch` node can select on or a downstream node
 * can bind. The full evidence — every distribution, every per-question
 * confidence, the provider's own metadata — is in the stored
 * {@link DecisionRecord}, which `decisionId` points at, rather than copied into
 * every downstream node's input.
 */
export interface DecisionNodeOutput {
  /** The primary question's judgment: a boolean, the chosen option, or the score. */
  readonly answer: DecisionNodeAnswer;
  /** The primary question's harness-derived confidence, or `null`. */
  readonly confidence: number | null;
  /** The band the primary answer falls in, under its own calibration. */
  readonly band: Band;
  /** The primary answer's distribution, verbatim, or `null` when there was none. */
  readonly distribution: Readonly<Record<string, number>> | null;
  /** The decision this answer came from, so the node's output points at its evidence. */
  readonly decisionId: string;
  /**
   * The route the entry's policy chose, or `null` when the entry has no policy.
   *
   * This is what a `branch` selects on: `{ kind: "field", path: ["route"] }`.
   * `null` rather than a fabricated default, because a node nothing routes on
   * has no route and inventing one would be the silent guess ADR-0009 exists to
   * prevent.
   */
  readonly route: string | null;
  /** Why the policy chose it, or empty when there is no policy. */
  readonly reasons: readonly string[];
  /** Every question's answer, under the bundle's own keys. */
  readonly answers: Readonly<Record<string, DecisionNodeAnswer>>;
}

/** True when a registry entry is a bundle rather than a bare question. */
function isBundle(entry: DecisionQuestionEntry): entry is QuestionBundle {
  return Object.hasOwn(entry, "questions");
}

/** Normalize a registry entry into a bundle. */
function toBundle(entry: DecisionQuestionEntry): QuestionBundle {
  if (isBundle(entry)) {
    return entry;
  }

  return {
    id: entry.id,
    version: entry.version,
    kind: entry.kind,
    primary: entry.id,
    questions: { [entry.id]: entry },
  };
}

/**
 * Index a registry by `id@version`, checking each bundle as it goes.
 *
 * @throws {ValidationError} when a bundle's `primary` is not one of its
 * questions, when its declared `kind` is not that question's kind, or when it
 * has no questions at all. All three would only be discovered at the moment a
 * node executed, and a registry is a thing a caller assembles once.
 */
function indexQuestions(questions: QuestionRegistry): Map<string, QuestionBundle> {
  const list = Array.isArray(questions)
    ? (questions as readonly DecisionQuestionEntry[])
    : Object.values(questions as Readonly<Record<string, DecisionQuestionEntry>>);
  const index = new Map<string, QuestionBundle>();
  const issues: ValidationIssue[] = [];

  for (const entry of list) {
    const bundle = toBundle(entry);
    const ref = formatCapabilityRef(bundle);
    const primary = bundle.questions[bundle.primary];

    if (Object.keys(bundle.questions).length === 0) {
      issues.push({ path: [ref, "questions"], message: "expected at least one question" });
    } else if (primary === undefined) {
      issues.push({
        path: [ref, "primary"],
        message: `\`${bundle.primary}\` is not one of the bundle's questions (${Object.keys(bundle.questions).join(", ")})`,
      });
    } else if (primary.kind !== bundle.kind) {
      issues.push({
        path: [ref, "kind"],
        message: `declares \`${bundle.kind}\`, but its primary question \`${bundle.primary}\` is a \`${primary.kind}\` question`,
      });
    }

    index.set(ref, bundle);
  }

  throwIfRegistryIssues(issues);

  return index;
}

function throwIfRegistryIssues(issues: readonly ValidationIssue[]): void {
  if (issues.length > 0) {
    throw new ValidationError("createDecisionPort: invalid question registry", {
      issues: [...issues],
    });
  }
}

/** The band an answer falls in, given its question's calibration. */
function bandOf(question: Question, answer: DecisionAnswer): Band {
  // **An uncalibrated question cannot be auto-routed.** With no bands there is
  // no threshold to clear, and treating that as `auto` would let an
  // uncalibrated question route a case automatically — the exact failure
  // M3-T5 forbids when it rules out one global `.90`. M3-T9's calibration
  // fixture is what earns a question its bands.
  return question.bands === undefined ? "human-review" : bandFor(answer, question.bands);
}

/**
 * Adapt a {@link DecisionEngine} into the port the local workflow runtime calls
 * for a `jev` node.
 *
 * ```ts
 * const runtime = createWorkflowRuntime({
 *   registry,
 *   agentRuntime,
 *   decisionEngine: createDecisionPort({
 *     engine,
 *     questions: [classifyBundle, evidenceSupports],
 *     storage,
 *   }),
 * });
 * ```
 *
 * One node is one engine call, and a bundle's several questions travel in that
 * one call because they share the node's input as their state. That is M3-T6's
 * rule exactly: batching is by **shared state**, and two `jev` nodes in a
 * workflow have different inputs by construction, so they are always two calls.
 *
 * @throws {DecisionError} when the node names a reference the registry does not
 * hold, when the node's declared `questionKind` disagrees with the registered
 * entry's, or when the engine fails. The runtime turns any of these into the
 * node's `decision.failed` span and then into an escalation, which is what "a
 * Jev failure escalates safely rather than silently guessing" means here.
 * @throws {import("@internal/core").StorageError} when a configured store
 * cannot record the decision. The node fails; it does not continue with an
 * unrecorded judgment.
 * @throws {ValidationError} at construction, when a bundle is malformed.
 */
export function createDecisionPort(options: CreateDecisionPortOptions): WorkflowDecisionPort {
  const index = indexQuestions(options.questions);
  const now = options.now ?? ((): Date => new Date());

  return {
    async decide(request: WorkflowDecisionRequest): Promise<JsonValue> {
      const ref = formatCapabilityRef(request.node.question);
      const bundle = index.get(ref);

      if (bundle === undefined) {
        throw new DecisionError(
          `node \`${request.node.id}\` asks \`${ref}\`, which is not registered with this decision port`,
          {
            details: {
              nodeId: request.node.id,
              question: ref,
              registered: [...index.keys()],
            },
          },
        );
      }

      if (bundle.kind !== request.node.questionKind) {
        throw new DecisionError(
          `node \`${request.node.id}\` declares question kind \`${request.node.questionKind}\`, but \`${ref}\` is a \`${bundle.kind}\` question`,
          {
            details: {
              nodeId: request.node.id,
              question: ref,
              declaredKind: request.node.questionKind,
              registeredKind: bundle.kind,
            },
          },
        );
      }

      const result = await options.engine.evaluate({
        state: request.input,
        questions: bundle.questions,
        context: request.context,
      });

      // The policy reads the result and nothing else, and it runs after the
      // engine and before persistence, so the record carries both halves of one
      // decision (ADR-0009, ADR-0045).
      const outcome: PolicyOutcome<string> | null = bundle.policy?.evaluate(result) ?? null;

      if (options.storage !== undefined) {
        const record: DecisionRecord = {
          id: result.decisionId,
          runId: request.context.runId,
          nodeId: request.node.id,
          result,
          policy: outcome,
          createdAt: now().toISOString(),
        };

        // Deliberately not wrapped in a try/catch. A `StorageError` from here
        // is the node's failure, and the runtime's `decision.failed` span plus
        // its escalation are the right handling; catching it would turn a
        // decision nobody recorded into one the workflow acted on anyway.
        await options.storage.saveDecision(record);
      }

      const answers: Record<string, DecisionNodeAnswer> = {};

      for (const key of Object.keys(bundle.questions)) {
        answers[key] = (result.answers[key] as DecisionAnswer).value;
      }

      const primaryQuestion = bundle.questions[bundle.primary] as Question;
      const primary = result.answers[bundle.primary] as DecisionAnswer;
      const output: DecisionNodeOutput = {
        answer: primary.value,
        confidence: primary.confidence,
        band: bandOf(primaryQuestion, primary),
        distribution: primary.distribution,
        decisionId: result.decisionId,
        route: outcome === null ? null : outcome.route,
        reasons: outcome === null ? [] : [...outcome.reasons],
        answers,
      };

      // The output is JSON by construction: every field is a primitive, `null`,
      // an array of strings, or the provider's own JSON distribution.
      return output as unknown as JsonObject;
    },
  };
}
