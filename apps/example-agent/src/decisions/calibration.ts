import {
  type Band,
  bandFor,
  type DecisionAnswer,
  type DecisionEngine,
  type JsonValue,
  type Policy,
  type Question,
  type QuestionSet,
} from "@internal/core";

/**
 * The calibration fixture (M3-T9): run a labeled set through an engine and a
 * policy, and report how well the pair behaves.
 *
 * **Why a fixture needs one at all.** M3-T5 removed the global `.90` threshold
 * and made every question carry its own bands, which is only an improvement if
 * something decides what those numbers should be. This is that something: a
 * small labeled set, the five metrics the build plan names, and a text report
 * a person reads before changing a threshold. Without it, "calibrated" would
 * mean "somebody typed a number".
 *
 * ## The five metrics, defined
 *
 * The build plan names them; what each one means here is stated once, so a
 * number in a report is not open to interpretation:
 *
 * | Metric | Definition |
 * | --- | --- |
 * | confusion matrix | one row per `(expected route, actual route)` pair that occurred, with a count. Routes, not answers, because the route is what the organization acts on. |
 * | accuracy | the fraction of cases whose policy route equals the labeled one. |
 * | uncertain-band rate | the fraction of cases whose **primary** answer did not land in the `auto` band, i.e. the fraction a person or an agent would have to look at. |
 * | false-auto rate | the fraction of cases whose primary answer landed in `auto`, whose route was **not** the fallback, and whose route was wrong. This is the metric that matters: it counts the cases the harness acted on automatically and got wrong. A case that fell back is deliberately **not** counted, however confident the answer was — falling back is not acting. |
 * | fallback rate | the fraction of cases routed to the fallback route (`uncertain` for this fixture), i.e. how often the compiled path gives up. |
 *
 * `perQuestion` adds the same breakdown per question, because the three
 * questions are calibrated separately and a single aggregate would hide which
 * one is miscalibrated.
 *
 * **A high fallback rate is not a failure**, and the report deliberately does
 * not combine it with accuracy into one score. Falling back is the safe
 * outcome (north-star invariant 1); being confidently wrong is not. A reader
 * comparing two threshold sets wants to see the two numbers move against each
 * other, not a single figure that hides the trade.
 */

/** One labeled case: a state, and what the pair is expected to produce. */
export interface CalibrationCase<TRoute extends string> {
  /** A short identifier, printed in the report beside a failure. */
  readonly id: string;
  /** One sentence on what this case is testing. */
  readonly description: string;
  /** The shared state the questions are asked about: a job input. */
  readonly state: JsonValue;
  /** The route the policy is expected to choose. */
  readonly expectedRoute: TRoute;
  /**
   * The answer each question is expected to give, by question-set key.
   *
   * Partial on purpose: a case that is only about the route need not label
   * every question, and a question with no label is counted in neither the
   * per-question numerator nor its denominator.
   */
  readonly expectedAnswers?: Readonly<Record<string, boolean | string | number>>;
}

/** What {@link runCalibration} is given. */
export interface RunCalibrationOptions<TRoute extends string> {
  /** The engine under test. The fixture one by default; live Jev with a credential. */
  readonly engine: DecisionEngine;
  /** The questions to ask, keyed as the policy reads them. */
  readonly questions: QuestionSet;
  /** The policy under test. */
  readonly policy: Policy<QuestionSet, TRoute>;
  /** The labeled set. */
  readonly cases: readonly CalibrationCase<TRoute>[];
  /**
   * Which key of `questions` the band metrics are computed over.
   *
   * The same key the decision port calls `primary`: the answer a `branch`
   * selects on, and therefore the one whose band decides whether the case is
   * acted on automatically.
   */
  readonly primary: string;
  /** The route that means "the compiled path gave up". `fallbackRate` counts it. */
  readonly fallbackRoute: TRoute;
}

/** One `(expected, actual)` pair that occurred, and how often. */
export interface ConfusionCell<TRoute extends string> {
  /** The labeled route. */
  readonly expected: TRoute;
  /** The route the policy chose. */
  readonly actual: TRoute;
  /** How many cases made this pairing. */
  readonly count: number;
}

/** How one question behaved across the set. */
export interface QuestionCalibration {
  /** The question-set key. */
  readonly key: string;
  /** The question's `id@version`, so a report names exactly what was measured. */
  readonly question: string;
  /** How many cases labeled an expected answer for it. */
  readonly labeled: number;
  /** How many of those it answered as labeled. */
  readonly correct: number;
  /** `correct / labeled`, or `1` when nothing was labeled. */
  readonly accuracy: number;
  /** How many of its answers landed in each band. */
  readonly bands: Readonly<Record<Band, number>>;
  /** How many landed in `auto` **and** disagreed with the label. */
  readonly falseAuto: number;
}

