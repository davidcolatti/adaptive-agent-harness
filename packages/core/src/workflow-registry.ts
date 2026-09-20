import {
  type CapabilityManifest,
  type CapabilityRef,
  formatCapabilityRef,
} from "./capabilities.js";
import { HARNESS_RUNTIME_INFO } from "./context.js";
import { ValidationError, type ValidationIssue } from "./errors.js";
import { deepFreeze } from "./freeze.js";
import {
  collectRefIssues,
  EXACT_VERSION_MESSAGE,
  IDENTIFIER_MESSAGE,
  isCapabilityIdentifier,
  isExactVersion,
  throwIfIssues,
} from "./identifiers.js";
import { type PromotionId, parseEntityId, type WorkflowId, type WorkflowVersionId } from "./ids.js";
import type { Job } from "./job.js";
import type { JsonObject } from "./json.js";
import { isJsonObject, isPlainObject } from "./json.js";
import {
  parseWorkflowDefinition,
  type WorkflowDefinition,
  workflowFingerprint,
} from "./workflow-ir.js";

/**
 * The workflow registry model (M5-T1) and the compatibility selector (M5-T2).
 * **ADR-0043** records the design; `docs/contracts/workflow-registry.md`
 * documents it.
 *
 * Milestone 5's whole question is "should this job run a compiled workflow or
 * the full agent?", and this module is the half of the answer that is pure
 * data. It declares what a workflow *version* is, the seven states it can be
 * in, the transitions between them, what a version *declares about the jobs it
 * can handle*, and the deterministic function that picks one. The service that
 * stores and promotes versions is `@internal/registry`; the router that calls
 * the selector is M5-T3. Neither is here, because neither is a contract.
 *
 * Three rules shape everything below.
 *
 * - **Promotion is human-invoked** (AD-005). Nothing in this module moves a
 *   workflow from one state to another on its own: {@link canTransition} says
 *   whether a move is *legal*, and something with an `actor` performs it. There
 *   is no automatic promotion, and there is deliberately no place to put one.
 * - **Matching is exact** (AD-015). A promoted workflow pins its capabilities
 *   at exact versions, and the selector resolves them at exactly those
 *   versions: no range, no "latest", no nearest match. Schemas compare by
 *   reference string, the way M4's validator already compares them
 *   (ADR-0039), because a structural comparison would silently accept a schema
 *   that happens to look alike today.
 * - **Never route by name alone** (build plan M5-T2, verbatim). A workflow's id
 *   is not one of the things the selector looks at. Every check below is about
 *   what the workflow *declares it needs* against what the job and the
 *   environment *actually provide*.
 */

/**
 * The seven states a workflow version can be in, in the order build plan M5-T1
 * lists them.
 *
 * Exported as a runtime constant as well as a type so that a validator, a
 * reader and the database check constraint share one list rather than three
 * copies that drift — the same reason {@link RUN_STATUSES} is.
 */
export const WORKFLOW_STATUSES = [
  "draft",
  "candidate",
  "shadow",
  "canary",
  "active",
  "retired",
  "rejected",
] as const;

/** One of {@link WORKFLOW_STATUSES}. */
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

const WORKFLOW_STATUS_SET: ReadonlySet<string> = new Set<string>(WORKFLOW_STATUSES);

/** True when `value` is a member of the closed status set. */
export function isWorkflowStatus(value: unknown): value is WorkflowStatus {
  return typeof value === "string" && WORKFLOW_STATUS_SET.has(value);
}

/**
 * Which status may follow which, stated as a table rather than as code.
 *
 * The build plan lists the seven states and stops; the edges between them are
 * this project's choice, recorded in ADR-0043 and written here so that the
 * reason a transition is refused is readable rather than inferred from a chain
 * of conditionals.
 *
 * | From | To | Why |
 * | --- | --- | --- |
 * | `draft` | `candidate`, `rejected` | A draft is proposed for evaluation, or thrown away. It cannot reach traffic. |
 * | `candidate` | `shadow`, `canary`, `active`, `rejected` | A candidate has been evaluated. The three forward edges are the three exposure levels a human may choose. |
 * | `shadow` | `canary`, `active`, `retired`, `rejected` | Shadow runs beside the agent without serving. It can widen, or stop. |
 * | `canary` | `active`, `retired`, `rejected` | Canary serves a slice. It can widen to all traffic, or stop. |
 * | `active` | `retired` | The only exit from serving. `rejected` is a verdict on a version that never served; retiring one that did is not the same statement. |
 * | `retired` | — | Terminal. A retired version is history. |
 * | `rejected` | — | Terminal. Re-proposing means registering a new version. |
 *
 * There is **no edge back into `draft`**, and none out of a terminal state. A
 * version's identity is its IR fingerprint, so "the same workflow, reworked" is
 * a different version with a different id, and a registry that let a retired
 * version come back would make the promotion ledger unreadable.
 */
