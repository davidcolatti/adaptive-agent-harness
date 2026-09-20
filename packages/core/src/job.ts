import { parseCapabilityRefString } from "./capabilities.js";
import type { Budget, DomainRef, ToolGrant, ToolGrantMode } from "./context.js";
import { ValidationError, type ValidationIssue } from "./errors.js";
import { deepFreeze } from "./freeze.js";
import {
  collectRefIssues,
  IDENTIFIER_MESSAGE,
  isCapabilityIdentifier,
  throwIfIssues,
} from "./identifiers.js";
import { type JobId, parseEntityId } from "./ids.js";
import {
  isJsonObject,
  isJsonValue,
  isPlainObject,
  type JsonObject,
  type JsonValue,
} from "./json.js";

/**
 * The string references a job carries to the contracts it was created under.
 *
 * They are **references, not schemas**: a job is serialized into a trace and a
 * run record, so it names its contracts rather than embedding validators that
 * cannot survive `JSON.stringify`. Resolving a reference to the actual schema
 * is the capability registry's job (M1-T9); the example domain writes
 * `vendor-triage.input@1.0.0` and `procurement-sop` by hand.
 *
 * **Three fields, and M2-T2 deliberately added no fourth** (ADR-0032). The two
 * schema references are capability references, `id@version`. The SOP reference
 * is a bare identifier, because a SOP is content rather than a registered
 * executable capability and nothing versions one yet; if M2-T8's behavior
 * fingerprint turns out to need a versioned SOP, that is a contract change with
 * an ADR, not a field added on suspicion.
 */
export interface JobContracts {
  /** Reference to the schema the job's input satisfies, as `id@version`. */
  readonly inputSchema: string;
  /** Reference to the schema the job's output must satisfy, as `id@version`. */
  readonly outputSchema: string;
  /** Reference to the standard operating procedure the work follows. */
  readonly sop: string;
}

/**
 * The key of {@link Job}'s phantom output marker.
 *
 * It is `declare`d, so it exists only in the type system and nothing is emitted
 * for it. It is exported because a declaration file has to be able to name it,
 * not because a caller should ever use it.
 */
export declare const JOB_OUTPUT_TYPE: unique symbol;

/**
 * One immutable unit of work, exactly as build plan section 5 specifies it.
 *
 * A job says *what* to do and is fixed for the whole of its execution; an
 * {@link ExecutionContext} says everything about *this attempt* at doing it. A
 * retry reuses the job and gets a new context.
 *
 * **Finalized by M2-T2; see ADR-0032.** The field list is the build plan's,
 * unchanged. What M2-T2 settled is everything around it:
 *
 * - **Immutability is deep.** Every field is `readonly`, and the value is
 *   `deepFreeze`d, so `job.budget.maxCostUsd = 1e9` and
 *   `job.permissions[0].mode = "write"` throw rather than quietly widening what
 *   an execution may do. Depth stops at the JSON-shaped part of the value; see
 *   `deepFreeze` for why, and for what that means for an exotic `input`.
 * - **The effective job is the job.** `harness.run()` applies the caller's
 *   budget, permission and metadata overrides while building the job, before
 *   anything executes. The result is the value the runtime receives, the value
 *   a trace records and the value persistence stores. There is no second,
 *   later job and no mutation of the first.
 * - **There is no `createdAt`.** A {@link JobId} is a UUIDv7 whose first 48
 *   bits are the creation millisecond, so creation time is derived with
 *   `entityIdTimestamp(job.id)` rather than stored twice.
 * - **An attempt is not part of a job.** An attempt belongs to a run: a retry
 *   reuses this job unchanged and gets a new `ExecutionContext`. Where attempt
 *   identity surfaces is the trace and run-ledger contract (M2-T3, M2-T5), not
 *   here, which is why no `AttemptId` field exists.
 *
 * **`TOutput` is a phantom type parameter.** Nothing in a job's data mentions
 * its output: the output is produced later, by the runtime. But
 * `AgentRuntime.run` has to infer the output type from the job it is handed, so
 * the parameter must be part of the type rather than merely declared and
 * unused. The idiom for that is a marker property under a `unique symbol` key,
 * optional so no value ever has to supply it, and symbol-keyed so it can never
 * collide with a real field or appear in JSON. Without it, `Job<I, A>` and
 * `Job<I, B>` would be the same structural type and `run()` would infer
 * `unknown` for every output.
 */
