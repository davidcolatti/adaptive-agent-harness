import type { Budget, DomainRef, ToolGrant } from "./context.js";
import { ValidationError, type ValidationIssue } from "./errors.js";
import type { Job, JobContracts } from "./job.js";
import type { JsonObject } from "./json.js";
import { assertIsSchema, type Schema } from "./schema.js";

/**
 * One fixture case a domain keeps alongside its definition.
 *
 * **This is the M1 shape, and M6 owns evals.** M6-T5 ("node evals") and M6-T6
 * ("workflow eval") define what is actually measured — quality, cost, latency,
 * false-auto rate, calibration — and M6-T2 defines dataset splits. None of that
 * is decided here, because M1 has no execution to measure. What M1 needs is a
 * place for a domain to write down "here is an input, and here is what a good
 * answer looks like" so that the example domain is a worked example rather than
 * a type declaration.
 */
export interface DomainEval<TInput, TOutput> {
  /** Stable identifier for this case, unique within the domain. */
  readonly id: string;
  /** What the case is testing, in one sentence. */
  readonly description: string;
  /** The input the case runs. */
  readonly input: TInput;
  /**
   * An optional check on the output.
   *
   * It **throws** to fail, which is how any assertion library already behaves,
   * so a domain can use whichever one it already has without the harness
   * depending on one or inventing a result type M6 would then have to replace.
   */
  readonly expect?: (output: TOutput) => void | Promise<void>;
}

/**
 * Everything a domain's `createJob` decides, which is a {@link Job} minus the
 * two fields the harness stamps: `id` and `domain`.
 *
 * Omitting `domain` is deliberate. If a domain could return its own `domain`
 * reference, it could return one that disagrees with the definition it belongs
 * to, and every consumer would then have to check. Making it unstatable means
 * the disagreement cannot be expressed.
 */
export interface CreateJobInput<TInput> {
  /** Which kind of job this is within the domain. */
  readonly jobType: string;
  /** What this job is for, in one sentence. */
  readonly objective: string;
  /** The job's input. */
  readonly input: TInput;
  /** References to the contracts the job is created under. */
  readonly contracts: JobContracts;
  /** The limits execution must stay inside. Defaults to `{}`, unlimited. */
  readonly budget?: Budget;
  /** The tools execution may use. Defaults to `[]`, which grants nothing. */
  readonly permissions?: readonly ToolGrant[];
  /** Domain-owned detail. Defaults to `{}`. */
  readonly metadata?: JsonObject;
}

/**
 * A registered domain: its identity, its contracts, how it turns an input into
 * a {@link Job}, and its fixture cases.
 *
 * Build plan section 5 states this shape. Produced only by {@link defineDomain},
 * which is what guarantees the invariants below hold of every value of this
 * type.
 */
export interface DomainDefinition<TInput = unknown, TOutput = unknown> {
  /** Stable domain ID, e.g. `vendor-triage`. */
  readonly id: string;
  /** The domain's own version, `major.minor.patch`. */
  readonly version: string;
  /** The schema every job input is validated against. */
  readonly inputSchema: Schema<TInput>;
  /** The schema every agent output is validated against. */
  readonly outputSchema: Schema<TOutput>;
  /**
   * Build a job from an input.
   *
   * **It does not validate.** Validating input before execution is the
   * harness's job (M1-T4), so that there is exactly one choke point where it
   * happens and a domain cannot accidentally skip or duplicate it.
   */
  createJob(input: TInput): Job<TInput, TOutput>;
  /** The domain's fixture cases. Possibly empty, never absent. */
  readonly evals: readonly DomainEval<TInput, TOutput>[];
}

/** The configuration {@link defineDomain} accepts. */
export interface DefineDomainConfig<TInput, TOutput> {
  /** Stable domain ID, e.g. `vendor-triage`. */
  readonly id: string;
  /** The domain's own version, exactly `major.minor.patch`. */
  readonly version: string;
  /** The schema every job input is validated against. */
  readonly inputSchema: Schema<TInput>;
  /** The schema every agent output is validated against. */
  readonly outputSchema: Schema<TOutput>;
  /** Build the job body for an input. The harness stamps `id` and `domain`. */
  createJob(input: TInput): CreateJobInput<TInput>;
  /** The domain's fixture cases. Defaults to `[]`. */
  readonly evals?: readonly DomainEval<TInput, TOutput>[];
}

/**
 * The domain and job identifier rule.
 *
 * Lenient on purpose: it bans whitespace, path separators and `@` rather than
 * insisting on strict kebab-case, because a domain owns its own naming. `@` and
 * whitespace are excluded because a contract reference is written
 * `vendor-triage.input@1.0.0`, and an ID containing either would make that
 * string ambiguous to parse.
 */
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