/** One case's outcome, kept so a report can name what failed. */
export interface CalibrationOutcome<TRoute extends string> {
  /** The case. */
  readonly case: CalibrationCase<TRoute>;
  /** The route the policy chose. */
  readonly actualRoute: TRoute;
  /** Why it chose it. */
  readonly reasons: readonly string[];
  /** The primary answer's band. */
  readonly band: Band;
  /** The primary answer's confidence, or `null`. */
  readonly confidence: number | null;
  /** Whether the route matched the label. */
  readonly correct: boolean;
}

/** What {@link runCalibration} reports. */
export interface CalibrationReport<TRoute extends string> {
  /** How many cases ran. */
  readonly total: number;
  /** One cell per `(expected, actual)` pair that occurred, most frequent first. */
  readonly confusionMatrix: readonly ConfusionCell<TRoute>[];
  /** The fraction of cases routed as labeled. */
  readonly accuracy: number;
  /** The fraction whose primary answer did not land in `auto`. */
  readonly uncertainBandRate: number;
  /**
   * The fraction that landed in `auto`, did **not** fall back, and were routed
   * wrongly.
   *
   * The one number a reader should refuse to let rise. Raising a threshold
   * cannot increase it, because a threshold that is too high produces
   * fallbacks, and a fallback is not a wrong automatic action.
   */
  readonly falseAutoRate: number;
  /** The fraction routed to `fallbackRoute`. */
  readonly fallbackRate: number;
  /** The same breakdown per question, in the question set's own order. */
  readonly perQuestion: readonly QuestionCalibration[];
  /** Every case, in the order it ran. */
  readonly outcomes: readonly CalibrationOutcome<TRoute>[];
  /** Only the cases whose route did not match, for a reader in a hurry. */
  readonly failures: readonly CalibrationOutcome<TRoute>[];
}

/** A rate, or `0` for an empty set, rounded to four places so a report is stable. */
function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4));
}

/** The band an answer falls in, given its question's calibration. */
function bandOf(question: Question, answer: DecisionAnswer): Band {
  // The same rule `createDecisionPort` applies: an uncalibrated question can
  // never be auto-routed, so it counts towards the uncertain-band rate. That is
  // the honest measurement — a question with no bands genuinely cannot be acted
  // on automatically — and it makes an uncalibrated question visible in the
  // report rather than invisible.
  return question.bands === undefined ? "human-review" : bandFor(answer, question.bands);
}

/**
 * Run a labeled set through an engine and a policy (M3-T9).
 *
 * ```ts
 * const report = await runCalibration({
 *   engine: createVendorDecisionEngine({ vendors: CALIBRATION_VENDORS }),
 *   questions: TRIAGE_QUESTIONS,
 *   policy: createTriagePolicy(),
 *   cases: CALIBRATION_CASES,
 *   primary: "category",
 *   fallbackRoute: "uncertain",
 * });
 *
 * process.stdout.write(renderCalibrationReport(report));
 * ```
 *
 * One engine call per case, because one case is one state and batching is by
 * shared state (M3-T6). Cases run **in order and one at a time**, so a report
 * from a live engine is reproducible and does not depend on how a provider
 * handles concurrency.
 *
 * @throws whatever the engine throws. A calibration run that swallowed a
 * provider failure would report a number computed from fewer cases than it
 * claims, which is worse than not running.
 */
