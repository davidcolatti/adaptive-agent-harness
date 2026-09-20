/**
 * Bounded probabilistic judgment, and the deterministic policy that consumes it
 * (M3-T1, M3-T4, M3-T5, M3-T6).
 *
 * **The split this module exists to enforce is AD-009/ADR-0009**: "Jev answers
 * bounded questions. TypeScript decides what follows." A {@link DecisionEngine}
 * produces a {@link DecisionResult} and decides nothing; a {@link Policy} reads
 * that result and produces a route, with no I/O at all. The two are separate
 * values, separately versioned and separately persisted (M3-T3), which is what
 * makes the milestone's acceptance criterion — "changing a policy threshold can
 * replay stored decisions without rerunning Jev" — structurally true rather
 * than a promise.
 *
 * **Everything here is a contract, not an implementation.** The package has no
 * dependencies and must keep none, so the AI SDK's experimental evaluation API
 * appears nowhere in this file; `@internal/decision-jev` maps between it and
 * these types, and is the only place the experimental surface exists (build
 * plan, Milestone 3: "Keep that experimental API isolated inside the adapter
 * package").
 *
 * **Naming against the AI SDK.** M3-T1 says "keep harness naming aligned with
 * AI SDK where practical", and the three kinds — `boolean`, `choice`, `score` —
 * are its names exactly, already spelled in `JEV_QUESTION_KINDS`. Three
 * deliberate divergences are recorded in ADR-0042: this module says `kind`
 * where the SDK says `type` (because `kind` is what `JevQuestionKind` and
 * `CapabilityKind` already say), `prompt` where the SDK says `instructions`,
 * and a `choices` list beside optional descriptions where the SDK has a single
 * `criteria` map (because an ordered, uniqueness-checkable list is what a
 * question contract has to validate).
 */

import type { CapabilityRef } from "./capabilities.js";
import type { ExecutionContext } from "./context.js";
import { ValidationError, type ValidationIssue } from "./errors.js";
import { fingerprint } from "./fingerprint.js";
import { deepFreeze } from "./freeze.js";
import { collectRefIssues, throwIfIssues } from "./identifiers.js";
import type { DecisionId } from "./ids.js";
import type { JsonObject, JsonValue } from "./json.js";
import { isJsonObject } from "./json.js";
import { JEV_QUESTION_KINDS, type JevQuestionKind } from "./workflow-nodes.js";

/**
 * The kinds of question the harness can ask.
 *
 * The same three names a `jev` node already carries, re-exported under the name
 * this module uses so that a caller working with questions never has to import
 * a workflow type to name one. M4 declared them first because a `jev` node had
 * to branch on an answer shape before M3 existed; they are one list.
 */
export type QuestionKind = JevQuestionKind;

/** The three question kinds, in the order the build plan lists them. */
export const QUESTION_KINDS = JEV_QUESTION_KINDS;

/** What every question carries, whatever its kind. */
export interface QuestionBase {
  /**
   * The question's stable id, under the identifier rule every named thing in
   * the harness obeys (`isCapabilityIdentifier`).
   */
  readonly id: string;
  /**
   * The exact `major.minor.patch` version of this question's wording and
   * options.
   *
   * **A question is versioned because its answers are evidence.** A stored
   * decision is only comparable with another one when both answered the same
   * question, so changing a prompt, adding a choice or renaming a score level
   * is a new version, not an edit. A `jev` node names `question.id@version` for
   * exactly this reason.
   */
  readonly version: string;
  /** Which of the three answer shapes this question asks for. */
  readonly kind: QuestionKind;
  /**
   * What the model is asked, in words.
   *
   * The AI SDK calls this field `instructions`; ADR-0042 records why the
   * harness says `prompt`.
   */
  readonly prompt: string;
  /**
   * How this question's confidence maps onto the three bands (M3-T5).
   *
   * **Per question, deliberately.** M3-T5 says "do not define one global `.90`
   * threshold", so there is no default here to inherit: a question with no
   * bands has no automatic route, and {@link bandFor} cannot be called for it
   * until the domain calibrates one (M3-T9).
   */
  readonly bands?: ConfidenceBands;
}

