/**
 * The persisted evidence of one decision, and the pure replay over it
 * (M3-T3). **ADR-0045** records the design; `docs/contracts/decision-engine.md`
 * documents it.
 *
 * ## What "complete evidence" means
 *
 * The build plan lists nine things M3-T3 must store. Every one of them is
 * reachable from a {@link DecisionRecord}, and this table says from where, so
 * that a future reader can check the claim rather than trust it:
 *
 * | Build plan item | Where it lives |
 * | --- | --- |
 * | question ID/version | `result.answers[key].questionId` / `.questionVersion` |
 * | input-state fingerprint | `result.stateFingerprint` |
 * | answer | `result.answers[key].value` |
 * | available probability distribution | `result.answers[key].distribution`, `null` when the provider gave none |
 * | confidence metadata | `result.answers[key].confidence` (harness-derived) plus `result.providerMetadata` (the provider's own, verbatim) |
 * | model/provider | `result.model.modelId` / `.provider` |
 * | cost | `result.usage.costUsd`, and `usage`'s three token counts |
 * | latency | `result.latencyMs` |
 * | policy version that consumed the answer | `policy.policy.id` / `.version` |
 *
 * `costUsd` is `null` for every record this milestone writes, and that is a
 * measurement rather than an omission: the installed evaluation API exposes no
 * cost anywhere, neither on its result nor on the provider-level model result,
 * and an estimate would be indistinguishable from a reported number once it was
 * in a column.
 *
 * ## Why the raw result and the policy outcome are two fields of one record
 *
 * Milestone 3's acceptance criterion is "raw Jev result is stored separately
 * from policy outcome", and this is what separately means here: `result` is
 * exactly what the engine produced and `policy` is exactly what the
 * organization decided about it, so adding, changing or removing a policy
 * cannot alter a single byte of `result`. They are one row because they were
 * produced by one call about one state, and splitting them across two tables
 * would buy nothing and cost a join on the only query anyone makes.
 *
 * That split is what makes {@link replayDecisions} possible at all: a stored
 * `result` is a complete, JSON-representable argument for
 * `Policy.evaluate()`, so re-routing history is a pure function call and not a
 * second Jev bill.
 */

import type { CapabilityRef } from "./capabilities.js";
import {
  type DecisionAnswer,
  type DecisionResult,
  type Policy,
  type PolicyOutcome,
  QUESTION_KINDS,
  type QuestionKind,
  type QuestionSet,
} from "./decision.js";
import { ValidationError, type ValidationIssue } from "./errors.js";
import { FINGERPRINT_ALGORITHM_PREFIX } from "./fingerprint.js";
import { deepFreeze } from "./freeze.js";
import {
  collectRefIssues,
  EXACT_VERSION_MESSAGE,
  IDENTIFIER_MESSAGE,
  isCapabilityIdentifier,
  isExactVersion,
  throwIfIssues,
} from "./identifiers.js";
import { type DecisionId, parseEntityId, type RunId } from "./ids.js";
import { isJsonObject, isPlainObject, type JsonObject } from "./json.js";
import { isNodeId, type NodeId } from "./workflow-nodes.js";

/**
 * One decision, as it is stored.
 *
 * Everything here is JSON-representable, because the whole value round-trips
 * through a `jsonb` column and through frozen replay evidence. Nothing is a
 * class, a `Date` or a function.
 */
export interface DecisionRecord {
  /**
   * The decision's identifier.
   *
   * Always equal to `result.decisionId`, and {@link parseDecisionRecord}
   * enforces it. The engine mints the id when it answers; carrying it twice
   * would let a row's key and its evidence disagree about which decision it is.
   */
  readonly id: DecisionId;
  /** The run the decision was made in, which is how a trace and a record join. */
  readonly runId: RunId;
  /**
   * The workflow node that asked, or `null`.
   *
   * `null` is a real case rather than a gap: a decision may be made by a `code`
   * node calling the engine directly, or outside a workflow altogether, and a
   * fabricated node id would make a trace impossible to line up.
   */
  readonly nodeId: NodeId | null;
  /** Exactly what the engine produced. Never edited by a policy. */
  readonly result: DecisionResult<QuestionSet>;
  /**
   * What the policy that consumed this answer decided, or `null` when no policy
   * consumed it.
   *
   * `null` is the honest record of a judgment nobody routed on — a `verify`
   * node's answer read by a downstream handler, for instance — and it is what a
   * test asserts to prove the two halves really are separate.
   */
  readonly policy: PolicyOutcome<string> | null;
  /** When the record was written, as an ISO 8601 string. */
  readonly createdAt: string;
}

