import type { DomainRef, RuntimeInfo } from "./context.js";
import type { DecisionRecord } from "./decision-record.js";
import { type SerializedHarnessError, ValidationError, type ValidationIssue } from "./errors.js";
import { deepFreeze } from "./freeze.js";
import { collectRefIssues, throwIfIssues } from "./identifiers.js";
import {
  type JobId,
  type PromotionId,
  parseEntityId,
  type RunId,
  type WorkflowId,
  type WorkflowVersionId,
} from "./ids.js";
import type { Job } from "./job.js";
import { isJsonObject, isPlainObject } from "./json.js";
import type { TraceEvent } from "./trace.js";
import type {
  WorkflowPromotionRecord,
  WorkflowRecord,
  WorkflowStatus,
  WorkflowVersionRecord,
} from "./workflow-registry.js";

/**
 * The `Storage` port (M2-T5) and the outcome ledger row (M2-T7). **ADR-0036**
 * records the design; `docs/contracts/storage.md` documents it.
 *
 * This is the interface `createHarness()` talks to when it is given one, and
 * the interface `@internal/storage-supabase` implements. It is declared here,
 * in a package that depends on nothing, for the reason the dependency rule
 * exists: "core cannot import Supabase" (build plan section 4). Core states
 * what persistence *means*; an adapter decides what it runs against.
 *
 * Three properties make it what it is.
 *
 * 1. **A run row exists before its first trace event.** {@link Storage.startRun}
 *    is called while the run is still being prepared, so every trace has
 *    something to hang off and a process that dies mid-run leaves a `running`
 *    row rather than nothing at all. "A failed run remains inspectable" is a
 *    property of that ordering, not of good behaviour afterwards.
 * 2. **Every failure is a {@link StorageError} and every failure propagates.**
 *    A storage call that fails comes out of `harness.run()` rather than being
 *    logged; a run whose record was not written is not a run anyone can
 *    inspect, evaluate or replay, so returning `completed` for one would be a
 *    false record. That is Milestone 2's "storage failures cannot silently turn
 *    into successful runs", enforced rather than intended.
 * 3. **Appending a trace batch twice is a no-op.** `(runId, sequence)` is the
 *    identity of an event, so a buffered writer that retries a failed batch
 *    cannot duplicate a run's narrative. "Retrying creates a new attempt, not
 *    duplicate events" is therefore true of the trace as well as of the ledger,
 *    where a new attempt is a new run row.
 *
 * Every method is `async` and may reject. Nothing here returns a status object:
 * a caller that has to remember to check one will eventually not.
 */

/**
 * The state of a run, as the ledger records it.
 *
 * The three terminal states are exactly `HarnessRunResult`'s, plus `running`
 * for the window between {@link Storage.startRun} and {@link Storage.finishRun}.
 * `aborted` is a state of its own rather than a kind of failure (ADR-0031): a
 * run its caller cancelled is neither a completion nor a defect, and folding it
 * into `failed` would teach every downstream query the wrong thing.
 *
 * Exported as a runtime constant as well as a type so that a validator, a
 * reader and the database check constraint share one list rather than three
 * copies that drift.
 */
export const RUN_STATUSES = ["running", "completed", "failed", "aborted"] as const;

/** One of {@link RUN_STATUSES}. */
export type RunStatus = (typeof RUN_STATUSES)[number];

const RUN_STATUS_SET: ReadonlySet<string> = new Set<string>(RUN_STATUSES);

/** True when `value` is a member of the closed status set. */
export function isRunStatus(value: unknown): value is RunStatus {
  return typeof value === "string" && RUN_STATUS_SET.has(value);
}

/**
 * The outcome ledger row: **one query-friendly record per run** (M2-T7).
 *
 * The build plan's list is here in full, with nothing folded into a payload,
 * because the point of the ledger is that cost, latency, success and lineage
 * are answerable by `select` and `group by` without opening a JSON document.
 * The trace is the narrative of a run; this is its summary, and both are
 * written from the same execution.
 *
 * Several fields are permanently `null` or `0` in this milestone. They are
 * honest measurements rather than placeholders: a run today makes no Jev calls
 * (M3), falls back zero times (M5), runs no compiled workflow (M4) and is
 * scored by nothing (M6). Typing them now is what lets those milestones fill a
 * column instead of changing a contract.
 */