/** Descriptions for a boolean question's two outcomes. */
export interface BooleanCriteria {
  /** What a `true` answer means, when saying so helps. */
  readonly true?: string;
  /** What a `false` answer means, when saying so helps. */
  readonly false?: string;
}

/** A yes/no judgment. */
export interface BooleanQuestion extends QuestionBase {
  readonly kind: "boolean";
  /** Optional descriptions of the two outcomes. */
  readonly criteria?: BooleanCriteria;
}

/** A judgment that picks one of a fixed set of named options. */
export interface ChoiceQuestion extends QuestionBase {
  readonly kind: "choice";
  /**
   * The options, in the order a human reads them. Non-empty, and every entry
   * distinct: a duplicated option would make an answer ambiguous and a
   * distribution unkeyable.
   */
  readonly choices: readonly string[];
  /**
   * What each option means, keyed by option. Optional per option, and an option
   * with no description is passed through with none rather than with an
   * invented one.
   */
  readonly choiceDescriptions?: Readonly<Record<string, string>>;
}

/**
 * A judgment that places the state on an ordered rubric.
 *
 * **The scale is the rubric, and the rubric is documented by its levels.**
 * `levels` is at least two ordered descriptions, and the answer is a fractional
 * position in `[0, levels.length - 1]` — see {@link scoreRange}. That is the AI
 * SDK's own score model, and the reason this contract does not carry a free
 * `min`/`max` pair: a bare numeric range says nothing about what a 3 means,
 * while a level list says it in the question, where a calibration fixture can
 * check it.
 */
export interface ScoreQuestion extends QuestionBase {
  readonly kind: "score";
  /** At least two ordered level descriptions, indexed from zero. */
  readonly levels: readonly string[];
}

/** One question of any kind. */
export type Question = BooleanQuestion | ChoiceQuestion | ScoreQuestion;

/**
 * Several questions asked of one shared state (M3-T6).
 *
 * The key is the caller's own name for the question within this request, and it
 * is what the answers come back under. It is deliberately not the question id:
 * one request may legitimately ask the same question of two parts of a state,
 * and the AI SDK's own `questions` map is keyed the same way.
 */
export type QuestionSet = Readonly<Record<string, Question>>;

/** The inclusive numeric range a {@link ScoreQuestion}'s answer falls in. */
export interface ScoreRange {
  /** Always zero: the first level's index. */
  readonly min: number;
  /** `levels.length - 1`: the last level's index. */
  readonly max: number;
}

/** The range `question`'s score is expressed in. */
export function scoreRange(question: ScoreQuestion): ScoreRange {
  return { min: 0, max: question.levels.length - 1 };
}

/**
 * Per-question confidence calibration (M3-T5).
 *
 * Two thresholds cut the unit interval into the build plan's three bands:
 *
 * | Confidence | Band |
 * | --- | --- |
 * | `>= auto` | `auto` |
 * | `>= agentReview` | `agent-review` |
 * | below, or absent | `human-review` |
 *
 * **There is no default pair.** M3-T5's whole point is that a threshold is a
 * property of a calibrated question, not of the harness.
 */
export interface ConfidenceBands {
  /** At or above this confidence, the answer may be acted on automatically. */
  readonly auto: number;
  /** At or above this confidence, an agent reviews the answer. */
  readonly agentReview: number;
}

/** The three routes a confidence band can produce. */
export const BANDS = ["auto", "agent-review", "human-review"] as const;

/** One of {@link BANDS}. */
export type Band = (typeof BANDS)[number];

/** What every answer carries, whatever its kind. */
export interface DecisionAnswerBase {
  /** The id of the question answered. */
  readonly questionId: string;
  /** The exact version of the question answered. */
  readonly questionVersion: string;
  /** The kind of the question answered; the discriminant of this union. */
  readonly kind: QuestionKind;
  /**
   * The probability distribution the provider supplied, or `null` when it
   * supplied none.
   *
   * **`null` is a real and common case, and must not be papered over.** The
   * installed AI SDK makes a distribution optional for `choice` and `score`,
   * and the harness records absence rather than synthesizing one, because an
   * invented distribution would be indistinguishable from a measured one in
   * storage and in a calibration report. Keys are option names for `choice`,
   * zero-based level indices as strings for `score`, and `"true"`/`"false"`
   * for `boolean`.
   */
  readonly distribution: Readonly<Record<string, number>> | null;
  /**
   * How much probability mass sits on the answer given, or `null` when it
   * cannot be derived.
   *
   * Derived by {@link deriveConfidence}, which is the harness's own rule
   * (ADR-0042) because the installed API exposes no portable confidence.
   * `null` fails closed: {@link bandFor} maps it to `"human-review"`.
   */
  readonly confidence: number | null;
}