export const WORKFLOW_STATUS_TRANSITIONS: {
  readonly [status in WorkflowStatus]: readonly WorkflowStatus[];
} = Object.freeze({
  draft: Object.freeze(["candidate", "rejected"] as const),
  candidate: Object.freeze(["shadow", "canary", "active", "rejected"] as const),
  shadow: Object.freeze(["canary", "active", "retired", "rejected"] as const),
  canary: Object.freeze(["active", "retired", "rejected"] as const),
  active: Object.freeze(["retired"] as const),
  retired: Object.freeze([] as const),
  rejected: Object.freeze([] as const),
});

/**
 * True when a version in `from` may legally move to `to`.
 *
 * A move to the same status is **not** a transition and returns `false`: the
 * promotion ledger records changes, and a no-op row in it would be a change
 * that did not happen.
 */
export function canTransition(from: WorkflowStatus, to: WorkflowStatus): boolean {
  return WORKFLOW_STATUS_TRANSITIONS[from].includes(to);
}

/**
 * What a workflow version declares about the jobs it can handle (M5-T2).
 *
 * Build plan M5-T2 lists six things a workflow declares — domain, job type,
 * supported input schema, required capabilities, SOP compatibility and minimum
 * harness version — and this is those six, with the output schema added because
 * a workflow that produced a different shape from the one the job promises its
 * caller would be a type error nobody checked.
 *
 * It is **derived**, not authored: {@link describeWorkflowCompatibility} reads
 * it off a compiled workflow, so a version cannot declare compatibility its IR
 * does not actually have. The one thing the IR does not carry is the SOP, which
 * is why that argument is supplied.
 */
export interface WorkflowCompatibility {
  /** The domain id the workflow belongs to. Not version-pinned; see ADR-0038. */
  readonly domainId: string;
  /** The job type within that domain the workflow handles. */
  readonly jobType: string;
  /** The input schema reference, `id@version`, matching `Job.contracts`. */
  readonly inputSchema: string;
  /** The output schema reference, `id@version`. */
  readonly outputSchema: string;
  /**
   * Every capability the IR references, at the exact version it references it.
   *
   * Sorted by id then version and deduplicated, so two versions of one workflow
   * produce byte-identical lists when they need the same things.
   * {@link collectRequiredCapabilities} is what fills it, and a `jev` node's
   * question is deliberately **not** in it: a question is not a capability kind
   * (M3 owns it), so there would be nothing to resolve it against.
   */
  readonly requiredCapabilities: readonly CapabilityRef[];
  /**
   * The SOP identifier the workflow was authored against.
   *
   * Bare, matching `Job.contracts.sop`: M2 settled that the SOP reference is an
   * identifier with no version, because the SOP's *content* is captured by the
   * behavior fingerprint's `sop` component (ADR-0034) rather than by a version
   * string somebody has to remember to bump.
   */
  readonly sop: string;
  /**
   * The `sha256:` digest of that SOP's content when the author knew it.
   *
   * Optional, because the identifier is what a `Job` carries and a caller that
   * has no fingerprint is not thereby incompatible. When **both** sides have
   * one, the selector compares them, which is how "the SOP was rewritten under
   * the same name" stops being invisible.
   */
  readonly sopFingerprint?: string;
  /**
   * The oldest harness version that can run this workflow, as an exact
   * `major.minor.patch` string.
   *
   * A minimum rather than an exact pin: a harness newer than the one a workflow
   * was compiled against is the normal case, and refusing it would retire every
   * workflow on every harness release.
   */
  readonly minHarnessVersion: string;
}

/**
 * What {@link describeWorkflowCompatibility} needs beyond the IR.
 *
 * `sop` is required because the workflow IR does not carry one: a workflow is
 * authored *against* an SOP, and the IR describes the graph rather than the
 * procedure it came from. Passing it explicitly at registration is what keeps
 * the declaration honest rather than defaulted.
 */
export interface DescribeWorkflowCompatibilityOptions {
  /** The SOP identifier the workflow was authored against. */
  readonly sop: string;
  /** The `sha256:` digest of the SOP's content, when it is known. */
  readonly sopFingerprint?: string;
  /**
   * The oldest harness version that can run it. Defaults to the harness
   * version that is registering it, `HARNESS_RUNTIME_INFO.version`.
   */
  readonly minHarnessVersion?: string;
}

/**
 * The shape {@link describeWorkflowCompatibility} reads.
 *
 * Structurally a `CompiledWorkflow` from `@internal/workflow`, which is what
 * callers actually pass. It is declared structurally rather than imported
 * because the dependency rule runs the other way: `@internal/workflow` depends
 * on this package, not the reverse.
 */
export interface CompiledWorkflowLike {
  /** The validated, capability-resolved IR. */
  readonly definition: WorkflowDefinition;
}

/** Compare two capability references for the sorted, deduplicated list. */
function compareRefs(left: CapabilityRef, right: CapabilityRef): number {
  if (left.id !== right.id) {
    return left.id < right.id ? -1 : 1;
  }

  return left.version < right.version ? -1 : left.version > right.version ? 1 : 0;
}