export interface RunRecord {
  /** The run. Sortable, so it doubles as a cursor over the ledger. */
  readonly runId: RunId;
  /** The job that was run. */
  readonly jobId: JobId;
  /**
   * Which attempt of the job this run is, counting from 1.
   *
   * An ordinal, not an `AttemptId`, and **there is no attempts table**. M2 has
   * no retries, M2-T5's table list names none, and `Job`, `TraceEvent` and
   * `ExecutionContext` have all settled on a number. `(jobId, attempt)` is
   * unique, which is what makes "retrying creates a new attempt" a rule rather
   * than a convention.
   */
  readonly attempt: number;
  /** The domain and version the job belongs to. */
  readonly domain: DomainRef;
  /** The kind of job within the domain. Part of AD-008's learning scope. */
  readonly jobType: string;
  /** Where the run got to. */
  readonly status: RunStatus;
  /**
   * Whether the run achieved what it was for.
   *
   * `null` while running, and `null` for an aborted run: a run nobody finished
   * has no success value, and `false` would report a cancellation as a defect.
   * Today it tracks `status === "completed"`; it is a separate field because a
   * completed run that produced the wrong answer is M6's concern and this is
   * where M6 will say so.
   */
  readonly success: boolean | null;
  /** **M6 fills this.** `null` means not evaluated, which is not zero. */
  readonly qualityScore: number | null;
  /** What the run spent, in US dollars, or `null` when no producer knew. */
  readonly costUsd: number | null;
  /** Wall-clock duration in milliseconds, or `null` while running. */
  readonly latencyMs: number | null;
  /** Model calls made. */
  readonly modelCalls: number;
  /** Tool calls made. */
  readonly toolCalls: number;
  /** Jev decisions made. **0 until M3**, and a real zero. */
  readonly jevCalls: number;
  /** Times the run fell back to the full agent. **0 until M5**. */
  readonly fallbackCount: number;
  /** Whether a human reviewed the outcome. `null` means not reviewed. */
  readonly humanReview: boolean | null;
  /**
   * The compiled workflow version that ran, or `null`. **M4 fills this**, and
   * `null` is also the honest answer for a run that fell back to the agent.
   */
  readonly workflowVersionId: WorkflowVersionId | null;
  /**
   * Which version of the agent's behavior ran.
   *
   * The build plan asks for an "agent version". The composite behavior
   * fingerprint (M2-T8) is what that means here, because a hand-maintained
   * version string is precisely the value that stops tracking reality without
   * anyone noticing, and north-star invariant 4 needs one that cannot.
   */
  readonly agentVersion: string | null;
  /** The same composite `sha256:` digest every trace event of the run carries. */
  readonly behaviorFingerprint: string | null;
  /** Which runtime adapter executed the run, and its own detail. */
  readonly runtime: RuntimeInfo;
  /**
   * Which application or agent actually executed, e.g.
   * `@internal/eve-fixture-agent`, or `null` when the caller did not say.
   *
   * This closes the open question ADR-0034 recorded: a behavior fingerprint
   * describes a *domain*, so one domain run against a mock agent and against a
   * live one share a fingerprint, and without this column the ledger could not
   * tell them apart.
   */
  readonly target: string | null;
  /** When the run started, as an ISO 8601 string. */
  readonly startedAt: string;
  /** When it reached a terminal state, or `null` while running. */
  readonly finishedAt: string | null;
  /** Why it failed, in ADR-0026's trace-safe form, or `null`. */
  readonly error: SerializedHarnessError | null;
}

/** What {@link Storage.startRun} is given: everything known before execution. */
export interface RunStart {
  /** The run being started. */
  readonly runId: RunId;
  /** The job it runs. Already saved by {@link Storage.saveJob}. */
  readonly jobId: JobId;
  /** Which attempt, counting from 1. */
  readonly attempt: number;
  /** The domain the job belongs to. */
  readonly domain: DomainRef;
  /** The kind of job. */
  readonly jobType: string;
  /** The run's composite behavior fingerprint, or `null`. */
  readonly behaviorFingerprint: string | null;
  /** The behavior version recorded as `agentVersion`, or `null`. */
  readonly agentVersion: string | null;
  /** The compiled workflow version, or `null`. M4 supplies one. */
  readonly workflowVersionId: WorkflowVersionId | null;
  /** Which application or agent is executing, or `null`. */
  readonly target: string | null;
  /**
   * What is executing, as far as it is known *now*.
   *
   * At `startRun` time the harness has not handed the job to an adapter yet, so
   * this is normally `HARNESS_RUNTIME_INFO`. {@link RunFinish} carries the
   * adapter's own identity and overwrites it. Recording the honest placeholder
   * and correcting it is better than leaving the column null and having every
   * reader handle a state that only exists for milliseconds.
   */
  readonly runtime: RuntimeInfo;
  /** When the run started, as an ISO 8601 string. */
  readonly startedAt: string;
}