/** A boolean question's answer. */
export interface BooleanDecisionAnswer extends DecisionAnswerBase {
  readonly kind: "boolean";
  /** The judgment itself. */
  readonly value: boolean;
  /**
   * The provider's estimate of P(true), in `[0, 1]`.
   *
   * **This is not confidence**, and the installed AI SDK guide says so
   * explicitly: `0.98` is a strong yes and `0.02` is a strong no, so the
   * confidence in a `false` answer at `0.02` is `0.98`. That conversion is
   * {@link deriveConfidence}'s job; this field is the raw number.
   */
  readonly probabilityTrue: number;
}

/** A choice question's answer, with the chosen option's literal type. */
export interface ChoiceDecisionAnswer<TChoice extends string = string> extends DecisionAnswerBase {
  readonly kind: "choice";
  /** The option chosen. */
  readonly value: TChoice;
}

/** A score question's answer. */
export interface ScoreDecisionAnswer extends DecisionAnswerBase {
  readonly kind: "score";
  /** A fractional position on the rubric, within {@link scoreRange}. */
  readonly value: number;
}

/** One answer of any kind. */
export type DecisionAnswer = BooleanDecisionAnswer | ChoiceDecisionAnswer | ScoreDecisionAnswer;

/**
 * The answer type a given question produces.
 *
 * Mirrors the installed AI SDK's own `EvaluationAnswer<QUESTION>` conditional,
 * including the literal inference that makes a choice answer's `value` the
 * union of that question's options rather than bare `string`.
 */
export type AnswerFor<TQuestion extends Question> = TQuestion extends {
  readonly kind: "choice";
  readonly choices: readonly (infer TChoice extends string)[];
}
  ? ChoiceDecisionAnswer<TChoice>
  : TQuestion extends { readonly kind: "score" }
    ? ScoreDecisionAnswer
    : TQuestion extends { readonly kind: "boolean" }
      ? BooleanDecisionAnswer
      : DecisionAnswer;

/** Which model produced a decision. */
export interface DecisionModelRef {
  /** The provider, e.g. `gateway`. */
  readonly provider: string;
  /** The model id the provider resolved, e.g. `typesafe-ai/jev`. */
  readonly modelId: string;
}

/**
 * What a decision cost.
 *
 * Every field is nullable because the installed evaluation API leaves token
 * counts `undefined` when a provider does not report them, and exposes **no
 * cost at all** — neither `experimental_evaluate`'s result nor the provider-level
 * `EvaluationModelV4Result` has a cost field. `costUsd` is therefore `null`
 * until a provider surfaces one, and an adapter must not estimate it.
 */
export interface DecisionUsage {
  /** Input tokens, when the provider reports them. */
  readonly inputTokens: number | null;
  /** Output tokens, when the provider reports them. */
  readonly outputTokens: number | null;
  /** Total tokens; available only when both halves are. */
  readonly totalTokens: number | null;
  /** Spend in US dollars, when the provider reports it. */
  readonly costUsd: number | null;
}

/**
 * One engine call: several questions over one shared state (M3-T6).
 *
 * **Batching is by shared state, not by convenience.** The build plan asks for
 * "one shared state to answer several independent questions in one Jev call
 * where semantics permit", and the installed API has exactly that shape and no
 * other: it "does not ... batch unrelated states", so two states are two calls.
 */
export interface DecisionRequest<TQuestions extends QuestionSet> {
  /** The evidence every question in this request is asked about. */
  readonly state: JsonValue;
  /** The questions, keyed by the names their answers come back under. */
  readonly questions: TQuestions;
  /** Cancellation, when the caller has a signal of its own. */
  readonly signal?: AbortSignal;
  /**
   * The run this decision belongs to, when there is one.
   *
   * **It is provenance and cancellation, not a trace sink.** An engine must not
   * emit `decision.*` events (ADR-0042): the caller owns the span, because the
   * workflow runtime already opens one around a `jev` node and one request may
   * answer several questions that no single node span could describe. An engine
   * that is given a context propagates `context.signal` and may read
   * `context.budget`; it records nothing.
   */
  readonly context?: ExecutionContext;
}