/**
 * Every capability a workflow's IR references, at the exact versions it
 * references them.
 *
 * The list mirrors `collectCapabilityIssues()` in `@internal/workflow`, which
 * is the function that *resolves* these references at compile time: the
 * workflow's two schemas, each node's two schemas, a `code` or `reduce` node's
 * handler, a `call` node's tool, an `agent` node's agent, and the policy a
 * `branch` or a `loop` may select on. A `jev` node's `question` is excluded for
 * the reason M4-T9 excludes it — a question is not one of the five capability
 * kinds, and M3 owns validating that one exists.
 *
 * Schema references are strings in the IR and objects here, because the
 * manifest is keyed by `{ id, version }`; the conversion is
 * `parseCapabilityRefString`'s, so a malformed reference throws rather than
 * becoming a reference to nothing. A parsed `WorkflowDefinition` cannot contain
 * one, which is why this function takes a parsed definition.
 */
export function collectRequiredCapabilities(
  definition: WorkflowDefinition,
): readonly CapabilityRef[] {
  const byKey = new Map<string, CapabilityRef>();

  const add = (ref: CapabilityRef): void => {
    byKey.set(formatCapabilityRef(ref), { id: ref.id, version: ref.version });
  };

  const addSchema = (reference: string): void => {
    const [id, version] = reference.split("@");

    if (id === undefined || version === undefined) {
      throw new ValidationError(
        `collectRequiredCapabilities: \`${reference}\` is not a capability reference`,
        { issues: [{ path: [], message: "expected the form `id@version`" }] },
      );
    }

    add({ id, version });
  };

  addSchema(definition.inputSchema);
  addSchema(definition.outputSchema);

  for (const node of Object.values(definition.nodes)) {
    addSchema(node.inputSchema);
    addSchema(node.outputSchema);

    switch (node.type) {
      case "code":
      case "reduce":
        add(node.handler);
        break;
      case "call":
        add(node.tool);
        break;
      case "agent":
        add(node.agent);
        break;
      case "branch":
        if (node.on.kind === "policy") {
          add(node.on.policy);
        }
        break;
      case "loop":
        if (node.until.kind === "policy") {
          add(node.until.policy);
        }
        break;
      default:
        // `jev` names a question, which M3 owns and no capability kind covers;
        // `artifact`, `escalate`, `chain` and `map` name nothing beyond the two
        // schemas already added above.
        break;
    }
  }

  return Object.freeze([...byKey.values()].sort(compareRefs));
}

/**
 * Derive a {@link WorkflowCompatibility} from a compiled workflow.
 *
 * Everything except the SOP comes off the IR, so a version's declaration cannot
 * drift from what the workflow actually is. The result is deep-frozen, because
 * it is stored beside the definition and read by a pure selector.
 *
 * ```ts
 * const compatibility = describeWorkflowCompatibility(compiled, {
 *   sop: "vendor-triage-sop",
 * });
 * ```
 *
 * @throws {ValidationError} if `sop` is not an identifier, or
 * `minHarnessVersion` is not an exact `major.minor.patch` version.
 */
export function describeWorkflowCompatibility(
  compiled: CompiledWorkflowLike,
  options: DescribeWorkflowCompatibilityOptions,
): WorkflowCompatibility {
  const issues: ValidationIssue[] = [];

  if (!isCapabilityIdentifier(options.sop)) {
    issues.push({ path: ["sop"], message: IDENTIFIER_MESSAGE });
  }

  const minHarnessVersion = options.minHarnessVersion ?? HARNESS_RUNTIME_INFO.version;

  if (!isExactVersion(minHarnessVersion)) {
    issues.push({ path: ["minHarnessVersion"], message: EXACT_VERSION_MESSAGE });
  }

  if (options.sopFingerprint !== undefined && options.sopFingerprint === "") {
    issues.push({ path: ["sopFingerprint"], message: "expected a non-empty string or absence" });
  }

  throwIfIssues("describeWorkflowCompatibility: invalid options", issues);

  const { definition } = compiled;

  return deepFreeze({
    domainId: definition.domain,
    jobType: definition.jobType,
    inputSchema: definition.inputSchema,
    outputSchema: definition.outputSchema,
    requiredCapabilities: collectRequiredCapabilities(definition),
    sop: options.sop,
    ...(options.sopFingerprint === undefined ? {} : { sopFingerprint: options.sopFingerprint }),
    minHarnessVersion,
  });
}

/**
 * One registered workflow: the `workflow_definitions` row.
 *
 * It is the **identity** of a workflow across its versions, not a version of
 * one. `(domainId, workflowKey)` is unique, so re-registering the same workflow
 * under a new IR adds a version rather than a second workflow.
 */
export interface WorkflowRecord {
  /** The workflow. Sortable, so it doubles as a cursor. */
  readonly id: WorkflowId;
  /** The domain it belongs to. */
  readonly domainId: string;
  /** The domain version it was registered under. */
  readonly domainVersion: string;
  /** The IR's own `id`, e.g. `vendor-triage`. Unique within the domain. */
  readonly workflowKey: string;
  /** The job type every version of it handles. */
  readonly jobType: string;
  /** When it was first registered, as an ISO 8601 string. */
  readonly createdAt: string;
}