/** What {@link Storage.finishRun} is given: the outcome. */
export interface RunFinish {
  /** The run being finished. */
  readonly runId: RunId;
  /** Where it got to. Never `running`. */
  readonly status: Exclude<RunStatus, "running">;
  /** Whether it achieved what it was for, or `null`. */
  readonly success: boolean | null;
  /** What it spent, or `null` when no producer knew. */
  readonly costUsd: number | null;
  /** How long it took, in milliseconds. */
  readonly latencyMs: number | null;
  /** Model calls made. */
  readonly modelCalls: number;
  /** Tool calls made. */
  readonly toolCalls: number;
  /** Jev decisions made. 0 until M3. */
  readonly jevCalls: number;
  /** Fallbacks taken: `0` for a run that never escalated, `1` for one that did. */
  readonly fallbackCount: number;
  /**
   * The compiled workflow version that ran, now that the run is over (M5-T3).
   *
   * **Optional, and an absent field leaves the column alone.** `startRun` writes
   * `null`, because the harness does not know which way a run will go before the
   * runtime speaks; a router reports the version it chose, and only then. An
   * explicit `null` clears it. A value is set for a run that escalated too — the
   * column answers "which version was this given to?", and `fallbackCount`
   * answers "did it hand the job back?".
   */
  readonly workflowVersionId?: WorkflowVersionId | null;
  /** Which runtime adapter actually ran it. */
  readonly runtime: RuntimeInfo;
  /** When it reached a terminal state, as an ISO 8601 string. */
  readonly finishedAt: string;
  /** Why it failed, or `null`. */
  readonly error: SerializedHarnessError | null;
}

/**
 * Which runs {@link Storage.listRuns} returns.
 *
 * Every field is optional and an absent field is "any", not "none". The three
 * that matter are AD-008's learning scope: a domain, a version of it, and a job
 * type. The organization, its outermost level, is a property of the domain
 * rather than of a run and is not a filter here.
 */
export interface RunFilter {
  /** Only runs of this domain. */
  readonly domainId?: string;
  /** Only runs of this domain version. */
  readonly domainVersion?: string;
  /** Only runs of this job type. */
  readonly jobType?: string;
  /** Only runs in this state. */
  readonly status?: RunStatus;
  /** Only runs of this job, which is how attempts of one job are listed. */
  readonly jobId?: JobId;
  /**
   * Only runs that executed this compiled workflow version.
   *
   * The circuit breaker's window (M5-T7): "the last N runs of this version" is
   * the only question it asks, and answering it by paging the whole ledger and
   * filtering in memory would make the window depend on how busy the rest of
   * the domain has been.
   */
  readonly workflowVersionId?: WorkflowVersionId;
}

/**
 * Where a {@link Storage.listRuns} page starts, and how big it is.
 *
 * **Keyset, not offset.** The cursor is a run id, and runs are returned newest
 * first, so `after` means "strictly older than this run". A `limit`/`offset`
 * pair over an append-only ledger silently skips or repeats rows whenever a run
 * starts mid-pagination; a keyset cursor over a sortable id cannot.
 */
export interface RunListCursor {
  /** Return runs strictly older than this one. Absent starts at the newest. */
  readonly after?: RunId;
  /** How many rows at most. Defaults to {@link DEFAULT_RUN_PAGE_SIZE}. */
  readonly limit?: number;
}

/** One page of {@link RunRecord}s, newest first. */
export interface RunPage {
  /** The rows, ordered by `runId` descending. */
  readonly runs: readonly RunRecord[];
  /**
   * The `after` value for the next page, or `null` when this page is the last.
   *
   * `null` rather than an absent field so a caller loops on
   * `while (cursor !== null)` without distinguishing "no more" from "forgot to
   * set it".
   */
  readonly nextCursor: RunId | null;
}

