import type { Budget, DomainRef, ToolGrant } from "./context.js";
import type { JobId } from "./ids.js";
import type { JsonObject } from "./json.js";

/**
 * The string references a job carries to the contracts it was created under.
 *
 * They are **references, not schemas**: a job is serialized into a trace and a
 * run record, so it names its contracts rather than embedding validators that
 * cannot survive `JSON.stringify`. Resolving a reference to the actual schema
 * is the capability registry's job (M1-T9); in M1 these are plain strings the
 * example domain writes by hand, in the shape `vendor-triage.input@1.0.0`.
 */
export interface JobContracts {
  /** Reference to the schema the job's input satisfies. */
  readonly inputSchema: string;
  /** Reference to the schema the job's output must satisfy. */
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
 * retry reuses the job and gets a new context. Every field is readonly, because
 * "jobs are immutable after execution begins" (M2-T2) is a property of the type
 * here rather than a convention.
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
 *
 * **M2-T2 finalizes this schema.** The M1 shape is the build plan's, unchanged.
 */
export interface Job<TInput = unknown, TOutput = unknown> {
  /**
   * The job's unique identifier: a sortable UUIDv7, minted by `newJobId()`
   * (M2-T1, ADR-0030). It is branded, so a `RunId` or a bare `string` cannot be
   * passed here, and it sorts lexicographically in creation order.
   */
  readonly id: JobId;
  /** The domain and domain version this job belongs to. */
  readonly domain: DomainRef;
  /** Which kind of job this is within the domain, e.g. `vendor-triage`. */
  readonly jobType: string;
  /** What this job is for, in one sentence, addressed to whatever executes it. */
  readonly objective: string;
  /** The validated input. */
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
