/**
 * The `verify` primitive (M3-T7): compile an agent's structured output into
 * bounded questions about its own evidence, and read the answers back as
 * repair instructions.
 *
 * **It lives in `@internal/core`, not in `@internal/decision-jev`.** Verifying
 * a field is composing questions, and a question is a core contract; nothing
 * here knows what answers it — the same compiled {@link QuestionSet} goes to
 * the Jev adapter, to the fake engine in `@internal/testing`, or to anything
 * else that implements `DecisionEngine`. Putting it in the adapter would tie an
 * engine-agnostic composition to one provider and make it untestable without
 * that provider.
 *
 * ## What it is for
 *
 * The build plan states the shape: given evidence, structured agent output and
 * an output schema, "compile configured fields into Jev questions", and "failed
 * fields should be able to return to the same logical agent task with explicit
 * repair instructions". The two halves of that are
 * {@link compileVerification} and {@link readVerification}, and the repair
 * instruction is a **sentence**, not a flag: it names the field, quotes the
 * value, says what is wrong and says what would fix it, so it can be appended
 * to the same task's input and mean something to the model that reads it.
 *
 * ## One boolean question per field, and why not one question for the whole output
 *
 * A single "is this output supported?" question answers with one bit for an
 * object with ten fields, and a `false` gives a re-run nothing to act on. One
 * question per configured field is what makes "identify a deliberately
 * unsupported field" — Milestone 3's acceptance criterion — mean the field
 * rather than the output. All of them go in **one** engine call, because they
 * share one state, which is exactly M3-T6's batching rule.
 */

import {
  type Band,
  type BooleanDecisionAnswer,
  type BooleanQuestion,
  bandFor,
  type ConfidenceBands,
  type DecisionResult,
  defineQuestionSet,
  type QuestionSet,
} from "./decision.js";
import { ValidationError, type ValidationIssue } from "./errors.js";
import { deepFreeze } from "./freeze.js";
import {
  EXACT_VERSION_MESSAGE,
  IDENTIFIER_MESSAGE,
  isCapabilityIdentifier,
  isExactVersion,
  throwIfIssues,
} from "./identifiers.js";
import { isJsonObject, type JsonObject, type JsonValue } from "./json.js";

/** One field of the output to verify against the evidence. */
export interface VerificationFieldConfig {
  /**
   * Where the field lives in the output, as a property path.
   *
   * Non-empty. A path segment may name an array index as a decimal string, the
   * same way {@link Binding}'s `field` case reads one.
   */
  readonly path: readonly string[];
  /**
   * The question to ask about it, overriding the generated one.
   *
   * Worth setting when the field's name does not say what supporting it would
   * mean — `recommendation.decision` reads better as "Is recommending
   * `proceed` supported by the evidence?" than as the generic form.
   */
  readonly question?: string;
  /**
   * How this field's confidence maps onto the three bands.
   *
   * Per field, because M3-T5 forbids one global threshold and a citation check
   * is not calibrated like a risk judgment. A field with no bands is judged by
   * its answer alone; see {@link readVerification} for exactly what that means.
   */
  readonly bands?: ConfidenceBands;
}

/** What {@link compileVerification} is given. */
export interface CompileVerificationConfig {
  /** The structured output to check. Normally an agent's result. */
  readonly output: JsonValue;
  /**
   * The output's schema reference, e.g. `vendor-triage.output@1.0.0`.
   *
   * Carried into the state so the model sees which contract the output claims
   * to satisfy, and into {@link CompiledVerification} so a caller can record
   * it. Optional, because a caller verifying an unregistered shape still has a
   * legitimate question to ask.
   */
  readonly outputSchema?: string;
  /** What the output is supposed to rest on: documents, citations, tool results. */
  readonly evidence: JsonValue;
  /** The fields to verify. Non-empty. */
  readonly fields: readonly VerificationFieldConfig[];
  /**
   * The id every compiled question carries, before its per-field suffix.
   * Defaults to {@link DEFAULT_VERIFICATION_QUESTION_ID}.
   */
  readonly questionId?: string;
  /**
   * The exact version every compiled question carries. Defaults to
   * {@link DEFAULT_VERIFICATION_QUESTION_VERSION}.
   *
   * It is a real version, not decoration: a verification answer is evidence
   * like any other, so changing how these prompts are worded is a new version.
   */
  readonly questionVersion?: string;
}