/**
 * Where a {@link Storage.getTrace} page starts.
 *
 * The cursor is a `sequence`, because a trace is read in order and `sequence`
 * is the order. There is no descending option: a trace read backwards is not a
 * trace.
 */
export interface TraceCursor {
  /** Return events with a strictly greater sequence. Absent starts at 0. */
  readonly after?: number;
  /** How many events at most. Defaults to {@link DEFAULT_TRACE_PAGE_SIZE}. */
  readonly limit?: number;
}

/** One page of {@link TraceEvent}s, in `sequence` order. */
export interface TracePage {
  /** The events, ordered by `sequence` ascending. */
  readonly events: readonly TraceEvent[];
  /** The `after` value for the next page, or `null` when this page is the last. */
  readonly nextCursor: number | null;
}

/** How many runs {@link Storage.listRuns} returns when no limit is given. */
export const DEFAULT_RUN_PAGE_SIZE = 50;

/** How many events {@link Storage.getTrace} returns when no limit is given. */
export const DEFAULT_TRACE_PAGE_SIZE = 500;

/**
 * The largest page any implementation must serve.
 *
 * It is 1000 because that is what `supabase/config.toml` sets `max_rows` to,
 * and a port whose documented limit exceeds what its first adapter can deliver
 * would be a contract nobody keeps. An implementation MUST reject a larger
 * `limit` with a `ValidationError` rather than quietly truncating, because a
 * silently short page looks exactly like the end of the data.
 */
export const MAX_PAGE_SIZE = 1000;

/**
 * Which workflow versions {@link Storage.listWorkflowVersions} returns.
 *
 * Every field is optional and an absent field is "any", not "none". The two
 * that matter to the router are `domainId` and `jobType`: "every active version
 * that could serve this job" is exactly `{ domainId, jobType, status: "active" }`,
 * and it is the only query M5-T3 makes on the hot path.
 */
export interface WorkflowVersionFilter {
  /** Only versions of workflows in this domain. */
  readonly domainId?: string;
  /** Only versions handling this job type. */
  readonly jobType?: string;
  /** Only versions in this state. */
  readonly status?: WorkflowStatus;
  /** Only versions of this workflow, which is how one workflow's history is read. */
  readonly workflowId?: WorkflowId;
}

/**
 * Where a {@link Storage.listWorkflowVersions} page starts, and how big it is.
 *
 * Keyset, exactly as {@link RunListCursor} is, and for the same reason: the
 * cursor is a {@link WorkflowVersionId}, versions come back newest first, and
 * `after` means "strictly older than this version". Newest first is also the
 * order the selector's tie-break wants, so a router that takes the first page
 * and stops still sees the version that would have won.
 */
export interface WorkflowVersionListCursor {
  /** Return versions strictly older than this one. Absent starts at the newest. */
  readonly after?: WorkflowVersionId;
  /** How many rows at most. Defaults to {@link DEFAULT_WORKFLOW_VERSION_PAGE_SIZE}. */
  readonly limit?: number;
}

/** One page of {@link WorkflowVersionRecord}s, newest first. */
export interface WorkflowVersionPage {
  /** The rows, ordered by version id descending. */
  readonly versions: readonly WorkflowVersionRecord[];
  /** The `after` value for the next page, or `null` when this page is the last. */
  readonly nextCursor: WorkflowVersionId | null;
}

/**
 * What {@link Storage.setWorkflowVersionStatus} is given: one transition,
 * stated in full.
 *
 * `from` is **required**, and that is the whole design. The call is a
 * compare-and-set: it applies only while the version is still in `from`, so two
 * processes promoting the same version cannot both succeed, and a promotion
 * decided against a status that has since changed fails instead of overwriting
 * whatever happened in between. A store with no transactions across two
 * statements still gets the guarantee that matters, because the conditional
 * update is one statement.
 *
 * `actor` is required for the reason AD-005 exists: promotion is human-invoked,
 * so every row in the ledger names who invoked it.
 */