/**
 * The complete, JSON-representable evidence of one engine call.
 *
 * **Every field is JSON-representable on purpose.** M3-T3 persists this value
 * verbatim, and M12 replays a stored one through a changed policy. Nothing here
 * is a class, a `Date` or a function, so `JSON.parse(JSON.stringify(result))`
 * is the same value.
 */
export interface DecisionResult<TQuestions extends QuestionSet> {
  /** This decision's identifier, minted by the engine. */
  readonly decisionId: DecisionId;
  /** One answer per question, under the request's own keys. */
  readonly answers: { readonly [K in keyof TQuestions]: AnswerFor<TQuestions[K]> };
  /**
   * `fingerprint(state)`: the canonical-JSON digest of the evidence this
   * decision was made from (ADR-0029).
   *
   * It is what lets a replay say "the same state" without storing the state
   * twice, and what M12 compares when deciding whether stored evidence is still
   * the evidence.
   */
  readonly stateFingerprint: string;
  /** Which model answered. */
  readonly model: DecisionModelRef;
  /** What the call cost, as far as the provider reports it. */
  readonly usage: DecisionUsage;
  /** Wall-clock duration of the engine call, in milliseconds. */
  readonly latencyMs: number;
  /**
   * Provider-specific metadata, verbatim, or `null`.
   *
   * Where a provider's own statistics live — the installed guide names
   * `providerMetadata.typesafe.confidence` as TypeSafe's separate choice/score
   * statistic, and says in the same breath that it "is not ... a portable
   * confidence measure". The harness therefore carries it without interpreting
   * it, and {@link DecisionAnswerBase.confidence} stays the harness's own
   * derivation.
   */
  readonly providerMetadata: JsonObject | null;
  /** Provider warnings, rendered as strings. */
  readonly warnings: readonly string[];
}

/**
 * Whatever can answer bounded questions (build plan section 5, verbatim).
 *
 * **Failure is an exception, never a guess.** An engine that cannot obtain a
 * judgment — provider error, unsupported question kind, malformed answer,
 * cancellation — throws {@link DecisionError}. It must not return a fabricated
 * answer, a default choice or a zero confidence, because a caller cannot tell
 * those apart from a real low-confidence judgment. The caller escalates; that
 * is what the milestone's "a Jev failure escalates safely rather than silently
 * guessing" means in code, and it is why `packages/workflow`'s runtime turns a
 * thrown `DecisionError` into an escalation rather than into an answer.
 */
export interface DecisionEngine {
  /** Answer every question in `request` against its one shared state. */
  evaluate<TQuestions extends QuestionSet>(
    request: DecisionRequest<TQuestions>,
  ): Promise<DecisionResult<TQuestions>>;
}

/** What a policy decided, and why (M3-T4). */
export interface PolicyOutcome<TRoute extends string> {
  /** The route chosen. */
  readonly route: TRoute;
  /** Which policy chose it, so a stored outcome names its own author. */
  readonly policy: CapabilityRef;
  /**
   * Why, in words a human reviewing a routed case can read.
   *
   * Required, and required to be non-empty: an outcome without a reason is an
   * unauditable one, and ADR-0009's whole premise is that the organization's
   * decision is inspectable separately from the model's judgment.
   */
  readonly reasons: readonly string[];
}

/** What {@link definePolicy}'s routing function returns. */
export interface PolicyDecision<TRoute extends string> {
  /** The route chosen. */
  readonly route: TRoute;
  /** Why. */
  readonly reasons: readonly string[];
}

/**
 * A deterministic, versioned rule from a {@link DecisionResult} to a route
 * (M3-T4).
 *
 * **A policy performs no I/O.** It is a pure function of a result it is handed,
 * which is what makes "changing a policy threshold can replay stored decisions
 * without rerunning Jev" true: a stored result parsed back from JSON is a
 * legitimate argument, and a new policy version over the same result is a new
 * outcome with no engine call.
 */