/** The default id prefix compiled verification questions carry. */
export const DEFAULT_VERIFICATION_QUESTION_ID = "verify";

/** The default exact version compiled verification questions carry. */
export const DEFAULT_VERIFICATION_QUESTION_VERSION = "1.0.0";

/** One configured field, resolved against the output. */
export interface ResolvedVerificationField {
  /** The key this field's question and answer are under in the set. */
  readonly key: string;
  /** The field's path in the output. */
  readonly path: readonly string[];
  /** The path written the way a person reads it, e.g. `recommendation.decision`. */
  readonly pathText: string;
  /** The value found at the path, or `null` when the output has nothing there. */
  readonly value: JsonValue;
  /** Whether the output actually carries this field. */
  readonly present: boolean;
  /** The boolean question compiled for it. */
  readonly question: BooleanQuestion;
}

/** What {@link compileVerification} produces. */
export interface CompiledVerification {
  /** The questions, ready to hand to `DecisionEngine.evaluate()`. */
  readonly questions: QuestionSet;
  /**
   * The one shared state every question is asked about: `{ evidence, output }`,
   * plus `outputSchema` when one was given.
   *
   * One state, because M3-T6's batching rule is "one shared state, and only
   * one": every field is a question about the same output read against the same
   * evidence, so they are one call by construction rather than by optimization.
   */
  readonly state: JsonValue;
  /** The configured fields, resolved, in the order they were configured. */
  readonly fields: readonly ResolvedVerificationField[];
}

/** One field the evidence does not support, and what to do about it. */
export interface UnsupportedVerificationField {
  /** The field's path in the output. */
  readonly path: readonly string[];
  /** The path written the way a person reads it. */
  readonly pathText: string;
  /** The value that is not supported. */
  readonly value: JsonValue;
  /** The harness-derived confidence in the answer, or `null`. */
  readonly confidence: number | null;
  /** The band the answer fell in, or `null` when the question declares no bands. */
  readonly band: Band | null;
  /**
   * An instruction the same logical agent task can be re-run with.
   *
   * A sentence rather than a code, because it is appended to a prompt: it names
   * the field, quotes the value and says what would fix it.
   */
  readonly repair: string;
}

/** What {@link readVerification} produces. */
export interface VerificationReading {
  /** The fields the evidence supports. */
  readonly supported: readonly ResolvedVerificationField[];
  /** The fields it does not, each with its repair instruction. */
  readonly unsupported: readonly UnsupportedVerificationField[];
  /** Every repair instruction, in field order, for appending to a re-run. */
  readonly repairInstructions: readonly string[];
}

/** Render a path the way a person reads it. */
function formatPath(path: readonly string[]): string {
  return path.join(".");
}

/** Turn a path into a question-set key that cannot collide with another path. */
function keyFor(path: readonly string[]): string {
  return formatPath(path);
}

/** Turn a path into the identifier suffix its question id carries. */
function suffixFor(path: readonly string[]): string {
  // The identifier rule allows `A-Za-z0-9._-`, and a path segment may contain
  // anything, so every other character becomes `-`. Two different paths can
  // therefore share a question id, which is fine: the id says what kind of
  // question this is, and the set key is what distinguishes the fields.
  return path.join(".").replace(/[^A-Za-z0-9._-]/gu, "-");
}

/** Read `path` out of `value`, or report that it is not there. */
function readPath(
  value: JsonValue,
  path: readonly string[],
): { readonly present: boolean; readonly value: JsonValue } {
  let current: JsonValue = value;

  for (const segment of path) {
    if (Array.isArray(current)) {
      const index = Number(segment);

      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return { present: false, value: null };
      }

      current = current[index] as JsonValue;
      continue;
    }

    if (!isJsonObject(current) || !Object.hasOwn(current, segment)) {
      return { present: false, value: null };
    }

    current = current[segment] as JsonValue;
  }

  return { present: true, value: current };
}