export interface SetWorkflowVersionStatusInput {
  /** The version to move. */
  readonly versionId: WorkflowVersionId;
  /** The status it must currently be in. */
  readonly from: WorkflowStatus;
  /** The status to move it to. Must satisfy `canTransition(from, to)`. */
  readonly to: WorkflowStatus;
  /** Who is moving it. A person, a script, a CI job: something answerable. */
  readonly actor: string;
  /** Why, in their words, or `null`. */
  readonly reason: string | null;
  /**
   * The id of the ledger row this transition writes.
   *
   * Supplied by the caller rather than minted here, because ids are
   * harness-minted UUIDv7 with no database default (ADR-0030) and because a
   * caller that already recorded the promotion it intends can reconcile it.
   */
  readonly promotionId: PromotionId;
  /** When the transition happened, as an ISO 8601 string. */
  readonly changedAt: string;
}

/** How many versions {@link Storage.listWorkflowVersions} returns by default. */
export const DEFAULT_WORKFLOW_VERSION_PAGE_SIZE = 50;

/**
 * Durable storage for jobs, runs and traces.
 *
 * Implemented by `createSupabaseStorage()` in `@internal/storage-supabase` and
 * by `createInMemoryStorage()` in `@internal/testing`. Both run the same
 * `storage.contract.test.ts` suite, which is what makes them interchangeable in
 * fact rather than by assertion (build plan section 8: every implementation of
 * a port runs the same contract suite).
 *
 * Every method rejects with {@link StorageError}, cause preserved, when the
 * underlying store fails, and with `ValidationError` when the caller passed
 * something the port forbids (a page limit above {@link MAX_PAGE_SIZE}, a
 * `finishRun` for a run that was never started).
 */
export interface Storage {
  /**
   * Record a job, and the domain it belongs to.
   *
   * **Idempotent by job id**, because a retried run saves the same job again
   * and a job is immutable, so re-saving it can only ever write the same bytes.
   * It also upserts the job's domain, which is why no seed file has to create
   * one: a domain row is derived from the jobs that reference it rather than
   * maintained separately and forgotten.
   */
  saveJob(job: Job): Promise<void>;
  /**
   * Create this run's ledger row in `running` state, and return it.
   *
   * Called **before the run's first trace event**, so no trace can exist
   * without a run to belong to. Rejects if a row for `(jobId, attempt)` already
   * exists: that is a duplicate run of one attempt, which is exactly the thing
   * the ledger must not silently accept.
   */
  startRun(input: RunStart): Promise<RunRecord>;
  /**
   * Write the outcome onto an existing run row, and return the completed
   * record.
   *
   * Rejects if the run was never started. It does not create a row: a run
   * finishing without having started would mean a trace exists that this
   * milestone's ordering says cannot.
   */
  finishRun(input: RunFinish): Promise<RunRecord>;
  /** Read one run's ledger row, or `null` when there is none. */
  getRun(runId: RunId): Promise<RunRecord | null>;
  /**
   * Read one job back, or `null` when there is none.
   *
   * The returned value has been through `parseJob()`, so a row that is not a
   * job rejects rather than producing a `Job`-shaped lie.
   */
  getJob(jobId: JobId): Promise<Job<unknown, unknown> | null>;
  /** List runs newest first, filtered and paged. */
  listRuns(filter?: RunFilter, cursor?: RunListCursor): Promise<RunPage>;
  /**
   * Append trace events.
   *
   * **Idempotent on `(runId, sequence)`.** A batch that is sent twice writes
   * its rows once; the second call is not an error, because the buffered writer
   * retries a failed batch by design and a retry that failed would strand the
   * run. An event whose `(runId, sequence)` already exists is ignored, not
   * updated: a trace is append-only, so the first write of a position is the
   * true one.
   */
  appendTraceEvents(events: readonly TraceEvent[]): Promise<void>;
  /** Read one run's trace in `sequence` order, paged. */
  getTrace(runId: RunId, cursor?: TraceCursor): Promise<TracePage>;

  // The workflow registry (M5-T1). `workflow_definitions`,
  // `workflow_versions` and `workflow_promotions` existed as minimal keyed
  // placeholders from M2-T5; these six methods are what fills them. They are
  // on the same port rather than on a second one because a run's ledger row
  // already carries `workflowVersionId`, and a registry behind a different
  // port would be a second thing to configure for the same database.
  // ADR-0043 records the model; `docs/contracts/workflow-registry.md`
  // documents it.