/**
 * One version of a workflow: the `workflow_versions` row.
 *
 * **The fingerprint is the identity.** `(workflowId, fingerprint)` is unique,
 * so registering byte-identical IR twice is a conflict rather than two rows,
 * and north-star invariant 4 ("every behavior-affecting version is
 * fingerprinted") holds by construction rather than by discipline.
 *
 * There is deliberately **no `canonicalJson` field**. It is a pure function of
 * `definition` (`canonicalWorkflowIr()`), and a stored second copy could
 * disagree with the definition it claims to encode.
 * {@link parseWorkflowVersionRecord} goes further and *recomputes* the
 * fingerprint, so a row whose digest does not match its definition fails at the
 * read boundary instead of being trusted.
 */
export interface WorkflowVersionRecord {
  /** The version. Sortable, so it doubles as a cursor and as the tie-break. */
  readonly id: WorkflowVersionId;
  /** The workflow this is a version of. */
  readonly workflowId: WorkflowId;
  /** The validated IR. */
  readonly definition: WorkflowDefinition;
  /** `sha256:<hex>` over the canonical IR. Identity within the workflow. */
  readonly fingerprint: string;
  /** Where in the lifecycle it is. */
  readonly status: WorkflowStatus;
  /** What it declares it can handle. */
  readonly compatibility: WorkflowCompatibility;
  /** When the version was registered, as an ISO 8601 string. */
  readonly createdAt: string;
  /** When its status last changed, as an ISO 8601 string. */
  readonly statusChangedAt: string;
  /** Registry-owned free-form detail: who compiled it, from which run. */
  readonly metadata: JsonObject;
}

/**
 * One status change: the `workflow_promotions` row.
 *
 * Every status change writes one, which is what makes promotion history a
 * **ledger** rather than a column that only remembers the last move. AD-005
 * requires promotion to be human-invoked, so `actor` is not nullable: something
 * named did this.
 */
export interface WorkflowPromotionRecord {
  /** The promotion. */
  readonly id: PromotionId;
  /** The version that moved. */
  readonly workflowVersionId: WorkflowVersionId;
  /** The status it was in. */
  readonly fromStatus: WorkflowStatus;
  /** The status it moved to. */
  readonly toStatus: WorkflowStatus;
  /** Who moved it. A person, a script, a CI job: something answerable. */
  readonly actor: string;
  /** Why, in their words, or `null`. */
  readonly reason: string | null;
  /** When, as an ISO 8601 string. */
  readonly createdAt: string;
}

/** The six fields a {@link WorkflowRecord} has, and the only ones accepted. */
const WORKFLOW_RECORD_FIELDS = [
  "id",
  "domainId",
  "domainVersion",
  "workflowKey",
  "jobType",
  "createdAt",
] as const;

/** The nine fields a {@link WorkflowVersionRecord} has. */
const WORKFLOW_VERSION_RECORD_FIELDS = [
  "id",
  "workflowId",
  "definition",
  "fingerprint",
  "status",
  "compatibility",
  "createdAt",
  "statusChangedAt",
  "metadata",
] as const;

/** The seven fields a {@link WorkflowPromotionRecord} has. */
const WORKFLOW_PROMOTION_RECORD_FIELDS = [
  "id",
  "workflowVersionId",
  "fromStatus",
  "toStatus",
  "actor",
  "reason",
  "createdAt",
] as const;

/** The eight fields a {@link WorkflowCompatibility} may have. */
const COMPATIBILITY_FIELDS = [
  "domainId",
  "jobType",
  "inputSchema",
  "outputSchema",
  "requiredCapabilities",
  "sop",
  "sopFingerprint",
  "minHarnessVersion",
] as const;

type IssuePath = readonly (string | number)[];

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && value !== "" && Number.isFinite(Date.parse(value));
}

function collectUnknownKeyIssues(
  record: { readonly [key: string]: unknown },
  allowed: readonly string[],
  path: IssuePath,
): ValidationIssue[] {
  return Object.keys(record)
    .filter((key) => !allowed.includes(key))
    .map((key) => ({ path: [...path, key], message: "unknown field" }));
}

/** Re-path a thrown `ValidationError`'s issues, the way `parseRunRecord` does. */
function collectThrownIssues(check: () => void, path: IssuePath): ValidationIssue[] {
  try {
    check();
    return [];
  } catch (error) {
    if (!(error instanceof ValidationError)) {
      throw error;
    }

    return error.issues.map((issue) => ({ path: [...path], message: issue.message }));
  }
}

function collectSchemaRefIssues(value: unknown, path: IssuePath): ValidationIssue[] {
  if (typeof value !== "string") {
    return [{ path: [...path], message: "expected an `id@version` capability reference" }];
  }

  const parts = value.split("@");
  const [id, version] = parts;

  if (parts.length !== 2 || id === undefined || version === undefined) {
    return [{ path: [...path], message: "expected the form `id@version`" }];
  }

  return collectRefIssues(id, version, path).map((issue) => ({
    path: [...path],
    message: issue.message,
  }));
}