/** Quote a value for a prompt or a repair instruction, compactly. */
function quote(value: JsonValue): string {
  const rendered = typeof value === "string" ? value : JSON.stringify(value);

  return rendered.length <= 160 ? rendered : `${rendered.slice(0, 157)}...`;
}

/**
 * Compile an output's configured fields into one batch of boolean questions
 * about the evidence (M3-T7).
 *
 * ```ts
 * const compiled = compileVerification({
 *   output: triage,
 *   outputSchema: "vendor-triage.output@1.0.0",
 *   evidence: documents,
 *   fields: [
 *     { path: ["category"] },
 *     { path: ["recommendation", "decision"], bands: { auto: 0.9, agentReview: 0.7 } },
 *   ],
 * });
 *
 * const result = await engine.evaluate({ state: compiled.state, questions: compiled.questions });
 * const reading = readVerification(result, compiled.fields);
 * ```
 *
 * **A field the output does not carry is still asked about**, with a question
 * that says the field is absent. Dropping it would make a missing required
 * field indistinguishable from a supported one in the reading, and "the output
 * does not contain what it promised" is exactly the kind of failure a
 * verification step exists to surface.
 *
 * @throws {ValidationError} when `fields` is empty, a path is empty, two fields
 * name the same path, or the question id/version is not a valid reference.
 * Every issue is reported at once with a path.
 */
export function compileVerification(config: CompileVerificationConfig): CompiledVerification {
  const questionId = config.questionId ?? DEFAULT_VERIFICATION_QUESTION_ID;
  const questionVersion = config.questionVersion ?? DEFAULT_VERIFICATION_QUESTION_VERSION;
  const issues: ValidationIssue[] = [];

  if (!isCapabilityIdentifier(questionId)) {
    issues.push({ path: ["questionId"], message: IDENTIFIER_MESSAGE });
  }

  if (!isExactVersion(questionVersion)) {
    issues.push({ path: ["questionVersion"], message: EXACT_VERSION_MESSAGE });
  }

  if (!Array.isArray(config.fields) || config.fields.length === 0) {
    issues.push({ path: ["fields"], message: "expected at least one field to verify" });
  }

  const seen = new Set<string>();

  for (const [index, field] of (config.fields ?? []).entries()) {
    if (!Array.isArray(field.path) || field.path.length === 0) {
      issues.push({ path: ["fields", index, "path"], message: "expected a non-empty path" });
      continue;
    }

    if (field.path.some((segment) => typeof segment !== "string" || segment === "")) {
      issues.push({
        path: ["fields", index, "path"],
        message: "expected every path segment to be a non-empty string",
      });
      continue;
    }

    const key = keyFor(field.path);

    if (seen.has(key)) {
      issues.push({
        path: ["fields", index, "path"],
        message: `duplicate field \`${key}\`; two questions about one field would be indistinguishable`,
      });
    }

    seen.add(key);
  }

  throwIfIssues("invalid verification", issues);

  const fields: ResolvedVerificationField[] = config.fields.map((field) => {
    const { present, value } = readPath(config.output, field.path);
    const pathText = formatPath(field.path);
    const question: BooleanQuestion = {
      id: `${questionId}.${suffixFor(field.path)}`,
      version: questionVersion,
      kind: "boolean",
      prompt:
        field.question ??
        (present
          ? `Is \`${pathText}\` = \`${quote(value)}\` supported by the evidence?`
          : `The output does not contain \`${pathText}\`. Is its absence supported by the evidence?`),
      criteria: {
        true: "The evidence contains something that establishes this value.",
        false:
          "The evidence does not establish this value, or contradicts it, or is silent about it.",
      },
      ...(field.bands === undefined ? {} : { bands: field.bands }),
    };

    return {
      key: keyFor(field.path),
      path: [...field.path],
      pathText,
      value,
      present,
      question,
    };
  });

  const state: JsonObject = {
    evidence: config.evidence,
    output: config.output,
    ...(config.outputSchema === undefined ? {} : { outputSchema: config.outputSchema }),
  };

  return deepFreeze({
    // Through `defineQuestionSet()` rather than assembled and returned, so a
    // compiled verification is validated by the same boundary a hand-written
    // question set goes through and cannot be the one question set in the
    // harness that skipped validation.
    questions: defineQuestionSet(
      Object.fromEntries(fields.map((field) => [field.key, field.question])),
    ),
    state,
    fields,
  });
}