  /**
   * Register a workflow, or return the one already registered under the same
   * `(domainId, workflowKey)`.
   *
   * **Idempotent by `(domainId, workflowKey)`**, and it returns the row that
   * now exists rather than nothing: when the key was already taken, the
   * returned record carries the *original* {@link WorkflowId}, which is the id
   * the caller must hang versions off. Re-registering a workflow is the normal
   * case — every new version of `vendor-triage` does it — so a conflict here is
   * a fact, not an error.
   *
   * It also upserts the domain the workflow belongs to, the same way
   * {@link Storage.saveJob} does, so registering a workflow for a domain that
   * has run nothing yet works.
   */
  saveWorkflow(record: WorkflowRecord): Promise<WorkflowRecord>;
  /**
   * Insert one version of a workflow.
   *
   * A plain insert. `(workflowId, fingerprint)` is unique, so registering
   * byte-identical IR twice **rejects loudly** rather than producing a second
   * row: the fingerprint is the version's identity (north-star invariant 4),
   * and two rows for one behavior would make the promotion ledger ambiguous
   * about which one a run used.
   */
  saveWorkflowVersion(record: WorkflowVersionRecord): Promise<WorkflowVersionRecord>;
  /** Read one version, through `parseWorkflowVersionRecord()`, or `null`. */
  getWorkflowVersion(id: WorkflowVersionId): Promise<WorkflowVersionRecord | null>;
  /** List versions newest first, filtered and paged. */
  listWorkflowVersions(
    filter?: WorkflowVersionFilter,
    cursor?: WorkflowVersionListCursor,
  ): Promise<WorkflowVersionPage>;
  /**
   * Move one version from one status to another, and record it.
   *
   * Two things happen together, and both are required for the result to mean
   * anything:
   *
   * 1. the status changes **only if** the version is still in `from` and
   *    `canTransition(from, to)` is true — an illegal transition is a
   *    `ValidationError`, and a lost race is a `StorageError`;
   * 2. a {@link WorkflowPromotionRecord} is appended for the change, so the
   *    history of a version is a ledger rather than a column that remembers
   *    only the last move.
   *
   * Returns the updated version.
   */
  setWorkflowVersionStatus(input: SetWorkflowVersionStatusInput): Promise<WorkflowVersionRecord>;
  /**
   * Read one version's promotion history, oldest first.
   *
   * Oldest first rather than newest, unlike every other list here: this is a
   * narrative of how a version reached its current status, and a narrative read
   * backwards is not one. It is unpaged because the list is bounded by the
   * transition table — a version can change status at most a handful of times
   * before reaching a terminal state.
   */
  listWorkflowPromotions(versionId: WorkflowVersionId): Promise<readonly WorkflowPromotionRecord[]>;

  // Decision evidence (M3-T3). `decisions` existed as a minimal keyed
  // placeholder from M2-T5 — a `DecisionId`, the run it was made in and one
  // `payload jsonb` — and these two methods are what fills it. They are on the
  // same port for the same reason the registry methods are: a decision belongs
  // to a run whose ledger row is already here, and a second port would be a
  // second thing to configure for the same database. ADR-0045 records the
  // model; `docs/contracts/decision-engine.md` documents it.

  /**
   * Store one decision's complete evidence.
   *
   * **A plain insert, and a duplicate id rejects loudly.** A `DecisionId` is
   * minted by the engine when it answers, so the same id arriving twice means
   * either a retry that should not have re-recorded or two decisions that
   * collided, and both are facts a caller has to see. Nothing here upserts: a
   * decision is what an engine produced at a moment, and overwriting one would
   * destroy the evidence a replay depends on.
   *
   * Returns the record as it now exists, read back through
   * {@link parseDecisionRecord}.
   */
  saveDecision(record: DecisionRecord): Promise<DecisionRecord>;
  /**
   * Read one run's decisions, in `id` order.
   *
   * Oldest first, like {@link Storage.listWorkflowPromotions} and unlike the
   * ledger's newest-first lists: the decisions of one run are the order in
   * which its judgments were made, and a `DecisionId` is a sortable UUIDv7, so
   * `id` order is that order. Unpaged, because the list is bounded by the
   * number of `jev` nodes a workflow contains.
   */
  listDecisions(runId: RunId): Promise<readonly DecisionRecord[]>;
}

/**
 * Validate a page limit, or throw.
 *
 * Shared by every implementation so that "a limit above the maximum is an
 * error, not a truncation" is one rule rather than one per adapter.
 *
 * @throws {ValidationError} if `limit` is not an integer in `1..MAX_PAGE_SIZE`.
 */