export interface Job<TInput = unknown, TOutput = unknown> {
  /**
   * The job's unique identifier: a sortable UUIDv7, minted by `newJobId()`
   * (M2-T1, ADR-0030). It is branded, so a `RunId` or a bare `string` cannot be
   * passed here; it sorts lexicographically in creation order; and it embeds
   * the creation time, which `entityIdTimestamp()` reads back.
   */
  readonly id: JobId;
  /** The domain and domain version this job belongs to. */
  readonly domain: DomainRef;
  /** Which kind of job this is within the domain, e.g. `vendor-triage`. */
  readonly jobType: string;
  /** What this job is for, in one sentence, addressed to whatever executes it. */
  readonly objective: string;
  /**
   * The validated input.
   *
   * Typed by the domain, and expected to be JSON-representable: a job is
   * persisted and replayed, and {@link parseJob} requires it. Typed validation
   * against the domain's schema stays with `DomainDefinition.inputSchema`,
   * which is the only thing that knows what this domain's input means.
   */
  readonly input: TInput;
  /** References to the contracts the job was created under. */
  readonly contracts: JobContracts;
  /** The limits execution must stay inside. An absent dimension is unlimited. */
  readonly budget: Budget;
  /** The tools execution may use. An empty list grants nothing. */
  readonly permissions: readonly ToolGrant[];
  /** Domain-owned detail, serializable and free-form. */
  readonly metadata: JsonObject;
  /**
   * Phantom marker for {@link TOutput}. Never present at runtime; never read.
   * See the note on this interface for why it exists.
   */
  readonly [JOB_OUTPUT_TYPE]?: TOutput;
}

/**
 * The nine fields a job has, and the only nine {@link parseJob} accepts.
 *
 * An unknown tenth is rejected rather than dropped. A job is a closed contract
 * that gets persisted and replayed, so a field this version does not understand
 * means the value was not written by this version, and silently discarding it
 * would lose data from a record whose whole purpose is to be reproducible.
 * Adding a field later is therefore a deliberate contract change.
 */
const JOB_FIELDS = [
  "id",
  "domain",
  "jobType",
  "objective",
  "input",
  "contracts",
  "budget",
  "permissions",
  "metadata",
] as const;

/**
 * The budget dimensions, and whether each one must be a whole number.
 *
 * `maxCostUsd` is money and is therefore fractional. The other three are not:
 * a call is a call, and `Date.now()` cannot express a fractional millisecond,
 * so a fractional limit in any of them is a mistake worth catching rather than
 * a precision the harness can honour.
 */
const BUDGET_DIMENSIONS: ReadonlyArray<readonly [keyof Budget, "integer" | "number"]> = [
  ["maxCostUsd", "number"],
  ["maxDurationMs", "integer"],
  ["maxModelCalls", "integer"],
  ["maxToolCalls", "integer"],
];

/** The fields one {@link ToolGrant} has, and the only ones accepted. */
const TOOL_GRANT_FIELDS = ["toolId", "mode", "scope"] as const;

/** The two access modes a grant may confer. */
const TOOL_GRANT_MODES: readonly string[] = ["read", "write"] satisfies readonly ToolGrantMode[];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** Report every key of `record` that is not in `allowed`. */
function collectUnknownKeyIssues(
  record: { readonly [key: string]: unknown },
  allowed: readonly string[],
  path: readonly (string | number)[],
): ValidationIssue[] {
  return Object.keys(record)
    .filter((key) => !allowed.includes(key))
    .map((key) => ({ path: [...path, key], message: "unknown field" }));
}

/**
 * Re-path the issues a thrower produced onto `path`.
 *
 * `parseEntityId` and `parseCapabilityRefString` both throw a
 * {@link ValidationError} rather than returning issues, because at their own
 * boundaries a single bad value is the whole failure. Here they are two checks
 * among a dozen, and a caller reading a stored job wants all of the problems at
 * once, so their issues are collected instead of propagated. Anything that is
 * not a `ValidationError` is a defect and is rethrown.
 */