/** The six fields a {@link DecisionRecord} has, and the only ones accepted. */
const DECISION_RECORD_FIELDS = ["id", "runId", "nodeId", "result", "policy", "createdAt"] as const;

/** The eight fields a {@link DecisionResult} has. */
const DECISION_RESULT_FIELDS = [
  "decisionId",
  "answers",
  "stateFingerprint",
  "model",
  "usage",
  "latencyMs",
  "providerMetadata",
  "warnings",
] as const;

/** The four fields a `DecisionUsage` has, each a number or `null`. */
const USAGE_FIELDS = ["inputTokens", "outputTokens", "totalTokens", "costUsd"] as const;

const QUESTION_KIND_SET: ReadonlySet<string> = new Set<string>(QUESTION_KINDS);

/** `sha256:` followed by 64 lowercase hex characters (ADR-0029). */
const FINGERPRINT_PATTERN = new RegExp(`^${FINGERPRINT_ALGORITHM_PREFIX}[0-9a-f]{64}$`);

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && value !== "" && Number.isFinite(Date.parse(value));
}

function isProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function collectUnknownKeyIssues(
  record: { readonly [key: string]: unknown },
  allowed: readonly string[],
  path: readonly (string | number)[],
): ValidationIssue[] {
  return Object.keys(record)
    .filter((key) => !allowed.includes(key))
    .map((key) => ({ path: [...path, key], message: "unknown field" }));
}

/** Collect the issues in one answer. */
function collectAnswerIssues(
  value: unknown,
  path: readonly (string | number)[],
): ValidationIssue[] {
  if (!isPlainObject(value)) {
    return [{ path: [...path], message: "expected a decision answer object" }];
  }

  const kind = value.kind;
  const issues: ValidationIssue[] = [];

  // Checked field by field rather than through `collectRefIssues`, so that the
  // reported path says `questionId`/`questionVersion` — the names this shape
  // actually uses — instead of the `id`/`version` a capability reference has.
  if (!isCapabilityIdentifier(value.questionId)) {
    issues.push({ path: [...path, "questionId"], message: IDENTIFIER_MESSAGE });
  }

  if (!isExactVersion(value.questionVersion)) {
    issues.push({ path: [...path, "questionVersion"], message: EXACT_VERSION_MESSAGE });
  }

  if (typeof kind !== "string" || !QUESTION_KIND_SET.has(kind)) {
    issues.push({
      path: [...path, "kind"],
      message: `expected one of ${QUESTION_KINDS.join(", ")}`,
    });
  }

  const allowed = ["questionId", "questionVersion", "kind", "value", "distribution", "confidence"];

  if (kind === "boolean") {
    allowed.push("probabilityTrue");
  }

  issues.push(...collectUnknownKeyIssues(value, allowed, path));

  if (value.distribution !== null) {
    if (!isJsonObject(value.distribution)) {
      issues.push({
        path: [...path, "distribution"],
        message: "expected a JSON object of probabilities, or null",
      });
    } else {
      for (const [key, mass] of Object.entries(value.distribution)) {
        if (!isProbability(mass)) {
          issues.push({
            path: [...path, "distribution", key],
            message: "expected a number in [0, 1]",
          });
        }
      }
    }
  }

  if (value.confidence !== null && !isProbability(value.confidence)) {
    issues.push({
      path: [...path, "confidence"],
      message: "expected a number in [0, 1] or null",
    });
  }

  switch (kind) {
    case "boolean": {
      if (typeof value.value !== "boolean") {
        issues.push({ path: [...path, "value"], message: "expected a boolean" });
      }

      if (!isProbability(value.probabilityTrue)) {
        issues.push({
          path: [...path, "probabilityTrue"],
          message: "expected a number in [0, 1]",
        });
      }

      break;
    }

    case "choice": {
      if (typeof value.value !== "string" || value.value === "") {
        issues.push({ path: [...path, "value"], message: "expected a non-empty option name" });
      }

      break;
    }

    case "score": {
      if (typeof value.value !== "number" || !Number.isFinite(value.value)) {
        issues.push({ path: [...path, "value"], message: "expected a finite number" });
      }

      break;
    }

    default:
      break;
  }

  return issues;
}