export function resolvePageLimit(limit: number | undefined, fallback: number): number {
  if (limit === undefined) {
    return fallback;
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new ValidationError(`storage: \`limit\` must be an integer in 1..${MAX_PAGE_SIZE}`, {
      issues: [
        {
          path: ["limit"],
          message: `expected an integer in 1..${MAX_PAGE_SIZE}, received ${String(limit)}`,
        },
      ],
    });
  }

  return limit;
}

/** The nineteen fields a {@link RunRecord} has, and the only ones accepted. */
const RUN_RECORD_FIELDS = [
  "runId",
  "jobId",
  "attempt",
  "domain",
  "jobType",
  "status",
  "success",
  "qualityScore",
  "costUsd",
  "latencyMs",
  "modelCalls",
  "toolCalls",
  "jevCalls",
  "fallbackCount",
  "humanReview",
  "workflowVersionId",
  "agentVersion",
  "behaviorFingerprint",
  "runtime",
  "target",
  "startedAt",
  "finishedAt",
  "error",
] as const;

/** The counter fields, each a non-negative integer. */
const RUN_RECORD_COUNTERS = ["modelCalls", "toolCalls", "jevCalls", "fallbackCount"] as const;

/** The nullable numeric fields, each a finite number when present. */
const RUN_RECORD_NULLABLE_NUMBERS = ["qualityScore", "costUsd"] as const;

/** The nullable boolean fields. */
const RUN_RECORD_NULLABLE_BOOLEANS = ["success", "humanReview"] as const;

/** The nullable string fields. */
const RUN_RECORD_NULLABLE_STRINGS = ["agentVersion", "behaviorFingerprint", "target"] as const;

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && value !== "" && Number.isFinite(Date.parse(value));
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

/** Re-path a thrown `ValidationError`'s issues, the way `parseJob` does. */
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

function collectRuntimeIssues(
  value: unknown,
  path: readonly (string | number)[],
): ValidationIssue[] {
  if (!isPlainObject(value)) {
    return [{ path: [...path], message: "expected a `{ name, version, metadata }` object" }];
  }

  const issues: ValidationIssue[] = [
    ...collectUnknownKeyIssues(value, ["name", "version", "metadata"], path),
  ];

  for (const field of ["name", "version"] as const) {
    if (typeof value[field] !== "string" || value[field] === "") {
      issues.push({ path: [...path, field], message: "expected a non-empty string" });
    }
  }

  if (!isJsonObject(value.metadata)) {
    issues.push({ path: [...path, "metadata"], message: "expected a JSON object" });
  }

  return issues;
}

/**
 * Turn an untrusted value into a {@link RunRecord}, or throw explaining why it
 * is not one.
 *
 * The same boundary `parseJob()` is for jobs, and for the same reason: a row
 * read out of a database, a JSON document handed to the inspector (M2-T10) or
 * frozen evidence replayed by M6 is an `unknown` claiming to be a ledger row,
 * and asserting the claim is not checking it. Every problem is reported at
 * once, each with the path to the field that caused it, and an unknown field is
 * an error rather than something to drop: a record this version does not
 * understand was not written by this version.
 *
 * The returned record is deep-frozen, because a record read back is as
 * immutable as the run it describes.
 *
 * @throws {ValidationError} listing every field that failed.
 */