/** Validate a {@link WorkflowCompatibility} in place, collecting every problem. */
function collectCompatibilityIssues(value: unknown, path: IssuePath): ValidationIssue[] {
  if (!isPlainObject(value)) {
    return [{ path: [...path], message: "expected a workflow compatibility object" }];
  }

  const issues: ValidationIssue[] = [...collectUnknownKeyIssues(value, COMPATIBILITY_FIELDS, path)];

  for (const field of ["domainId", "jobType", "sop"] as const) {
    if (!isCapabilityIdentifier(value[field])) {
      issues.push({ path: [...path, field], message: IDENTIFIER_MESSAGE });
    }
  }

  issues.push(
    ...collectSchemaRefIssues(value.inputSchema, [...path, "inputSchema"]),
    ...collectSchemaRefIssues(value.outputSchema, [...path, "outputSchema"]),
  );

  if (!isExactVersion(value.minHarnessVersion)) {
    issues.push({ path: [...path, "minHarnessVersion"], message: EXACT_VERSION_MESSAGE });
  }

  if (
    value.sopFingerprint !== undefined &&
    (typeof value.sopFingerprint !== "string" || value.sopFingerprint === "")
  ) {
    issues.push({
      path: [...path, "sopFingerprint"],
      message: "expected a non-empty string or absence",
    });
  }

  if (!Array.isArray(value.requiredCapabilities)) {
    issues.push({ path: [...path, "requiredCapabilities"], message: "expected an array" });

    return issues;
  }

  for (const [index, entry] of value.requiredCapabilities.entries()) {
    const at: IssuePath = [...path, "requiredCapabilities", index];

    if (!isPlainObject(entry)) {
      issues.push({ path: at, message: "expected an `{ id, version }` reference" });
      continue;
    }

    issues.push(
      ...collectUnknownKeyIssues(entry, ["id", "version"], at),
      ...collectRefIssues(entry.id, entry.version, at),
    );
  }

  return issues;
}

/** Rebuild the frozen compatibility value from an already-validated object. */
function readCompatibility(value: { readonly [key: string]: unknown }): WorkflowCompatibility {
  const refs = value.requiredCapabilities as readonly { id: string; version: string }[];

  return {
    domainId: value.domainId as string,
    jobType: value.jobType as string,
    inputSchema: value.inputSchema as string,
    outputSchema: value.outputSchema as string,
    requiredCapabilities: refs.map((ref) => ({ id: ref.id, version: ref.version })),
    sop: value.sop as string,
    ...(value.sopFingerprint === undefined
      ? {}
      : { sopFingerprint: value.sopFingerprint as string }),
    minHarnessVersion: value.minHarnessVersion as string,
  };
}

/**
 * Turn an untrusted value into a {@link WorkflowRecord}, or throw explaining why
 * it is not one.
 *
 * The same boundary `parseJob()` and `parseRunRecord()` are, for the same
 * reason: a database row is an `unknown` claiming to be a record, and asserting
 * the claim is not checking it.
 *
 * @throws {ValidationError} listing every field that failed.
 */
export function parseWorkflowRecord(value: unknown, path: IssuePath = []): WorkflowRecord {
  if (!isPlainObject(value)) {
    throw new ValidationError("parseWorkflowRecord: value is not a workflow record", {
      issues: [{ path: [...path], message: "expected a workflow record object" }],
    });
  }

  const issues: ValidationIssue[] = [
    ...collectUnknownKeyIssues(value, WORKFLOW_RECORD_FIELDS, path),
    ...collectThrownIssues(() => {
      parseEntityId("workflow", value.id);
    }, [...path, "id"]),
    ...collectRefIssues(value.domainId, value.domainVersion, path).map((issue) => ({
      path: issue.path.at(-1) === "id" ? [...path, "domainId"] : [...path, "domainVersion"],
      message: issue.message,
    })),
  ];

  for (const field of ["workflowKey", "jobType"] as const) {
    if (!isCapabilityIdentifier(value[field])) {
      issues.push({ path: [...path, field], message: IDENTIFIER_MESSAGE });
    }
  }

  if (!isIsoTimestamp(value.createdAt)) {
    issues.push({ path: [...path, "createdAt"], message: "expected an ISO 8601 timestamp" });
  }

  throwIfIssues("parseWorkflowRecord: value is not a workflow record", issues);

  return deepFreeze({
    id: parseEntityId("workflow", value.id),
    domainId: value.domainId as string,
    domainVersion: value.domainVersion as string,
    workflowKey: value.workflowKey as string,
    jobType: value.jobType as string,
    createdAt: value.createdAt as string,
  });
}