/** Collect the issues in a {@link DecisionResult}. */
function collectResultIssues(
  value: unknown,
  path: readonly (string | number)[],
): ValidationIssue[] {
  if (!isPlainObject(value)) {
    return [{ path: [...path], message: "expected a decision result object" }];
  }

  const issues: ValidationIssue[] = [
    ...collectUnknownKeyIssues(value, DECISION_RESULT_FIELDS, path),
  ];

  try {
    parseEntityId("decision", value.decisionId);
  } catch {
    issues.push({ path: [...path, "decisionId"], message: "expected a DecisionId" });
  }

  if (!isPlainObject(value.answers) || Object.keys(value.answers).length === 0) {
    issues.push({
      path: [...path, "answers"],
      message: "expected at least one answer, keyed as the request keyed its questions",
    });
  } else {
    for (const [key, answer] of Object.entries(value.answers)) {
      issues.push(...collectAnswerIssues(answer, [...path, "answers", key]));
    }
  }

  // The fingerprint format is checked rather than assumed: a row whose
  // `stateFingerprint` is not a `sha256:` digest cannot be compared with one
  // that is, and a replay that silently compared a truncated string would look
  // like it worked.
  if (
    typeof value.stateFingerprint !== "string" ||
    !FINGERPRINT_PATTERN.test(value.stateFingerprint)
  ) {
    issues.push({
      path: [...path, "stateFingerprint"],
      message: `expected a \`${FINGERPRINT_ALGORITHM_PREFIX}<64 hex>\` digest`,
    });
  }

  if (!isPlainObject(value.model)) {
    issues.push({ path: [...path, "model"], message: "expected a `{ provider, modelId }` object" });
  } else {
    issues.push(
      ...collectUnknownKeyIssues(value.model, ["provider", "modelId"], [...path, "model"]),
    );

    for (const field of ["provider", "modelId"] as const) {
      if (typeof value.model[field] !== "string" || value.model[field] === "") {
        issues.push({ path: [...path, "model", field], message: "expected a non-empty string" });
      }
    }
  }

  if (!isPlainObject(value.usage)) {
    issues.push({ path: [...path, "usage"], message: "expected a decision usage object" });
  } else {
    issues.push(...collectUnknownKeyIssues(value.usage, USAGE_FIELDS, [...path, "usage"]));

    for (const field of USAGE_FIELDS) {
      const held = value.usage[field];

      if (held !== null && (typeof held !== "number" || !Number.isFinite(held))) {
        issues.push({
          path: [...path, "usage", field],
          message: "expected a finite number or null",
        });
      }
    }
  }

  if (!Number.isInteger(value.latencyMs) || (value.latencyMs as number) < 0) {
    issues.push({ path: [...path, "latencyMs"], message: "expected an integer >= 0" });
  }

  if (value.providerMetadata !== null && !isJsonObject(value.providerMetadata)) {
    issues.push({
      path: [...path, "providerMetadata"],
      message: "expected a JSON object or null",
    });
  }

  if (!Array.isArray(value.warnings)) {
    issues.push({ path: [...path, "warnings"], message: "expected an array of strings" });
  } else {
    for (const [index, warning] of value.warnings.entries()) {
      if (typeof warning !== "string") {
        issues.push({ path: [...path, "warnings", index], message: "expected a string" });
      }
    }
  }

  return issues;
}

/** Collect the issues in a {@link PolicyOutcome}. */
function collectPolicyOutcomeIssues(
  value: unknown,
  path: readonly (string | number)[],
): ValidationIssue[] {
  if (!isPlainObject(value)) {
    return [{ path: [...path], message: "expected a policy outcome object" }];
  }

  const issues: ValidationIssue[] = [
    ...collectUnknownKeyIssues(value, ["route", "policy", "reasons"], path),
  ];

  if (typeof value.route !== "string" || value.route === "") {
    issues.push({ path: [...path, "route"], message: "expected a non-empty route" });
  }

  if (!isPlainObject(value.policy)) {
    issues.push({ path: [...path, "policy"], message: "expected an `{ id, version }` reference" });
  } else {
    issues.push(...collectRefIssues(value.policy.id, value.policy.version, [...path, "policy"]));
  }

  // A stored outcome with no reason is an unauditable one, and `definePolicy`
  // already refuses to produce one. Reading a row that has none back as valid
  // would let a hand-edited record defeat the rule the writer enforces.
  if (!Array.isArray(value.reasons) || value.reasons.length === 0) {
    issues.push({ path: [...path, "reasons"], message: "expected at least one reason" });
  } else {
    for (const [index, reason] of value.reasons.entries()) {
      if (typeof reason !== "string" || reason.trim() === "") {
        issues.push({
          path: [...path, "reasons", index],
          message: "expected a non-empty reason",
        });
      }
    }
  }

  return issues;
}