function collectThrownIssues(
  check: () => void,
  path: readonly (string | number)[],
): ValidationIssue[] {
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

function collectContractsIssues(
  value: unknown,
  path: readonly (string | number)[],
): ValidationIssue[] {
  if (!isPlainObject(value)) {
    return [{ path: [...path], message: "expected an object of contract references" }];
  }

  const issues: ValidationIssue[] = [
    ...collectUnknownKeyIssues(value, ["inputSchema", "outputSchema", "sop"], path),
  ];

  for (const field of ["inputSchema", "outputSchema"] as const) {
    const reference = value[field];

    if (typeof reference !== "string") {
      issues.push({ path: [...path, field], message: "expected a capability reference string" });
      continue;
    }

    issues.push(
      ...collectThrownIssues(() => {
        parseCapabilityRefString(reference);
      }, [...path, field]),
    );
  }

  // A bare identifier, not a capability reference. `procurement-sop` is what
  // the example domain writes and what M1-T9 deliberately left unregistered: a
  // SOP is content, not an executable capability, and nothing versions one yet.
  if (!isCapabilityIdentifier(value.sop)) {
    issues.push({ path: [...path, "sop"], message: IDENTIFIER_MESSAGE });
  }

  return issues;
}

function collectBudgetIssues(
  value: unknown,
  path: readonly (string | number)[],
): ValidationIssue[] {
  if (!isPlainObject(value)) {
    return [{ path: [...path], message: "expected a budget object" }];
  }

  const issues: ValidationIssue[] = [
    ...collectUnknownKeyIssues(
      value,
      BUDGET_DIMENSIONS.map(([dimension]) => dimension),
      path,
    ),
  ];

  for (const [dimension, kind] of BUDGET_DIMENSIONS) {
    const limit = value[dimension];

    // An absent dimension is unlimited, not zero, so absence is correct rather
    // than missing.
    if (limit === undefined) {
      continue;
    }

    if (typeof limit !== "number" || !Number.isFinite(limit) || limit < 0) {
      issues.push({
        path: [...path, dimension],
        message: "expected a finite number >= 0, or no value at all for unlimited",
      });
      continue;
    }

    if (kind === "integer" && !Number.isInteger(limit)) {
      issues.push({ path: [...path, dimension], message: "expected a whole number" });
    }
  }

  return issues;
}

function collectToolGrantIssues(
  value: unknown,
  path: readonly (string | number)[],
): ValidationIssue[] {
  if (!isPlainObject(value)) {
    return [{ path: [...path], message: "expected a tool grant object" }];
  }

  const issues: ValidationIssue[] = [...collectUnknownKeyIssues(value, TOOL_GRANT_FIELDS, path)];

  if (!isNonEmptyString(value.toolId)) {
    issues.push({ path: [...path, "toolId"], message: "expected a non-empty string" });
  }

  if (typeof value.mode !== "string" || !TOOL_GRANT_MODES.includes(value.mode)) {
    issues.push({ path: [...path, "mode"], message: "expected `read` or `write`" });
  }

  if (value.scope !== undefined && !isNonEmptyString(value.scope)) {
    issues.push({
      path: [...path, "scope"],
      message: "expected a non-empty string, or no value at all for an unnarrowed grant",
    });
  }

  return issues;
}

function collectPermissionsIssues(
  value: unknown,
  path: readonly (string | number)[],
): ValidationIssue[] {
  if (!Array.isArray(value)) {
    return [{ path: [...path], message: "expected an array of tool grants" }];
  }

  return value.flatMap((grant: unknown, index) => collectToolGrantIssues(grant, [...path, index]));
}

/** A grant rebuilt from a validated value, carrying `scope` only if it had one. */
function readToolGrant(value: { readonly [key: string]: unknown }): ToolGrant {
  const grant: ToolGrant = { toolId: value.toolId as string, mode: value.mode as ToolGrantMode };

  return value.scope === undefined ? grant : { ...grant, scope: value.scope as string };
}

/** A budget rebuilt from a validated value, carrying only the dimensions it set. */
function readBudget(value: { readonly [key: string]: unknown }): Budget {
  const budget: { -readonly [TDimension in keyof Budget]: Budget[TDimension] } = {};

  for (const [dimension] of BUDGET_DIMENSIONS) {
    const limit = value[dimension];

    if (limit !== undefined) {
      budget[dimension] = limit as number;
    }
  }

  return budget;
}

/**
 * The single validation pass {@link isJob} and {@link parseJob} share.
 *
 * It returns the issues it found and, when it found none, the job rebuilt from
 * exactly the fields it validated. Rebuilding rather than casting is what makes
 * "the return value has no unknown fields" true, and it is what lets `parseJob`
 * freeze a value without freezing structure it does not own.
 */
function readJob(
  value: unknown,
  path: readonly (string | number)[],
): { readonly issues: readonly ValidationIssue[]; readonly job?: Job<unknown, unknown> } {
  if (!isPlainObject(value)) {
    return { issues: [{ path: [...path], message: "expected a job object" }] };
  }

  const issues: ValidationIssue[] = [...collectUnknownKeyIssues(value, JOB_FIELDS, path)];

  issues.push(
    ...collectThrownIssues(() => {
      parseEntityId("job", value.id);
    }, [...path, "id"]),
  );

  if (isPlainObject(value.domain)) {
    issues.push(...collectRefIssues(value.domain.id, value.domain.version, [...path, "domain"]));
  } else {
    issues.push({ path: [...path, "domain"], message: "expected an `{ id, version }` reference" });
  }

  for (const field of ["jobType", "objective"] as const) {
    if (!isNonEmptyString(value[field])) {
      issues.push({ path: [...path, field], message: "expected a non-empty string" });
    }
  }

  // The input is checked for being JSON and nothing more. What this domain's
  // input *means* is `DomainDefinition.inputSchema`'s question, and this
  // function has no domain to ask.
  if (!isJsonValue(value.input)) {
    issues.push({
      path: [...path, "input"],
      message:
        "expected a JSON value: no `undefined`, function, `Date`, non-finite number or cycle",
    });
  }

  issues.push(...collectContractsIssues(value.contracts, [...path, "contracts"]));
  issues.push(...collectBudgetIssues(value.budget, [...path, "budget"]));
  issues.push(...collectPermissionsIssues(value.permissions, [...path, "permissions"]));

  if (!isJsonObject(value.metadata)) {
    issues.push({ path: [...path, "metadata"], message: "expected a JSON object" });
  }

  if (issues.length > 0) {
    return { issues };
  }

  const domain = value.domain as { readonly id: string; readonly version: string };
  const contracts = value.contracts as { readonly [key: string]: unknown };

  return {
    issues,
    job: {
      id: parseEntityId("job", value.id),
      domain: { id: domain.id, version: domain.version },
      jobType: value.jobType as string,
      objective: value.objective as string,
      input: value.input as JsonValue,
      contracts: {
        inputSchema: contracts.inputSchema as string,
        outputSchema: contracts.outputSchema as string,
        sop: contracts.sop as string,
      },
      budget: readBudget(value.budget as { readonly [key: string]: unknown }),
      permissions: (value.permissions as readonly unknown[]).map((grant) =>
        readToolGrant(grant as { readonly [key: string]: unknown }),
      ),
      metadata: value.metadata as JsonObject,
    },
  };
}

/**
 * True when `value` is a well-formed job.
 *
 * A pure predicate: unlike {@link parseJob} it freezes nothing and allocates
 * nothing the caller can see. Use it when the answer is a branch; use
 * `parseJob` when the answer is a job.
 */
export function isJob(value: unknown): value is Job<unknown, unknown> {
  return readJob(value, []).issues.length === 0;
}

/**
 * Turn an untrusted value into a {@link Job}, or throw explaining why it is not
 * one.
 *
 * This is the boundary function a job comes back through. M2-T5 reads a row out
 * of Supabase, M2-T10's inspector reads a stored run, and M6 replays frozen
 * evidence; all three hold an `unknown` that claims to be a job, and this is
 * what makes the claim true rather than asserted.
 *
 * ```ts
 * const job = parseJob(JSON.parse(row.job));
 * const typed = job as Job<VendorTriageInput, VendorTriageOutput>;
 * ```
 *
 * **The return type is `Job<unknown, unknown>`, and narrowing is the caller's.**
 * The input's type belongs to the domain, whose `inputSchema` is the only thing
 * that can check it, and the output's type is phantom and describes something
 * that has not happened yet. A caller that knows the domain narrows with the
 * domain's own schema; a caller that does not gets the honest type.
 *
 * What it checks:
 *
 * | Field | Rule |
 * | --- | --- |
 * | `id` | A lowercase UUIDv7, via `parseEntityId("job", …)`. |
 * | `domain` | An `{ id, version }` pair, by the same rule `defineDomain()` applies. |
 * | `jobType`, `objective` | Non-empty strings. |
 * | `input` | A JSON value. Typed validation stays with the domain's schema. |
 * | `contracts` | Two `id@version` capability references and a bare SOP identifier. |
 * | `budget` | Known dimensions only, each a finite number >= 0, whole where a fraction is meaningless. |
 * | `permissions` | Tool grants: a non-empty `toolId`, a `read`/`write` mode, an optional non-empty `scope`. |
 * | `metadata` | A JSON object. |
 *
 * Every problem is reported at once, each with the path to the field that
 * caused it, in the `collectRefIssues` style the rest of the package uses. An
 * unknown field anywhere in the closed part of the shape is an error, not
 * something to drop.
 *
 * The returned job is **deep-frozen**, because a job read back is as immutable
 * as a job just created. Freezing reaches the `input` and `metadata` values it
 * shares with `value`, so a caller that intends to keep mutating what it passed
 * should pass a copy.
 *
 * @throws {ValidationError} listing every field that failed.
 */
export function parseJob(
  value: unknown,
  path: readonly (string | number)[] = [],
): Job<unknown, unknown> {
  const { issues, job } = readJob(value, path);

  throwIfIssues("parseJob: value is not a job", issues);

  // Unreachable: `readJob` returns a job whenever it returns no issues, and
  // `throwIfIssues` has already left if there were any.
  if (job === undefined) {
    throw new ValidationError("parseJob: value is not a job", {
      issues: [{ path: [...path], message: "expected a job object" }],
    });
  }

  return deepFreeze(job);
}