export function parseRunRecord(value: unknown, path: readonly (string | number)[] = []): RunRecord {
  if (!isPlainObject(value)) {
    throw new ValidationError("parseRunRecord: value is not a run record", {
      issues: [{ path: [...path], message: "expected a run record object" }],
    });
  }

  const issues: ValidationIssue[] = [...collectUnknownKeyIssues(value, RUN_RECORD_FIELDS, path)];

  issues.push(
    ...collectThrownIssues(() => {
      parseEntityId("run", value.runId);
    }, [...path, "runId"]),
    ...collectThrownIssues(() => {
      parseEntityId("job", value.jobId);
    }, [...path, "jobId"]),
  );

  if (!Number.isInteger(value.attempt) || (value.attempt as number) < 1) {
    issues.push({ path: [...path, "attempt"], message: "expected an integer >= 1" });
  }

  if (isPlainObject(value.domain)) {
    issues.push(...collectRefIssues(value.domain.id, value.domain.version, [...path, "domain"]));
  } else {
    issues.push({ path: [...path, "domain"], message: "expected an `{ id, version }` reference" });
  }

  if (typeof value.jobType !== "string" || value.jobType.trim() === "") {
    issues.push({ path: [...path, "jobType"], message: "expected a non-empty string" });
  }

  if (!isRunStatus(value.status)) {
    issues.push({
      path: [...path, "status"],
      message: `expected one of ${RUN_STATUSES.join(", ")}`,
    });
  }

  for (const field of RUN_RECORD_NULLABLE_BOOLEANS) {
    if (value[field] !== null && typeof value[field] !== "boolean") {
      issues.push({ path: [...path, field], message: "expected a boolean or null" });
    }
  }

  for (const field of RUN_RECORD_NULLABLE_NUMBERS) {
    const held = value[field];

    if (held !== null && (typeof held !== "number" || !Number.isFinite(held))) {
      issues.push({ path: [...path, field], message: "expected a finite number or null" });
    }
  }

  if (
    value.latencyMs !== null &&
    (!Number.isInteger(value.latencyMs) || (value.latencyMs as number) < 0)
  ) {
    issues.push({ path: [...path, "latencyMs"], message: "expected an integer >= 0 or null" });
  }

  for (const field of RUN_RECORD_COUNTERS) {
    if (!Number.isInteger(value[field]) || (value[field] as number) < 0) {
      issues.push({ path: [...path, field], message: "expected an integer >= 0" });
    }
  }

  if (value.workflowVersionId !== null) {
    issues.push(
      ...collectThrownIssues(() => {
        parseEntityId("workflow-version", value.workflowVersionId);
      }, [...path, "workflowVersionId"]),
    );
  }

  for (const field of RUN_RECORD_NULLABLE_STRINGS) {
    const held = value[field];

    if (held !== null && (typeof held !== "string" || held === "")) {
      issues.push({ path: [...path, field], message: "expected a non-empty string or null" });
    }
  }

  issues.push(...collectRuntimeIssues(value.runtime, [...path, "runtime"]));

  if (!isIsoTimestamp(value.startedAt)) {
    issues.push({ path: [...path, "startedAt"], message: "expected an ISO 8601 timestamp" });
  }

  if (value.finishedAt !== null && !isIsoTimestamp(value.finishedAt)) {
    issues.push({
      path: [...path, "finishedAt"],
      message: "expected an ISO 8601 timestamp or null",
    });
  }

  // The error is checked for being a JSON object and nothing more. Its shape is
  // `SerializedHarnessError`, which ADR-0026 defines as a whitelist produced by
  // `serializeError`; re-deriving that whitelist here would be a second copy of
  // it that drifts, and a record whose error is a JSON object is readable
  // either way.
  if (value.error !== null && !isJsonObject(value.error)) {
    issues.push({ path: [...path, "error"], message: "expected a JSON object or null" });
  }

  throwIfIssues("parseRunRecord: value is not a run record", issues);

  const domain = value.domain as { readonly id: string; readonly version: string };
  const runtime = value.runtime as { readonly [key: string]: unknown };

  return deepFreeze({
    runId: parseEntityId("run", value.runId),
    jobId: parseEntityId("job", value.jobId),
    attempt: value.attempt as number,
    domain: { id: domain.id, version: domain.version },
    jobType: value.jobType as string,
    status: value.status as RunStatus,
    success: value.success as boolean | null,
    qualityScore: value.qualityScore as number | null,
    costUsd: value.costUsd as number | null,
    latencyMs: value.latencyMs as number | null,
    modelCalls: value.modelCalls as number,
    toolCalls: value.toolCalls as number,
    jevCalls: value.jevCalls as number,
    fallbackCount: value.fallbackCount as number,
    humanReview: value.humanReview as boolean | null,
    workflowVersionId:
      value.workflowVersionId === null
        ? null
        : parseEntityId("workflow-version", value.workflowVersionId),
    agentVersion: value.agentVersion as string | null,
    behaviorFingerprint: value.behaviorFingerprint as string | null,
    runtime: {
      name: runtime.name as string,
      version: runtime.version as string,
      metadata: runtime.metadata as RuntimeInfo["metadata"],
    },
    target: value.target as string | null,
    startedAt: value.startedAt as string,
    finishedAt: value.finishedAt as string | null,
    error: value.error as SerializedHarnessError | null,
  });
}