/**
 * Turn an untrusted value into a {@link WorkflowVersionRecord}, or throw
 * explaining why it is not one.
 *
 * It does three things no other parse boundary in the harness does, all for the
 * same reason — this record is what the router decides on:
 *
 * 1. the `definition` goes through `parseWorkflowDefinition()`, so a stored IR
 *    that this version of the format cannot read fails here rather than at the
 *    first node;
 * 2. the `fingerprint` is **recomputed** from that definition and compared, so
 *    a row whose digest and IR disagree — a hand-edited payload, a partial
 *    migration — is rejected instead of quietly winning a tie-break;
 * 3. the `compatibility` is checked field by field, because the selector reads
 *    it and never re-derives it.
 *
 * @throws {ValidationError} listing every field that failed.
 */
export function parseWorkflowVersionRecord(
  value: unknown,
  path: IssuePath = [],
): WorkflowVersionRecord {
  if (!isPlainObject(value)) {
    throw new ValidationError(
      "parseWorkflowVersionRecord: value is not a workflow version record",
      { issues: [{ path: [...path], message: "expected a workflow version record object" }] },
    );
  }

  const issues: ValidationIssue[] = [
    ...collectUnknownKeyIssues(value, WORKFLOW_VERSION_RECORD_FIELDS, path),
    ...collectThrownIssues(() => {
      parseEntityId("workflow-version", value.id);
    }, [...path, "id"]),
    ...collectThrownIssues(() => {
      parseEntityId("workflow", value.workflowId);
    }, [...path, "workflowId"]),
  ];

  let definition: WorkflowDefinition | undefined;

  try {
    definition = parseWorkflowDefinition(value.definition, [...path, "definition"]);
  } catch (error) {
    if (!(error instanceof ValidationError)) {
      throw error;
    }

    issues.push(...error.issues);
  }

  if (typeof value.fingerprint !== "string" || value.fingerprint === "") {
    issues.push({ path: [...path, "fingerprint"], message: "expected a non-empty string" });
  } else if (definition !== undefined) {
    const expected = workflowFingerprint(definition);

    if (expected !== value.fingerprint) {
      issues.push({
        path: [...path, "fingerprint"],
        message: `expected \`${expected}\`, the fingerprint of the stored definition; got \`${value.fingerprint}\``,
      });
    }
  }

  if (!isWorkflowStatus(value.status)) {
    issues.push({
      path: [...path, "status"],
      message: `expected one of ${WORKFLOW_STATUSES.join(", ")}`,
    });
  }

  issues.push(...collectCompatibilityIssues(value.compatibility, [...path, "compatibility"]));

  for (const field of ["createdAt", "statusChangedAt"] as const) {
    if (!isIsoTimestamp(value[field])) {
      issues.push({ path: [...path, field], message: "expected an ISO 8601 timestamp" });
    }
  }

  if (!isJsonObject(value.metadata)) {
    issues.push({ path: [...path, "metadata"], message: "expected a JSON object" });
  }

  throwIfIssues("parseWorkflowVersionRecord: value is not a workflow version record", issues);

  if (definition === undefined) {
    // Unreachable: a definition that failed to parse pushed issues, and
    // `throwIfIssues` has already left.
    throw new ValidationError(
      "parseWorkflowVersionRecord: value is not a workflow version record",
      { issues: [{ path: [...path, "definition"], message: "expected a workflow definition" }] },
    );
  }

  return deepFreeze({
    id: parseEntityId("workflow-version", value.id),
    workflowId: parseEntityId("workflow", value.workflowId),
    definition,
    fingerprint: value.fingerprint as string,
    status: value.status as WorkflowStatus,
    compatibility: readCompatibility(value.compatibility as { readonly [key: string]: unknown }),
    createdAt: value.createdAt as string,
    statusChangedAt: value.statusChangedAt as string,
    metadata: value.metadata as JsonObject,
  });
}

/**
 * Turn an untrusted value into a {@link WorkflowPromotionRecord}, or throw.
 *
 * It checks the transition as well as the shape: a ledger row claiming a move
 * the transition table forbids is not a record of something that happened, it
 * is a record of something that should not have.
 *
 * @throws {ValidationError} listing every field that failed.
 */