/**
 * Read a verification result back as supported fields and repair instructions
 * (M3-T7).
 *
 * **When a field counts as supported.** The answer must be `true`, and when the
 * question declares {@link ConfidenceBands} the band must be `auto`. A field
 * whose question declares no bands is judged by its answer alone, because there
 * is no calibration to apply and inventing one would be the global threshold
 * M3-T5 forbids; a field that does declare bands is held to them, so the same
 * `true` answer becomes unsupported once the evidence stops being convincing.
 * A `null` confidence therefore fails a banded field and passes an unbanded
 * one, which is the honest reading of "the harness cannot score this".
 *
 * @throws {ValidationError} when `result` has no answer for a field, or when an
 * answer is not a boolean. Both mean the result did not come from the
 * questions these fields compiled to, and reading it as if it had would attach
 * one field's judgment to another.
 */
export function readVerification(
  result: DecisionResult<QuestionSet>,
  fields: readonly ResolvedVerificationField[],
): VerificationReading {
  const supported: ResolvedVerificationField[] = [];
  const unsupported: UnsupportedVerificationField[] = [];

  for (const field of fields) {
    const answer = result.answers[field.key] as BooleanDecisionAnswer | undefined;

    if (answer === undefined) {
      throw new ValidationError(
        `readVerification: the result carries no answer for \`${field.key}\``,
        { issues: [{ path: ["answers", field.key], message: "expected an answer" }] },
      );
    }

    if (answer.kind !== "boolean") {
      throw new ValidationError(
        `readVerification: \`${field.key}\` was answered as a \`${answer.kind}\` question, not a boolean`,
        { issues: [{ path: ["answers", field.key, "kind"], message: "expected `boolean`" }] },
      );
    }

    const bands = field.question.bands;
    const band = bands === undefined ? null : bandFor(answer, bands);
    const isSupported = answer.value === true && (band === null || band === "auto");

    if (isSupported) {
      supported.push(field);
      continue;
    }

    unsupported.push({
      path: field.path,
      pathText: field.pathText,
      value: field.value,
      confidence: answer.confidence,
      band,
      repair: repairFor(field, answer.value === true, band),
    });
  }

  return deepFreeze({
    supported,
    unsupported,
    repairInstructions: unsupported.map((field) => field.repair),
  });
}

/**
 * The instruction a failed field returns to the agent task with.
 *
 * Three wordings, because the three failures need three different fixes: a
 * field the evidence contradicts has to be cited or removed, a field the
 * evidence supports only weakly has to be cited better, and a field the output
 * never produced has to be produced.
 */
function repairFor(
  field: ResolvedVerificationField,
  answeredTrue: boolean,
  band: Band | null,
): string {
  if (!field.present) {
    return `The field \`${field.pathText}\` is missing from the output, and its absence is not supported by the evidence; produce it, or state in the output why it cannot be established.`;
  }

  if (answeredTrue) {
    return `The field \`${field.pathText}\` (\`${quote(field.value)}\`) is only weakly supported by the evidence (band \`${band ?? "unknown"}\`); cite the specific source that establishes it, or weaken the claim to what the evidence carries.`;
  }

  return `The field \`${field.pathText}\` (\`${quote(field.value)}\`) is not supported by the evidence; cite a source that establishes it, or remove it.`;
}