/**
 * Exactly `major.minor.patch`, each a non-negative integer without leading
 * zeros. No ranges (`^1.0.0`), no pre-release and no build metadata: a domain
 * version is pinned by a promoted workflow (ADR-0015) and compared for equality,
 * and nothing in the harness yet defines an ordering for pre-release tags.
 */
const VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;

function requireNonEmptyString(
  value: unknown,
  path: readonly (string | number)[],
): ValidationIssue | undefined {
  if (typeof value !== "string" || value.trim() === "") {
    return { path, message: "expected a non-empty string" };
  }
  return undefined;
}

function throwIfIssues(message: string, issues: readonly ValidationIssue[]): void {
  if (issues.length > 0) {
    throw new ValidationError(message, { issues });
  }
}

/**
 * Validate a domain configuration and return the frozen
 * {@link DomainDefinition} it describes.
 *
 * ```ts
 * export const vendorTriage = defineDomain({
 *   id: "vendor-triage",
 *   version: "1.0.0",
 *   inputSchema,
 *   outputSchema,
 *   createJob,
 *   evals,
 * });
 * ```
 *
 * What it checks, and why each check is here rather than left to a caller:
 *
 * - **`id`** matches {@link IDENTIFIER_PATTERN}. An ID that cannot be written
 *   into a capability reference is a problem at registration time, not at the
 *   first run.
 * - **`version`** is exactly `major.minor.patch`. A range would make "which
 *   version produced this trace" unanswerable.
 * - **both schemas** publish a well-formed `~standard`. A domain that hands
 *   over something that is not a schema fails here rather than at its first
 *   validation.
 * - **`createJob`** is a function.
 *
 * The returned `createJob` wraps the configured one: it stamps `domain` from
 * the definition, generates the job `id`, applies the documented defaults, and
 * checks that the returned body names a `jobType`, an `objective` and its three
 * contract references. It deliberately does **not** validate the input against
 * `inputSchema`; `createHarness()` (M1-T4) owns validation-before-execution, so
 * there is one choke point rather than two.
 *
 * @throws {ValidationError} for any configuration problem, with `issues`
 * naming the offending field.
 */
export function defineDomain<TInput, TOutput>(
  config: DefineDomainConfig<TInput, TOutput>,
): DomainDefinition<TInput, TOutput> {
  const issues: ValidationIssue[] = [];

  if (typeof config.id !== "string" || !IDENTIFIER_PATTERN.test(config.id)) {
    issues.push({
      path: ["id"],
      message:
        "expected a non-empty identifier of letters, digits, `.`, `-` or `_`, starting with a letter or digit",
    });
  }

  if (typeof config.version !== "string" || !VERSION_PATTERN.test(config.version)) {
    issues.push({
      path: ["version"],
      message: "expected an exact `major.minor.patch` version, e.g. `1.0.0`, with no range or tag",
    });
  }

  if (typeof config.createJob !== "function") {
    issues.push({ path: ["createJob"], message: "expected a function" });
  }

  throwIfIssues("defineDomain: invalid domain configuration", issues);

  assertIsSchema(config.inputSchema, { label: "defineDomain: `inputSchema`" });
  assertIsSchema(config.outputSchema, { label: "defineDomain: `outputSchema`" });

  const domain: DomainRef = Object.freeze({ id: config.id, version: config.version });
  const evals = Object.freeze([...(config.evals ?? [])]);

  function createJob(input: TInput): Job<TInput, TOutput> {
    const body = config.createJob(input);
    const bodyIssues: ValidationIssue[] = [];

    for (const field of ["jobType", "objective"] as const) {
      const issue = requireNonEmptyString(body?.[field], [field]);
      if (issue !== undefined) {
        bodyIssues.push(issue);
      }
    }

    for (const field of ["inputSchema", "outputSchema", "sop"] as const) {
      const issue = requireNonEmptyString(body?.contracts?.[field], ["contracts", field]);
      if (issue !== undefined) {
        bodyIssues.push(issue);
      }
    }

    throwIfIssues(`${config.id}: createJob returned an incomplete job`, bodyIssues);

    return Object.freeze({
      // Opaque in M1. **M2-T1** replaces this with the sortable scheme it picks
      // for every entity ID; nothing may depend on the format meanwhile.
      id: globalThis.crypto.randomUUID(),
      domain,
      jobType: body.jobType,
      objective: body.objective,
      input: body.input,
      contracts: Object.freeze({ ...body.contracts }),
      budget: Object.freeze({ ...body.budget }),
      permissions: Object.freeze([...(body.permissions ?? [])]),
      metadata: body.metadata ?? {},
    });
  }

  // Frozen so a registered domain cannot be repointed at a different schema or
  // version after something has already been executed against it.
  return Object.freeze({
    id: config.id,
    version: config.version,
    inputSchema: config.inputSchema,
    outputSchema: config.outputSchema,
    createJob,
    evals,
  });
}