export function parseWorkflowPromotionRecord(
  value: unknown,
  path: IssuePath = [],
): WorkflowPromotionRecord {
  if (!isPlainObject(value)) {
    throw new ValidationError("parseWorkflowPromotionRecord: value is not a promotion record", {
      issues: [{ path: [...path], message: "expected a promotion record object" }],
    });
  }

  const issues: ValidationIssue[] = [
    ...collectUnknownKeyIssues(value, WORKFLOW_PROMOTION_RECORD_FIELDS, path),
    ...collectThrownIssues(() => {
      parseEntityId("promotion", value.id);
    }, [...path, "id"]),
    ...collectThrownIssues(() => {
      parseEntityId("workflow-version", value.workflowVersionId);
    }, [...path, "workflowVersionId"]),
  ];

  for (const field of ["fromStatus", "toStatus"] as const) {
    if (!isWorkflowStatus(value[field])) {
      issues.push({
        path: [...path, field],
        message: `expected one of ${WORKFLOW_STATUSES.join(", ")}`,
      });
    }
  }

  if (
    isWorkflowStatus(value.fromStatus) &&
    isWorkflowStatus(value.toStatus) &&
    !canTransition(value.fromStatus, value.toStatus)
  ) {
    issues.push({
      path: [...path, "toStatus"],
      message: `\`${value.fromStatus}\` cannot transition to \`${value.toStatus}\``,
    });
  }

  if (typeof value.actor !== "string" || value.actor.trim() === "") {
    issues.push({ path: [...path, "actor"], message: "expected a non-empty string" });
  }

  if (value.reason !== null && (typeof value.reason !== "string" || value.reason === "")) {
    issues.push({ path: [...path, "reason"], message: "expected a non-empty string or null" });
  }

  if (!isIsoTimestamp(value.createdAt)) {
    issues.push({ path: [...path, "createdAt"], message: "expected an ISO 8601 timestamp" });
  }

  throwIfIssues("parseWorkflowPromotionRecord: value is not a promotion record", issues);

  return deepFreeze({
    id: parseEntityId("promotion", value.id),
    workflowVersionId: parseEntityId("workflow-version", value.workflowVersionId),
    fromStatus: value.fromStatus as WorkflowStatus,
    toStatus: value.toStatus as WorkflowStatus,
    actor: value.actor as string,
    reason: value.reason as string | null,
    createdAt: value.createdAt as string,
  });
}

/**
 * Compare two exact `major.minor.patch` versions numerically.
 *
 * Negative when `left` is older, positive when it is newer, `0` when they are
 * the same. Component-wise and numeric, because `"0.10.0" < "0.9.0"` is true as
 * strings and false as versions, and the minimum-harness-version check is the
 * one place in the harness where versions are *ordered* rather than compared
 * for equality (ADR-0015 pins capability versions exactly; a harness minimum is
 * deliberately not a pin).
 *
 * @throws {ValidationError} if either side is not an exact version.
 */
export function compareExactVersions(left: string, right: string): number {
  const issues: ValidationIssue[] = [];

  if (!isExactVersion(left)) {
    issues.push({ path: ["left"], message: EXACT_VERSION_MESSAGE });
  }

  if (!isExactVersion(right)) {
    issues.push({ path: ["right"], message: EXACT_VERSION_MESSAGE });
  }

  throwIfIssues("compareExactVersions: not an exact version", issues);

  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);

  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);

    if (difference !== 0) {
      return difference < 0 ? -1 : 1;
    }
  }

  return 0;
}

/**
 * Why a candidate version was not selected.
 *
 * A **closed** list, because the router (M5-T3) records the reason a job went
 * to the full agent and M7 aggregates those reasons to find out what the
 * compiler keeps getting wrong. A free-form string would make "the same reason"
 * a text-matching problem, the same argument {@link FALLBACK_REASONS} makes.
 *
 * | Reason | Meaning |
 * | --- | --- |
 * | `not-active` | The version is not `active`. Only active versions serve traffic. |
 * | `domain-mismatch` | It belongs to another domain. |
 * | `job-type-mismatch` | It handles another job type within the domain. |
 * | `input-schema-mismatch` | It expects a different input schema reference. |
 * | `output-schema-mismatch` | It produces a different output schema reference. |
 * | `missing-capability` | Something it pins is not in the manifest at that exact version. |
 * | `sop-mismatch` | It was authored against a different SOP. |
 * | `sop-fingerprint-mismatch` | Same SOP identifier, different SOP content. |
 * | `harness-too-old` | It needs a newer harness than the one asking. |
 */
export const WORKFLOW_REJECTION_REASONS = [
  "not-active",
  "domain-mismatch",
  "job-type-mismatch",
  "input-schema-mismatch",
  "output-schema-mismatch",
  "missing-capability",
  "sop-mismatch",
  "sop-fingerprint-mismatch",
  "harness-too-old",
] as const;

/** One of {@link WORKFLOW_REJECTION_REASONS}. */
export type WorkflowRejectionReason = (typeof WORKFLOW_REJECTION_REASONS)[number];

/** One candidate the selector refused, and why. */
export interface WorkflowRejection {
  /** Which version was refused. */
  readonly versionId: WorkflowVersionId;
  /** The closed reason, for counting. */
  readonly reason: WorkflowRejectionReason;
  /** The specific difference, for a human reading a trace. */
  readonly detail: string;
}

/** What {@link selectCompatibleWorkflow} returns. */
export type WorkflowSelection =
  | {
      /** A compatible active version was found. */
      readonly kind: "match";
      /** The version to route to. */
      readonly version: WorkflowVersionRecord;
    }
  | {
      /** No candidate was compatible. The caller routes to the full agent. */
      readonly kind: "none";
      /** Every candidate considered, with the first reason it failed. */
      readonly rejections: readonly WorkflowRejection[];
    };