export interface Policy<TQuestions extends QuestionSet, TRoute extends string> {
  /** The policy's stable id. */
  readonly id: string;
  /** The exact version of this policy's thresholds and rules. */
  readonly version: string;
  /**
   * The thresholds this policy applies, as JSON, exposed for fingerprinting.
   *
   * ADR-0009 requires thresholds to be "versioned and replayable". Exposing
   * them as data means {@link policyFingerprint} can hash them, so two policies
   * that share a version but not a threshold are detectable rather than
   * silently equal.
   */
  readonly thresholds: JsonObject;
  /** Route one result. Deterministic, total and free of I/O. */
  evaluate(result: DecisionResult<TQuestions>): PolicyOutcome<TRoute>;
}

/** What {@link definePolicy} is given. */
export interface DefinePolicyConfig<TQuestions extends QuestionSet, TRoute extends string> {
  /** The policy's stable id. */
  readonly id: string;
  /** The exact version of this policy. */
  readonly version: string;
  /** The thresholds this policy applies, as JSON. */
  readonly thresholds: JsonObject;
  /** The routing rule itself. */
  readonly route: (result: DecisionResult<TQuestions>) => PolicyDecision<TRoute>;
}

/** True when `value` is a finite number in `[0, 1]`. */
function isProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** Collect the issues in one question, prefixing each path with `path`. */
function collectQuestionIssues(
  question: Question,
  path: readonly (string | number)[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [...collectRefIssues(question.id, question.version, path)];

  if (typeof question.prompt !== "string" || question.prompt.trim() === "") {
    issues.push({ path: [...path, "prompt"], message: "expected a non-empty prompt" });
  }

  if (question.bands !== undefined) {
    issues.push(...collectBandIssues(question.bands, [...path, "bands"]));
  }

  switch (question.kind) {
    case "choice": {
      const { choices } = question;

      if (!Array.isArray(choices) || choices.length === 0) {
        issues.push({
          path: [...path, "choices"],
          message: "expected at least one choice",
        });
        break;
      }

      const seen = new Set<string>();

      for (const [index, choice] of choices.entries()) {
        if (typeof choice !== "string" || choice === "") {
          issues.push({
            path: [...path, "choices", index],
            message: "expected a non-empty option name",
          });
          continue;
        }

        if (seen.has(choice)) {
          issues.push({
            path: [...path, "choices", index],
            message: `duplicate option \`${choice}\`; an answer would be ambiguous`,
          });
        }

        seen.add(choice);
      }

      for (const described of Object.keys(question.choiceDescriptions ?? {})) {
        if (!seen.has(described)) {
          issues.push({
            path: [...path, "choiceDescriptions", described],
            message: `describes \`${described}\`, which is not one of the choices`,
          });
        }
      }

      break;
    }

    case "score": {
      const { levels } = question;

      if (!Array.isArray(levels) || levels.length < 2) {
        issues.push({
          path: [...path, "levels"],
          message: "expected at least two ordered levels; a one-level rubric has nothing to score",
        });
        break;
      }

      for (const [index, level] of levels.entries()) {
        if (typeof level !== "string" || level.trim() === "") {
          issues.push({
            path: [...path, "levels", index],
            message: "expected a non-empty level description",
          });
        }
      }

      break;
    }

    case "boolean":
      break;

    default: {
      // `kind` is a closed union, so this is only reachable from untyped input.
      const unknownKind: string = String((question as { kind?: unknown }).kind);

      issues.push({
        path: [...path, "kind"],
        message: `expected one of ${QUESTION_KINDS.join(", ")}, received \`${unknownKind}\``,
      });
    }
  }

  return issues;
}

/** Collect the issues in a {@link ConfidenceBands} pair. */
function collectBandIssues(
  bands: ConfidenceBands,
  path: readonly (string | number)[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!isProbability(bands.auto)) {
    issues.push({ path: [...path, "auto"], message: "expected a number in [0, 1]" });
  }

  if (!isProbability(bands.agentReview)) {
    issues.push({ path: [...path, "agentReview"], message: "expected a number in [0, 1]" });
  }

  if (isProbability(bands.auto) && isProbability(bands.agentReview)) {
    if (bands.agentReview > bands.auto) {
      issues.push({
        path,
        message: `expected agentReview <= auto; ${bands.agentReview} > ${bands.auto} would make the auto band unreachable`,
      });
    }
  }

  return issues;
}

/**
 * Validate one question and return it, deeply frozen.
 *
 * The same shape `defineDomain()` has: validation happens once, at the boundary
 * where a question is declared, so nothing downstream has to re-check it.
 *
 * @throws {ValidationError} when the id, version, prompt, bands, choices or
 * levels are invalid. Every issue is reported at once, with a path.
 */
export function defineQuestion<TQuestion extends Question>(question: TQuestion): TQuestion {
  throwIfIssues(`invalid question \`${String(question.id)}\``, collectQuestionIssues(question, []));

  return deepFreeze(question);
}

/**
 * Validate a whole {@link QuestionSet} and return it, deeply frozen.
 *
 * Reports every question's issues in one error, pathed by the set's own key, so
 * a domain declaring six questions learns about all six problems at once.
 *
 * @throws {ValidationError} when the set is empty or any question is invalid.
 * The set is required to be non-empty because the installed evaluation API
 * requires a non-empty question map, and an empty request is a caller bug
 * rather than a decision with no answers.
 */
export function defineQuestionSet<TQuestions extends QuestionSet>(
  questions: TQuestions,
): TQuestions {
  const entries = Object.entries(questions);
  const issues: ValidationIssue[] =
    entries.length === 0
      ? [{ path: [], message: "expected at least one question" }]
      : entries.flatMap(([key, question]) => collectQuestionIssues(question, [key]));

  throwIfIssues("invalid question set", issues);

  return deepFreeze(questions);
}

/**
 * Validate a {@link ConfidenceBands} pair and return it, frozen.
 *
 * @throws {ValidationError} when either threshold is outside `[0, 1]`, or when
 * `agentReview` exceeds `auto`. Equal thresholds are legal and collapse the
 * agent-review band to nothing, which is a calibration a domain may genuinely
 * want.
 */
export function defineConfidenceBands(bands: ConfidenceBands): ConfidenceBands {
  throwIfIssues("invalid confidence bands", collectBandIssues(bands, []));

  return deepFreeze(bands);
}

/** The shape {@link deriveConfidence} needs: an answer's kind, value and distribution. */
export type DerivableAnswer = Pick<DecisionAnswer, "kind" | "distribution"> & {
  readonly value: boolean | string | number;
};

/**
 * How much probability mass sits on the answer given, or `null`.
 *
 * **This is a harness-owned derivation** (ADR-0042, AD-016): the installed AI
 * SDK states plainly that it "does not promise calibration across providers"
 * and that a provider's own confidence statistic "is not ... a portable
 * confidence measure", so a single comparable number has to be defined here or
 * not exist at all. The rule is one sentence per kind:
 *
 * | Kind | Confidence |
 * | --- | --- |
 * | `boolean` | the mass on the side answered: `P(true)` for `true`, `1 - P(true)` for `false`. |
 * | `choice` | the chosen option's probability, when a distribution exists. |
 * | `score` | the mass within half a level of the score, when a distribution exists. |
 *
 * The score rule needs its justification stated, because it is the one that is
 * not obvious. A score's distribution is over rubric levels and the score is
 * its probability-weighted mean, so the distribution describes *spread*, not
 * certainty in a selected option. Summing the mass within `±0.5` of the answer
 * asks the only question a band can act on — "how concentrated is the model on
 * the level it landed on?" — and it degrades correctly: a distribution split
 * evenly between the ends produces a middling score with almost no mass near
 * it, and therefore a low confidence, which is the right answer.
 *
 * Returns `null` when there is no distribution to read, when the distribution
 * is empty, or when the relevant entry is missing or not a probability.
 * `null` is not zero: it means unknown, and {@link bandFor} fails it closed.
 */
export function deriveConfidence(answer: DerivableAnswer): number | null {
  const { distribution } = answer;

  if (distribution === null || Object.keys(distribution).length === 0) {
    return null;
  }

  switch (answer.kind) {
    case "boolean": {
      const key = answer.value === true ? "true" : "false";
      const mass = distribution[key];

      return isProbability(mass) ? mass : null;
    }

    case "choice": {
      const mass = distribution[String(answer.value)];

      return isProbability(mass) ? mass : null;
    }

    case "score": {
      const score = answer.value;

      if (typeof score !== "number" || !Number.isFinite(score)) {
        return null;
      }

      let mass = 0;

      for (const [key, probability] of Object.entries(distribution)) {
        const level = Number(key);

        if (!Number.isInteger(level) || !isProbability(probability)) {
          continue;
        }

        if (Math.abs(level - score) <= 0.5) {
          mass += probability;
        }
      }

      // Rounded provider output can push a sum a hair past one; clamping keeps
      // the contract's "in [0, 1]" true without rewriting the provider's values,
      // which are preserved verbatim in `distribution`.
      return Math.min(1, mass);
    }

    default:
      return null;
  }
}

/**
 * The band a confidence falls in.
 *
 * **Missing confidence is `human-review`, always.** A decision the harness
 * cannot score is a decision it must not act on, and the alternative — treating
 * absence as zero, or as "probably fine" — is exactly the silent guess the
 * milestone's acceptance criteria forbid.
 */
export function bandForConfidence(confidence: number | null, bands: ConfidenceBands): Band {
  if (confidence === null || !isProbability(confidence)) {
    return "human-review";
  }

  if (confidence >= bands.auto) {
    return "auto";
  }

  if (confidence >= bands.agentReview) {
    return "agent-review";
  }

  return "human-review";
}

/** The band `answer` falls in under `bands` (M3-T5). */
export function bandFor(answer: DecisionAnswerBase, bands: ConfidenceBands): Band {
  return bandForConfidence(answer.confidence, bands);
}

/**
 * Declare a deterministic, versioned policy (M3-T4).
 *
 * ```ts
 * const result = await decisionEngine.evaluate(request);
 * const route = policy.evaluate(result);
 * ```
 *
 * The returned policy stamps its own `{ id, version }` onto every outcome, so a
 * persisted outcome names the policy version that produced it without the
 * caller remembering to record it (M3-T3 stores "policy version that consumed
 * the answer").
 *
 * @throws {ValidationError} when the id or version is invalid, when
 * `thresholds` is not a JSON object, or when the routing function returns an
 * outcome with no reasons.
 */
export function definePolicy<TQuestions extends QuestionSet, TRoute extends string>(
  config: DefinePolicyConfig<TQuestions, TRoute>,
): Policy<TQuestions, TRoute> {
  const issues: ValidationIssue[] = collectRefIssues(config.id, config.version, []);

  if (!isJsonObject(config.thresholds)) {
    issues.push({
      path: ["thresholds"],
      message: "expected a JSON object; thresholds are hashed and stored, so they must be data",
    });
  }

  if (typeof config.route !== "function") {
    issues.push({ path: ["route"], message: "expected a routing function" });
  }

  throwIfIssues(`invalid policy \`${String(config.id)}\``, issues);

  const ref: CapabilityRef = deepFreeze({ id: config.id, version: config.version });
  const thresholds = deepFreeze({ ...config.thresholds });

  return {
    id: config.id,
    version: config.version,
    thresholds,
    evaluate(result: DecisionResult<TQuestions>): PolicyOutcome<TRoute> {
      const decision = config.route(result);

      if (decision.reasons.length === 0) {
        throw new ValidationError(
          `policy \`${config.id}@${config.version}\` routed to \`${decision.route}\` with no reason`,
          { issues: [{ path: ["reasons"], message: "expected at least one reason" }] },
        );
      }

      return deepFreeze({
        route: decision.route,
        policy: ref,
        reasons: [...decision.reasons],
      });
    },
  };
}

/**
 * The `sha256:` digest of a policy's identity and thresholds (ADR-0009,
 * ADR-0029).
 *
 * What makes "thresholds are versioned and replayable" checkable: a policy
 * whose numbers changed without its version changing has a different
 * fingerprint, and a replay that expected the old one can say so.
 */
export function policyFingerprint(policy: Policy<QuestionSet, string>): string {
  return fingerprint({
    id: policy.id,
    version: policy.version,
    thresholds: policy.thresholds,
  });
}
