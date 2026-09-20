import {
  type Band,
  bandFor,
  type DecisionAnswer,
  type DecisionEngine,
  DecisionError,
  formatCapabilityRef,
  type JsonObject,
  type JsonValue,
  type Question,
} from "@internal/core";
import type { WorkflowDecisionPort, WorkflowDecisionRequest } from "./ports.js";

/**
 * The bridge from M4's {@link WorkflowDecisionPort} to M3's
 * {@link DecisionEngine}.
 *
 * `ports.ts` says exactly what this file is for: "When M3 lands, this port is
 * what its engine is adapted to, and nothing in the interpreter changes."
 * Nothing in the interpreter does. A `jev` node **names** a question
 * (`question.id@version`) and does not define one, so the missing half has
 * always been a registry of questions; that is what the caller supplies here.
 *
 * **This adapter emits no trace events.** `workflow-runtime.ts` already opens a
 * `decision.started` span around every `jev` node and closes it with
 * `decision.completed` or `decision.failed`, and the engine is contractually
 * silent (ADR-0042), so a decision produces exactly one span whichever path it
 * takes. Anything else would double-count a Jev call in the inspector's "Jev
 * calls" line.
 */

/**
 * The questions a decision port can answer, by `id@version`.
 *
 * A caller may pass an array or a keyed record; either way the lookup key is
 * derived from each question's own `id` and `version`, so a record key cannot
 * disagree with the question it points at.
 */
export type QuestionRegistry = readonly Question[] | Readonly<Record<string, Question>>;

/** How to build a {@link createDecisionPort}. */
export interface CreateDecisionPortOptions {
  /** The engine that answers. `@internal/decision-jev` provides the real one. */
  readonly engine: DecisionEngine;
  /** Every question any `jev` node in the workflow may name. */
  readonly questions: QuestionRegistry;
}

/**
 * What a `jev` node outputs, and what its `outputSchema` validates.
 *
 * Deliberately small and flat, because a node's output is bound into other
 * nodes through the five-case `Binding` model rather than read by code: every
 * field here is something a `branch` node can select on or a downstream node
 * can bind.
 */
export interface DecisionNodeOutput {
  /** The judgment: a boolean, the chosen option, or the score. */
  readonly answer: boolean | string | number;
  /** The harness-derived confidence, or `null` when none could be derived. */
  readonly confidence: number | null;
  /** The band the answer falls in, under the question's own calibration. */
  readonly band: Band;
  /** The probability distribution, verbatim, or `null` when the provider gave none. */
  readonly distribution: Readonly<Record<string, number>> | null;
  /** The decision this answer came from, so the node's output points at its evidence. */
  readonly decisionId: string;
}

/** Index a registry by `id@version`. */
function indexQuestions(questions: QuestionRegistry): Map<string, Question> {
  const list = Array.isArray(questions)
    ? (questions as readonly Question[])
    : Object.values(questions as Readonly<Record<string, Question>>);
  const index = new Map<string, Question>();

  for (const question of list) {
    index.set(formatCapabilityRef(question), question);
  }

  return index;
}

/** Turn one answer into the node's output, banding it by the question's bands. */
function toNodeOutput(
  question: Question,
  answer: DecisionAnswer,
  decisionId: string,
): DecisionNodeOutput {
  return {
    answer: answer.value,
    confidence: answer.confidence,
    // **An uncalibrated question cannot be auto-routed.** With no bands there is
    // no threshold to clear, and treating that as `auto` would let an
    // uncalibrated question route a case automatically — the exact failure
    // M3-T5 forbids when it rules out one global `.90`. M3-T9's calibration
    // fixture is what earns a question its bands.
    band: question.bands === undefined ? "human-review" : bandFor(answer, question.bands),
    distribution: answer.distribution,
    decisionId,
  };
}

/**
 * Adapt a {@link DecisionEngine} into the port the local workflow runtime calls
 * for a `jev` node.
 *
 * ```ts
 * const runtime = createWorkflowRuntime({
 *   registry,
 *   agentRuntime,
 *   decisionEngine: createDecisionPort({ engine, questions: [classify, verify] }),
 * });
 * ```
 *
 * One node asks one question, so one call carries one question. That is not a
 * loss of M3-T6's batching: batching is by **shared state**, and two `jev`
 * nodes in a workflow have different inputs by construction. A workflow that
 * genuinely wants several questions over one state asks them from a `code` node
 * that calls the engine directly.
 *
 * @throws {DecisionError} when the node names a question the registry does not
 * hold, when the node's declared `questionKind` disagrees with the registered
 * question's kind, or when the engine fails. The runtime turns any of these
 * into the node's `decision.failed` span and then into an escalation, which is
 * what "a Jev failure escalates safely rather than silently guessing" means
 * here.
 */
export function createDecisionPort(options: CreateDecisionPortOptions): WorkflowDecisionPort {
  const index = indexQuestions(options.questions);

  return {
    async decide(request: WorkflowDecisionRequest): Promise<JsonValue> {
      const ref = formatCapabilityRef(request.node.question);
      const question = index.get(ref);

      if (question === undefined) {
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

      if (question.kind !== request.node.questionKind) {
        throw new DecisionError(
          `node \`${request.node.id}\` declares question kind \`${request.node.questionKind}\`, but \`${ref}\` is a \`${question.kind}\` question`,
          {
            details: {
              nodeId: request.node.id,
              question: ref,
              declaredKind: request.node.questionKind,
              registeredKind: question.kind,
            },
          },
        );
      }

      const result = await options.engine.evaluate({
        state: request.input,
        questions: { [ref]: question },
        context: request.context,
      });

      const answer = result.answers[ref] as DecisionAnswer;

      // The output is JSON by construction: every field of `DecisionNodeOutput`
      // is a primitive, `null`, or the provider's own JSON distribution.
      return toNodeOutput(question, answer, result.decisionId) as unknown as JsonObject;
    },
  };
}