/** What the selector needs to know about the environment asking. */
export interface WorkflowSelectionEnvironment {
  /** The domain's capability manifest, which pins are resolved against. */
  readonly manifest: CapabilityManifest;
  /** The harness version asking, as an exact `major.minor.patch` string. */
  readonly harnessVersion: string;
  /** The digest of the SOP this caller is running, when it knows it. */
  readonly sopFingerprint?: string;
}

/** Index a manifest by `id@version`, so each pin costs one lookup. */
function manifestIndex(manifest: CapabilityManifest): ReadonlySet<string> {
  const keys = new Set<string>();

  for (const entry of manifest.entries) {
    keys.add(formatCapabilityRef(entry.ref));
  }

  return keys;
}

/** The first reason `version` cannot serve `job`, or `undefined` when it can. */
function rejectionFor(
  job: Job,
  version: WorkflowVersionRecord,
  env: WorkflowSelectionEnvironment,
  registered: ReadonlySet<string>,
): WorkflowRejection | undefined {
  const at = version.compatibility;
  const reject = (reason: WorkflowRejectionReason, detail: string): WorkflowRejection => ({
    versionId: version.id,
    reason,
    detail,
  });

  if (version.status !== "active") {
    return reject("not-active", `status is \`${version.status}\`, not \`active\``);
  }

  if (at.domainId !== job.domain.id) {
    return reject("domain-mismatch", `declares \`${at.domainId}\`, job is \`${job.domain.id}\``);
  }

  if (at.jobType !== job.jobType) {
    return reject("job-type-mismatch", `declares \`${at.jobType}\`, job is \`${job.jobType}\``);
  }

  if (at.inputSchema !== job.contracts.inputSchema) {
    return reject(
      "input-schema-mismatch",
      `declares \`${at.inputSchema}\`, job is \`${job.contracts.inputSchema}\``,
    );
  }

  if (at.outputSchema !== job.contracts.outputSchema) {
    return reject(
      "output-schema-mismatch",
      `declares \`${at.outputSchema}\`, job is \`${job.contracts.outputSchema}\``,
    );
  }

  for (const ref of at.requiredCapabilities) {
    const formatted = formatCapabilityRef(ref);

    if (!registered.has(formatted)) {
      return reject(
        "missing-capability",
        `\`${formatted}\` is not registered at that exact version`,
      );
    }
  }

  if (at.sop !== job.contracts.sop) {
    return reject("sop-mismatch", `declares \`${at.sop}\`, job is \`${job.contracts.sop}\``);
  }

  if (
    at.sopFingerprint !== undefined &&
    env.sopFingerprint !== undefined &&
    at.sopFingerprint !== env.sopFingerprint
  ) {
    return reject(
      "sop-fingerprint-mismatch",
      `declares \`${at.sopFingerprint}\`, caller is running \`${env.sopFingerprint}\``,
    );
  }

  if (compareExactVersions(at.minHarnessVersion, env.harnessVersion) > 0) {
    return reject(
      "harness-too-old",
      `needs harness \`${at.minHarnessVersion}\` or newer, caller is \`${env.harnessVersion}\``,
    );
  }

  return undefined;
}

/**
 * Pick the compiled workflow version that can serve this job, or explain why
 * none can (M5-T2).
 *
 * **Pure.** No storage, no clock, no registry lookup: the candidates and the
 * environment are arguments, which is what lets the router (M5-T3) be a thin
 * deterministic shell around it and lets every rejection reason be unit-tested
 * without a database.
 *
 * Every check is an exact match, in this order, and the **first** failure is
 * the reason reported: status, domain, job type, input schema, output schema,
 * pinned capabilities, SOP, SOP fingerprint, minimum harness version. A
 * workflow's `id` is never consulted — "never route only by string name" is the
 * build plan's own wording for M5-T2.
 *
 * **The tie-break is the newest id.** When more than one active version matches,
 * the one with the greatest {@link WorkflowVersionId} wins, and because ids are
 * UUIDv7 that is the most recently registered one. It is stated rather than
 * left to array order because "deterministic" is a Milestone 5 acceptance
 * criterion and the order a store returns rows in is not part of any contract.
 *
 * ```ts
 * const selection = selectCompatibleWorkflow(job, candidates, {
 *   manifest: registry.toManifest(),
 *   harnessVersion: HARNESS_RUNTIME_INFO.version,
 * });
 *
 * if (selection.kind === "match") {
 *   // route to selection.version
 * }
 * ```
 */
export function selectCompatibleWorkflow(
  job: Job,
  candidates: readonly WorkflowVersionRecord[],
  env: WorkflowSelectionEnvironment,
): WorkflowSelection {
  const registered = manifestIndex(env.manifest);
  const rejections: WorkflowRejection[] = [];
  let best: WorkflowVersionRecord | undefined;

  for (const version of candidates) {
    const rejection = rejectionFor(job, version, env, registered);

    if (rejection !== undefined) {
      rejections.push(rejection);
      continue;
    }

    if (best === undefined || version.id > best.id) {
      best = version;
    }
  }

  return best === undefined
    ? { kind: "none", rejections: Object.freeze(rejections) }
    : { kind: "match", version: best };
}