/** Rebuild one answer from a checked value. */
function readAnswer(value: { readonly [key: string]: unknown }): DecisionAnswer {
  const base = {
    questionId: value.questionId as string,
    questionVersion: value.questionVersion as string,
    distribution: value.distribution as Readonly<Record<string, number>> | null,
    confidence: value.confidence as number | null,
  };

  switch (value.kind as QuestionKind) {
    case "boolean":
      return {
        ...base,
        kind: "boolean",
        value: value.value as boolean,
        probabilityTrue: value.probabilityTrue as number,
      };

    case "choice":
      return { ...base, kind: "choice", value: value.value as string };

    case "score":
      return { ...base, kind: "score", value: value.value as number };
  }
}

/**
 * Turn an untrusted value into a {@link DecisionRecord}, or throw explaining
 * why it is not one.
 *
 * The same strict read boundary `parseJob()`, `parseRunRecord()` and
 * `parseWorkflowVersionRecord()` are, and for the same reason: a `jsonb` column,
 * a replay fixture or a hand-edited row is an `unknown` claiming to be
 * evidence, and asserting the claim is not checking it. Every problem is
 * reported at once with a path, an unknown field is an error rather than
 * something to drop, and the returned record is deep-frozen.
 *
 * Three checks are worth naming because they are the ones a corrupted row
 * fails: `id` must equal `result.decisionId`, `stateFingerprint` must be a
 * `sha256:<64 hex>` digest, and a `policy` that is present must carry at least
 * one reason.
 *
 * @throws {ValidationError} listing every field that failed.
 */
export function parseDecisionRecord(
  value: unknown,
  path: readonly (string | number)[] = [],
): DecisionRecord {
  if (!isPlainObject(value)) {
    throw new ValidationError("parseDecisionRecord: value is not a decision record", {
      issues: [{ path: [...path], message: "expected a decision record object" }],
    });
  }

  const issues: ValidationIssue[] = [
    ...collectUnknownKeyIssues(value, DECISION_RECORD_FIELDS, path),
  ];

  try {
    parseEntityId("decision", value.id);
  } catch {
    issues.push({ path: [...path, "id"], message: "expected a DecisionId" });
  }

  try {
    parseEntityId("run", value.runId);
  } catch {
    issues.push({ path: [...path, "runId"], message: "expected a RunId" });
  }

  if (value.nodeId !== null && !isNodeId(value.nodeId)) {
    issues.push({ path: [...path, "nodeId"], message: "expected a node id or null" });
  }

  issues.push(...collectResultIssues(value.result, [...path, "result"]));

  if (
    isPlainObject(value.result) &&
    typeof value.result.decisionId === "string" &&
    typeof value.id === "string" &&
    value.result.decisionId !== value.id
  ) {
    issues.push({
      path: [...path, "result", "decisionId"],
      message: `expected \`${value.id}\`, the record's own id; a row whose key and evidence disagree is not one decision`,
    });
  }

  if (value.policy !== null) {
    issues.push(...collectPolicyOutcomeIssues(value.policy, [...path, "policy"]));
  }

  if (!isIsoTimestamp(value.createdAt)) {
    issues.push({ path: [...path, "createdAt"], message: "expected an ISO 8601 timestamp" });
  }

  throwIfIssues("parseDecisionRecord: value is not a decision record", issues);

  const result = value.result as { readonly [key: string]: unknown };
  const model = result.model as { readonly [key: string]: unknown };
  const usage = result.usage as { readonly [key: string]: unknown };
  const answers = Object.fromEntries(
    Object.entries(result.answers as { readonly [key: string]: unknown }).map(([key, answer]) => [
      key,
      readAnswer(answer as { readonly [key: string]: unknown }),
    ]),
  );
  const policy = value.policy as { readonly [key: string]: unknown } | null;

  return deepFreeze({
    id: parseEntityId("decision", value.id),
    runId: parseEntityId("run", value.runId),
    nodeId: value.nodeId as NodeId | null,
    result: {
      decisionId: parseEntityId("decision", result.decisionId),
      answers,
      stateFingerprint: result.stateFingerprint as string,
      model: { provider: model.provider as string, modelId: model.modelId as string },
      usage: {
        inputTokens: usage.inputTokens as number | null,
        outputTokens: usage.outputTokens as number | null,
        totalTokens: usage.totalTokens as number | null,
        costUsd: usage.costUsd as number | null,
      },
      latencyMs: result.latencyMs as number,
      providerMetadata: result.providerMetadata as JsonObject | null,
      warnings: [...(result.warnings as readonly string[])],
    } as DecisionResult<QuestionSet>,
    policy:
      policy === null
        ? null
        : {
            route: policy.route as string,
            policy: policy.policy as CapabilityRef,
            reasons: [...(policy.reasons as readonly string[])],
          },
    createdAt: value.createdAt as string,
  });
}