export async function runCalibration<TRoute extends string>(
  options: RunCalibrationOptions<TRoute>,
): Promise<CalibrationReport<TRoute>> {
  const keys = Object.keys(options.questions);
  const outcomes: CalibrationOutcome<TRoute>[] = [];
  const perQuestion = new Map<
    string,
    { labeled: number; correct: number; bands: Record<Band, number>; falseAuto: number }
  >(
    keys.map((key) => [
      key,
      {
        labeled: 0,
        correct: 0,
        bands: { auto: 0, "agent-review": 0, "human-review": 0 },
        falseAuto: 0,
      },
    ]),
  );

  for (const labeled of options.cases) {
    const result = await options.engine.evaluate({
      state: labeled.state,
      questions: options.questions,
    });
    const outcome = options.policy.evaluate(result);
    const primaryAnswer = result.answers[options.primary] as DecisionAnswer;
    const primaryQuestion = options.questions[options.primary] as Question;
    const band = bandOf(primaryQuestion, primaryAnswer);
    const correct = outcome.route === labeled.expectedRoute;

    outcomes.push({
      case: labeled,
      actualRoute: outcome.route,
      reasons: outcome.reasons,
      band,
      confidence: primaryAnswer.confidence,
      correct,
    });

    for (const key of keys) {
      const stats = perQuestion.get(key);
      const answer = result.answers[key] as DecisionAnswer | undefined;

      if (stats === undefined || answer === undefined) {
        continue;
      }

      const answerBand = bandOf(options.questions[key] as Question, answer);

      stats.bands[answerBand] += 1;

      const expected = labeled.expectedAnswers?.[key];

      if (expected === undefined) {
        continue;
      }

      stats.labeled += 1;

      if (answer.value === expected) {
        stats.correct += 1;
      } else if (answerBand === "auto") {
        // Confidently wrong about this question specifically, which is the
        // per-question form of the metric that matters.
        stats.falseAuto += 1;
      }
    }
  }

  const cells = new Map<string, ConfusionCell<TRoute>>();

  for (const outcome of outcomes) {
    const key = `${outcome.case.expectedRoute}\u0000${outcome.actualRoute}`;
    const existing = cells.get(key);

    cells.set(
      key,
      existing === undefined
        ? { expected: outcome.case.expectedRoute, actual: outcome.actualRoute, count: 1 }
        : { ...existing, count: existing.count + 1 },
    );
  }

  const total = outcomes.length;
  const failures = outcomes.filter((outcome) => !outcome.correct);

  return {
    total,
    confusionMatrix: [...cells.values()].sort(
      (left, right) =>
        right.count - left.count ||
        left.expected.localeCompare(right.expected) ||
        left.actual.localeCompare(right.actual),
    ),
    accuracy: rate(total - failures.length, total),
    uncertainBandRate: rate(outcomes.filter((outcome) => outcome.band !== "auto").length, total),
    falseAutoRate: rate(
      outcomes.filter(
        (outcome) =>
          outcome.band === "auto" &&
          outcome.actualRoute !== options.fallbackRoute &&
          !outcome.correct,
      ).length,
      total,
    ),
    fallbackRate: rate(
      outcomes.filter((outcome) => outcome.actualRoute === options.fallbackRoute).length,
      total,
    ),
    perQuestion: keys.map((key) => {
      const stats = perQuestion.get(key) as NonNullable<ReturnType<typeof perQuestion.get>>;
      const question = options.questions[key] as Question;

      return {
        key,
        question: `${question.id}@${question.version}`,
        labeled: stats.labeled,
        correct: stats.correct,
        accuracy: stats.labeled === 0 ? 1 : rate(stats.correct, stats.labeled),
        bands: { ...stats.bands },
        falseAuto: stats.falseAuto,
      };
    }),
    outcomes,
    failures,
  };
}

/** Render a rate as a percentage with one decimal. */
function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/**
 * Render a report as plain text.
 *
 * Text rather than a table library or JSON, because the audience is a person
 * deciding whether to change a threshold and the output is read in a terminal.
 * A caller that wants the numbers has the {@link CalibrationReport} itself.
 */
export function renderCalibrationReport<TRoute extends string>(
  report: CalibrationReport<TRoute>,
): string {
  const lines: string[] = [
    "Vendor-triage calibration",
    "=========================",
    "",
    `Cases:              ${report.total}`,
    `Accuracy:           ${percent(report.accuracy)}`,
    `Uncertain band:     ${percent(report.uncertainBandRate)}  (would need a person or an agent)`,
    `False auto:         ${percent(report.falseAutoRate)}  (acted on automatically and wrong; a fallback is not counted)`,
    `Fallback:           ${percent(report.fallbackRate)}  (the compiled path gave up)`,
    "",
    "Confusion matrix (expected -> actual)",
    "-------------------------------------",
  ];

  for (const cell of report.confusionMatrix) {
    const mark = cell.expected === cell.actual ? "  " : "! ";

    lines.push(`${mark}${cell.expected} -> ${cell.actual}: ${cell.count}`);
  }

  lines.push("", "Per question", "------------");

  for (const question of report.perQuestion) {
    lines.push(
      `${question.key} (${question.question})`,
      `  labeled ${question.labeled}, correct ${question.correct} (${percent(question.accuracy)}), false auto ${question.falseAuto}`,
      `  bands: auto ${question.bands.auto}, agent-review ${question.bands["agent-review"]}, human-review ${question.bands["human-review"]}`,
    );
  }

  if (report.failures.length > 0) {
    lines.push("", "Failures", "--------");

    for (const failure of report.failures) {
      lines.push(
        `${failure.case.id}: expected ${failure.case.expectedRoute}, got ${failure.actualRoute} (band ${failure.band}, confidence ${failure.confidence ?? "none"})`,
        `  ${failure.reasons.join("; ")}`,
      );
    }
  }

  lines.push("");

  return lines.join("\n");
}