/** One stored decision, re-routed through a policy (M3-T3). */
export interface ReplayedDecision<TRoute extends string> {
  /** The record as it is stored. Never modified. */
  readonly record: DecisionRecord;
  /** The outcome the record already carried, or `null` when no policy consumed it. */
  readonly stored: PolicyOutcome<string> | null;
  /** The outcome the replayed policy produces from the same stored result. */
  readonly replayed: PolicyOutcome<TRoute>;
  /** Whether the route moved. `true` when nothing was stored and something is now. */
  readonly changed: boolean;
}

/** How a route changed across a replay, and how often. */
export interface RouteChange<TRoute extends string> {
  /** The route that was stored, or `null` when none was. */
  readonly from: string | null;
  /** The route the replayed policy produces. */
  readonly to: TRoute;
  /** How many records made this move. */
  readonly count: number;
}

/** What {@link replayDecisions} reports. */
export interface DecisionReplayReport<TRoute extends string> {
  /** One entry per input record, in input order. */
  readonly decisions: readonly ReplayedDecision<TRoute>[];
  /** How many records were replayed. */
  readonly total: number;
  /** How many produced a different route than the one stored. */
  readonly changed: number;
  /** How many produced the same route. */
  readonly unchanged: number;
  /** Every `from -> to` move that happened, newest-route-first by count then label. */
  readonly routeChanges: readonly RouteChange<TRoute>[];
}

/**
 * Re-route stored decisions through a policy, without calling an engine
 * (M3-T3).
 *
 * ```ts
 * const stored = await storage.listDecisions(runId);
 * const report = replayDecisions(stored, tighterPolicy);
 *
 * report.changed; // how many cases the new thresholds would have routed differently
 * ```
 *
 * **This is Milestone 3's acceptance criterion "changing a policy threshold can
 * replay stored decisions without rerunning Jev", as a function.** It is pure:
 * it constructs nothing, performs no I/O, and reads only the `result` half of
 * each record, which is exactly the half a policy is contractually allowed to
 * see. The engine is not a parameter, so it cannot be called.
 *
 * A record whose stored `policy` is `null` is still replayed, and counts as
 * changed: nothing routed it before and something routes it now, which is a
 * difference a report would be wrong to hide.
 *
 * @throws {ValidationError} if `policy.evaluate` rejects a stored result — which
 * `definePolicy` does when a routing function returns no reason. The failure is
 * about the policy, not about the record, and it is loud for that reason.
 */
export function replayDecisions<TRoute extends string>(
  records: readonly DecisionRecord[],
  policy: Policy<QuestionSet, TRoute>,
): DecisionReplayReport<TRoute> {
  const decisions: ReplayedDecision<TRoute>[] = records.map((record) => {
    const replayed = policy.evaluate(record.result);

    return {
      record,
      stored: record.policy,
      replayed,
      changed: record.policy === null || record.policy.route !== replayed.route,
    };
  });

  const counts = new Map<string, RouteChange<TRoute>>();

  for (const entry of decisions) {
    if (!entry.changed) {
      continue;
    }

    const from = entry.stored === null ? null : entry.stored.route;
    const key = `${from ?? "\u0000none"}\u0000${entry.replayed.route}`;
    const existing = counts.get(key);

    counts.set(
      key,
      existing === undefined
        ? { from, to: entry.replayed.route, count: 1 }
        : { ...existing, count: existing.count + 1 },
    );
  }

  const changed = decisions.filter((entry) => entry.changed).length;

  return deepFreeze({
    decisions,
    total: decisions.length,
    changed,
    unchanged: decisions.length - changed,
    routeChanges: [...counts.values()].sort(
      (left, right) =>
        right.count - left.count ||
        (left.from ?? "").localeCompare(right.from ?? "") ||
        left.to.localeCompare(right.to),
    ),
  });
}
