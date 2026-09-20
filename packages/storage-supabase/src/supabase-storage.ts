import {
  canTransition,
  DEFAULT_RUN_PAGE_SIZE,
  DEFAULT_TRACE_PAGE_SIZE,
  DEFAULT_WORKFLOW_VERSION_PAGE_SIZE,
  type DecisionRecord,
  type Job,
  type JobId,
  type JsonObject,
  type JsonValue,
  parseDecisionRecord,
  parseEntityId,
  parseJob,
  parseRunRecord,
  parseTraceEvent,
  parseWorkflowPromotionRecord,
  parseWorkflowRecord,
  parseWorkflowVersionRecord,
  type RunFilter,
  type RunFinish,
  type RunId,
  type RunListCursor,
  type RunPage,
  type RunRecord,
  type RunStart,
  resolvePageLimit,
  type SetWorkflowVersionStatusInput,
  type Storage,
  StorageError,
  type TraceCursor,
  type TraceEvent,
  type TracePage,
  ValidationError,
  type WorkflowPromotionRecord,
  type WorkflowRecord,
  type WorkflowVersionFilter,
  type WorkflowVersionId,
  type WorkflowVersionListCursor,
  type WorkflowVersionPage,
  type WorkflowVersionRecord,
} from "@internal/core";
import { createRedactor, DEFAULT_REDACTION_POLICY, type RedactionPolicy } from "@internal/trace";
import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "./database.types.js";

/**
 * The Supabase implementation of the `Storage` port (M2-T5, M2-T7).
 * **ADR-0036** records the design; `docs/contracts/storage.md` documents the
 * port and this adapter's behaviour.
 *
 * This is the **only** place in the workspace that touches a database
 * (AGENTS.md: "No direct database access outside `packages/storage-supabase`",
 * enforced by `tests/architecture/boundaries.ts`, which makes `@supabase/*`
 * adapter-only). Nothing Supabase-shaped leaves it: the port's types go in, the
 * port's types come out, and a `PostgrestError` becomes a `StorageError`.
 *
 * ## The row/record boundary
 *
 * Column names are `snake_case` and contract fields are `camelCase`, and the
 * mapping between them is explicit in this file rather than mechanical. Two
 * places where the names genuinely differ, both deliberate:
 *
 * - `TraceEvent.timestamp` is the `occurred_at` column, because `timestamp` is
 *   a Postgres type name and a column called that needs quoting everywhere.
 * - `RuntimeInfo` is three columns, `runtime_name` / `runtime_version` /
 *   `runtime_metadata`, because the two identifying strings are grouped and
 *   filtered on and the adapter's free-form detail is not.
 *
 * Every read goes back through `parseJob()` / `parseRunRecord()` /
 * `parseTraceEvent()`, all three from `@internal/core`. A row is untrusted
 * input even when this adapter wrote it:
 * the schema can be migrated, a row can be edited by hand, and "the database
 * gave it to me" is not a proof of shape.
 *
 * ## Errors
 *
 * `@supabase/postgrest-js` never throws for a database failure; it resolves
 * `{ data, error }`, so a call site that forgets to read `error` silently
 * believes a failed write succeeded. Every call here goes through
 * {@link failed}, which turns a `PostgrestError` into a `StorageError` carrying
 * the PostgREST/Postgres `code`, the `hint` (which is where Postgres puts the
 * actionable fix) and the `message` — and **never a key, a URL or a row**.
 */

/** What {@link createSupabaseStorage} accepts. */
export interface CreateSupabaseStorageOptions {
  /** The Supabase API URL, e.g. `http://127.0.0.1:54321` locally. */
  readonly url: string;
  /**
   * The service-role (secret) key.
   *
   * **Server-side only.** It authorizes the `service_role` Postgres role, which
   * holds `bypassrls`, and every table in this schema has row-level security
   * enabled with no policies, so this key is the only thing that can read or
   * write them. It must never reach a client, an agent tool or a trace.
   */
  readonly serviceRoleKey: string;
  /**
   * The redaction policy applied to what is written. Defaults to
   * {@link DEFAULT_REDACTION_POLICY}. See "Redaction" below.
   */
  readonly policy?: RedactionPolicy;
  /**
   * An existing client to use instead of building one. For tests that need to
   * observe the transport; ordinary callers pass `url` and `serviceRoleKey`.
   */
  readonly client?: SupabaseClient<Database>;
}

/** The `Storage` implementation, plus the client for a caller that needs it. */
export interface SupabaseStorage extends Storage {
  /** The underlying client. Escape hatch for a migration script or a test. */
  readonly client: SupabaseClient<Database>;
}

type RunRow = Database["public"]["Tables"]["runs"]["Row"];
type RunInsert = Database["public"]["Tables"]["runs"]["Insert"];
type TraceEventRow = Database["public"]["Tables"]["trace_events"]["Row"];
type TraceEventInsert = Database["public"]["Tables"]["trace_events"]["Insert"];
type WorkflowRow = Database["public"]["Tables"]["workflow_definitions"]["Row"];
type WorkflowVersionRow = Database["public"]["Tables"]["workflow_versions"]["Row"];
type WorkflowPromotionRow = Database["public"]["Tables"]["workflow_promotions"]["Row"];
type DecisionRow = Database["public"]["Tables"]["decisions"]["Row"];

/**
 * Turn a `PostgrestError` into a {@link StorageError}.
 *
 * `details` carries what a person debugging this actually needs and nothing
 * else. `hint` is included because postgrest-js's own documentation says
 * Postgres puts the actionable fix there rather than in `message`; `code` is
 * included because the same documentation says to branch on it rather than on
 * message text. The connection URL and the key are never included, and neither
 * is the row that failed: a `details` field ends up in a `StorageError` that a
 * caller may log, and a row can contain anything.
 */
function failed(operation: string, error: PostgrestError, context: JsonObject = {}): StorageError {
  return new StorageError(`supabase storage: \`${operation}\` failed: ${error.message}`, {
    cause: error,
    details: {
      operation,
      code: error.code,
      hint: error.hint,
      details: error.details,
      ...context,
    },
  });
}

/**
 * A `JsonValue` as the generated types' `Json` wants it.
 *
 * The two describe the same set of values; they differ only in that
 * `JsonObject`'s index signature admits `undefined` (so that a type with
 * optional properties is assignable to it, per ADR-0026) while the generated
 * `Json` does not. `JSON.stringify` drops such a property either way, and
 * PostgREST serializes the value with `JSON.stringify`, so the conversion is a
 * type-level statement about something already true at runtime.
 *
 * This is the one place a cast of this kind is written, rather than at each of
 * the eight call sites, so that the reasoning lives beside it.
 */
function asJson(value: JsonValue | undefined): Json {
  return (value ?? null) as Json;
}

/** Read a `jsonb` column back as a `JsonObject`, or `null`. */
function readJsonObject(value: Json | null): JsonObject | null {
  return value === null || typeof value !== "object" || Array.isArray(value)
    ? null
    : (value as JsonObject);
}

/** The ISO 8601 form the contract uses, from whatever Postgres returned. */
function isoTimestamp(value: string): string {
  return new Date(value).toISOString();
}

/** Turn a ledger row into the record the port promises. */
function readRunRecord(row: RunRow): RunRecord {
  return parseRunRecord({
    runId: row.id,
    jobId: row.job_id,
    attempt: row.attempt,
    domain: { id: row.domain_id, version: row.domain_version },
    jobType: row.job_type,
    status: row.status,
    success: row.success,
    qualityScore: row.quality_score,
    costUsd: row.cost_usd,
    latencyMs: row.latency_ms,
    modelCalls: row.model_calls,
    toolCalls: row.tool_calls,
    jevCalls: row.jev_calls,
    fallbackCount: row.fallback_count,
    humanReview: row.human_review,
    workflowVersionId: row.workflow_version_id,
    agentVersion: row.agent_version,
    behaviorFingerprint: row.behavior_fingerprint,
    runtime: {
      name: row.runtime_name,
      version: row.runtime_version,
      metadata: readJsonObject(row.runtime_metadata) ?? {},
    },
    target: row.target,
    startedAt: isoTimestamp(row.started_at),
    finishedAt: row.finished_at === null ? null : isoTimestamp(row.finished_at),
    error: row.error,
  });
}

/**
 * Turn a trace row back into a {@link TraceEvent}, or throw.
 *
 * Only the column-name mapping lives here; the checking is
 * `parseTraceEvent()` in `@internal/core` (M2-T10), beside `parseJob()` and
 * `parseRunRecord()`. When this adapter was written it was the first code that
 * had to read an event back, so the checks were local and this comment said
 * that if a second reader ever needed them they belonged in core. The run
 * inspector is that second reader, so they moved, and a row read here and a
 * JSONL line read by the inspector now fail in exactly the same way.
 *
 * A row is untrusted input even though this adapter wrote it: the schema can be
 * migrated and a row can be edited by hand.
 */
/** Turn a `workflow_definitions` row into the record the port promises. */
function readWorkflowRecord(row: WorkflowRow): WorkflowRecord {
  return parseWorkflowRecord({
    id: row.id,
    domainId: row.domain_id,
    domainVersion: row.domain_version,
    workflowKey: row.workflow_key,
    jobType: row.job_type,
    createdAt: isoTimestamp(row.created_at),
  });
}

/**
 * Turn a `workflow_versions` row into a {@link WorkflowVersionRecord}, or throw.
 *
 * The two denormalized columns, `domain_id` and `job_type`, are deliberately
 * **not** read: they exist so the router can filter and page one table, and the
 * authoritative copies are inside `compatibility`, derived from the IR. Reading
 * the columns instead would make a row that had drifted look consistent.
 */
function readWorkflowVersionRecord(row: WorkflowVersionRow): WorkflowVersionRecord {
  return parseWorkflowVersionRecord({
    id: row.id,
    workflowId: row.workflow_id,
    definition: row.definition,
    fingerprint: row.fingerprint,
    status: row.status,
    compatibility: row.compatibility,
    createdAt: isoTimestamp(row.created_at),
    statusChangedAt: isoTimestamp(row.status_changed_at),
    metadata: readJsonObject(row.metadata) ?? {},
  });
}

/**
 * Every `id@version` a decision answered, as the `question_ids` column stores
 * them.
 *
 * Derived from the record's own answers rather than passed in, so the column
 * and the document cannot disagree about which questions were asked. Sorted and
 * de-duplicated, because a set in an array column with a stable order is what
 * makes two rows comparable; one call may legitimately ask one question twice
 * about two parts of a state, and the column is about *which* questions, not
 * how many times.
 */
function questionRefsOf(record: DecisionRecord): string[] {
  return [
    ...new Set(
      Object.values(record.result.answers).map(
        (answer) => `${answer.questionId}@${answer.questionVersion}`,
      ),
    ),
  ].sort();
}

/**
 * Turn a `decisions` row into a {@link DecisionRecord}, or throw.
 *
 * The six denormalized columns — `state_fingerprint`, `question_ids`,
 * `model_provider`, `model_id`, `cost_usd`, `latency_ms` — are deliberately
 * **not** read, for the same reason `workflow_versions`' `domain_id` is not:
 * they exist so a query can `group by` without opening a JSON document, and the
 * authoritative copies are inside `result`. Reading the columns instead would
 * make a row that had drifted look consistent.
 */
function readDecisionRecord(row: DecisionRow): DecisionRecord {
  return parseDecisionRecord({
    id: row.id,
    runId: row.run_id,
    nodeId: row.node_id,
    result: row.result,
    policy: row.policy,
    createdAt: isoTimestamp(row.created_at),
  });
}

/** Turn a `workflow_promotions` row into a {@link WorkflowPromotionRecord}. */
function readWorkflowPromotionRecord(row: WorkflowPromotionRow): WorkflowPromotionRecord {
  return parseWorkflowPromotionRecord({
    id: row.id,
    workflowVersionId: row.workflow_version_id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    actor: row.actor,
    reason: row.reason,
    createdAt: isoTimestamp(row.created_at),
  });
}

function readTraceEvent(row: TraceEventRow): TraceEvent {
  return parseTraceEvent({
    id: row.id,
    runId: row.run_id,
    attempt: row.attempt,
    sequence: row.sequence,
    timestamp: isoTimestamp(row.occurred_at),
    type: row.type,
    parentId: row.parent_id,
    node: row.node,
    // The stored version, not `TRACE_EVENT_VERSION`: a row written by an older
    // version of the schema must read back saying so, which is the entire point
    // of the field. `parseTraceEvent` accepts any integer >= 1 for that reason.
    version: row.version,
    behaviorFingerprint: row.behavior_fingerprint,
    payload: row.payload,
    usage: readJsonObject(row.usage),
    latencyMs: row.latency_ms,
    error: row.error,
  });
}

/**
 * Create the Supabase {@link Storage}.
 *
 * ```ts
 * const storage = createSupabaseStorage({
 *   url: process.env.SUPABASE_URL,
 *   serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
 * });
 * ```
 *
 * The three `auth` options are turned **off**, against the installed defaults,
 * which are all `true`. They are browser behaviours: `autoRefreshToken` starts
 * a background refresh timer that keeps a Node process alive, `persistSession`
 * writes to storage a server has no business having, and `detectSessionInUrl`
 * reads a URL fragment that does not exist here. A service-role key is not a
 * session and none of the three has anything to do.
 *
 * ## Redaction
 *
 * This adapter is the last code that runs before anything becomes durable, so
 * it redacts what it writes: trace event payloads and errors, and the run row's
 * `error` and `runtime.metadata`. The writer chain already redacts the events
 * (ADR-0035) and redaction is idempotent, so that pass is belt and braces —
 * but the **run row is not a trace event and no writer chain reaches it**, so
 * for `runs.error` this is the only pass there is. A serialized error's
 * `details` is explicitly not a redaction boundary (ADR-0026) and its `message`
 * is whatever a framework wrote, so leaving the ledger's copy unredacted while
 * redacting the trace's copy of the same value would be an inconsistency with a
 * secret in it.
 *
 * @throws {ValidationError} if `url` or `serviceRoleKey` is empty, rather than
 * failing on the first query with a transport error that names neither.
 */
export function createSupabaseStorage(options: CreateSupabaseStorageOptions): SupabaseStorage {
  const redactor = createRedactor(options.policy ?? DEFAULT_REDACTION_POLICY);

  const client =
    options.client ??
    createClient<Database>(
      requireOption(options.url, "url"),
      requireOption(options.serviceRoleKey, "serviceRoleKey"),
      {
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      },
    );

  /** Redact one nullable JSON object as if it sat at `field` on an event. */
  function redactField(value: JsonObject | null, field: string): JsonObject | null {
    return value === null ? null : (redactor.redactValue(value, [field]) as JsonObject);
  }

  /**
   * Upsert the domain a job belongs to.
   *
   * Derived from the jobs that reference it rather than maintained separately,
   * which is why `supabase/seed.sql` needs no domain row: a seed that had to be
   * kept in step with the domains an application actually defines is a seed
   * that goes stale, and `db reset` would then fail for a reason unrelated to
   * the schema.
   *
   * `ignoreDuplicates: true` because a domain row carries nothing a later run
   * could correct: it is `(id, version)` plus the organization scope, and
   * merging would rewrite the row on every single run for no change.
   */
  async function saveDomain(id: string, version: string, operation: string): Promise<void> {
    const { error } = await client.from("domains").upsert(
      { id, version },
      {
        onConflict: "id,version",
        ignoreDuplicates: true,
      },
    );

    if (error !== null) {
      throw failed(operation, error, { table: "domains", domainId: id });
    }
  }

  async function readRun(runId: RunId, operation: string): Promise<RunRow | null> {
    const { data, error } = await client.from("runs").select("*").eq("id", runId).maybeSingle();

    if (error !== null) {
      throw failed(operation, error, { table: "runs", runId });
    }

    return data;
  }

  return {
    client,

    async saveJob(job: Job): Promise<void> {
      // The domain first: `jobs` has a foreign key to it, so the other order
      // fails with a constraint violation on the very first run of a new
      // domain, which is the common case rather than an edge one.
      await saveDomain(job.domain.id, job.domain.version, "saveJob");

      const { error } = await client.from("jobs").upsert(
        {
          id: job.id,
          domain_id: job.domain.id,
          domain_version: job.domain.version,
          job_type: job.jobType,
          objective: job.objective,
          // The whole effective job, so `parseJob()` can rebuild it exactly.
          // Not redacted: a job's `input` is the work itself, and a harness
          // that stored a redacted job could not replay one (ADR-0035 scopes
          // redaction to the trace, which is the thing that gets *shown*).
          job: asJson(job as unknown as JsonValue),
          behavior_fingerprint: null,
        },
        // A job is immutable (ADR-0032), so re-saving it can only ever write
        // the same bytes. Ignoring rather than merging says that, and makes a
        // retried run's `saveJob` free.
        { onConflict: "id", ignoreDuplicates: true },
      );

      if (error !== null) {
        throw failed("saveJob", error, { table: "jobs", jobId: job.id });
      }
    },

    async startRun(input: RunStart): Promise<RunRecord> {
      const row: RunInsert = {
        id: input.runId,
        job_id: input.jobId,
        attempt: input.attempt,
        domain_id: input.domain.id,
        domain_version: input.domain.version,
        job_type: input.jobType,
        status: "running",
        success: null,
        quality_score: null,
        cost_usd: null,
        latency_ms: null,
        model_calls: 0,
        tool_calls: 0,
        jev_calls: 0,
        fallback_count: 0,
        human_review: null,
        workflow_version_id: input.workflowVersionId,
        agent_version: input.agentVersion,
        behavior_fingerprint: input.behaviorFingerprint,
        runtime_name: input.runtime.name,
        runtime_version: input.runtime.version,
        runtime_metadata: asJson(redactField(input.runtime.metadata, "payload") ?? {}),
        target: input.target,
        started_at: input.startedAt,
        finished_at: null,
        error: null,
      };

      // A plain insert, not an upsert. A second `startRun` for the same run, or
      // for the same `(job_id, attempt)`, is a duplicate run of one attempt and
      // must fail loudly: silently merging it would be the ledger accepting two
      // executions as one, which is exactly what "retrying creates a new
      // attempt" forbids.
      const { data, error } = await client.from("runs").insert(row).select("*").single();

      if (error !== null) {
        throw failed("startRun", error, {
          table: "runs",
          runId: input.runId,
          jobId: input.jobId,
          attempt: input.attempt,
        });
      }

      return readRunRecord(data);
    },

    async finishRun(input: RunFinish): Promise<RunRecord> {
      const { data, error } = await client
        .from("runs")
        .update({
          status: input.status,
          success: input.success,
          cost_usd: input.costUsd,
          latency_ms: input.latencyMs,
          model_calls: input.modelCalls,
          tool_calls: input.toolCalls,
          jev_calls: input.jevCalls,
          fallback_count: input.fallbackCount,
          // Absent leaves the column as `startRun` wrote it; present overwrites
          // it, including with an explicit `null` (M5-T3).
          ...(input.workflowVersionId === undefined
            ? {}
            : { workflow_version_id: input.workflowVersionId }),
          runtime_name: input.runtime.name,
          runtime_version: input.runtime.version,
          runtime_metadata: asJson(redactField(input.runtime.metadata, "payload") ?? {}),
          finished_at: input.finishedAt,
          error: asJson(redactField(input.error, "error")),
        })
        .eq("id", input.runId)
        .select("*")
        .maybeSingle();

      if (error !== null) {
        throw failed("finishRun", error, { table: "runs", runId: input.runId });
      }

      // An update that matched nothing means the run was never started. It is
      // not a database failure, so PostgREST reports success with no row; the
      // port says it must reject, because a run finishing that never started
      // would mean a trace exists for an execution the ledger never opened.
      if (data === null) {
        throw new StorageError(`supabase storage: \`finishRun\` found no run \`${input.runId}\``, {
          details: { operation: "finishRun", runId: input.runId },
        });
      }

      return readRunRecord(data);
    },

    async getRun(runId: RunId): Promise<RunRecord | null> {
      const row = await readRun(runId, "getRun");

      return row === null ? null : readRunRecord(row);
    },

    async getJob(jobId: JobId): Promise<Job<unknown, unknown> | null> {
      const { data, error } = await client.from("jobs").select("job").eq("id", jobId).maybeSingle();

      if (error !== null) {
        throw failed("getJob", error, { table: "jobs", jobId });
      }

      // Through `parseJob()`, which is what M2-T2 built it for: a row that is
      // not a job rejects here rather than becoming a `Job`-shaped lie two
      // milestones downstream.
      return data === null ? null : parseJob(data.job);
    },

    async listRuns(filter: RunFilter = {}, cursor: RunListCursor = {}): Promise<RunPage> {
      const limit = resolvePageLimit(cursor.limit, DEFAULT_RUN_PAGE_SIZE);

      let query = client.from("runs").select("*");

      if (filter.domainId !== undefined) {
        query = query.eq("domain_id", filter.domainId);
      }
      if (filter.domainVersion !== undefined) {
        query = query.eq("domain_version", filter.domainVersion);
      }
      if (filter.jobType !== undefined) {
        query = query.eq("job_type", filter.jobType);
      }
      if (filter.status !== undefined) {
        query = query.eq("status", filter.status);
      }
      if (filter.jobId !== undefined) {
        query = query.eq("job_id", filter.jobId);
      }
      if (filter.workflowVersionId !== undefined) {
        query = query.eq("workflow_version_id", filter.workflowVersionId);
      }
      // Keyset, not offset: a run id is sortable, so "older than this run" is
      // an index range. `limit + 1` is fetched so that "is there another page?"
      // is answered by fact rather than by assuming a full page implies one.
      if (cursor.after !== undefined) {
        query = query.lt("id", cursor.after);
      }

      const { data, error } = await query.order("id", { ascending: false }).limit(limit + 1);

      if (error !== null) {
        throw failed("listRuns", error, { table: "runs" });
      }

      const rows = data.slice(0, limit);
      const hasMore = data.length > limit;

      return {
        runs: rows.map(readRunRecord),
        nextCursor: hasMore ? (parseEntityId("run", rows.at(-1)?.id) ?? null) : null,
      };
    },

    async appendTraceEvents(events: readonly TraceEvent[]): Promise<void> {
      if (events.length === 0) {
        return;
      }

      const rows: TraceEventInsert[] = redactor.redactEvents(events).map((event) => ({
        id: event.id,
        run_id: event.runId,
        attempt: event.attempt,
        sequence: event.sequence,
        occurred_at: event.timestamp,
        type: event.type,
        parent_id: event.parentId,
        node: event.node,
        version: event.version,
        behavior_fingerprint: event.behaviorFingerprint,
        payload: asJson(event.payload),
        usage: asJson(event.usage),
        latency_ms: event.latencyMs,
        error: asJson(event.error),
      }));

      // Idempotent on `(run_id, sequence)`. `ignoreDuplicates: true` sends
      // `Prefer: resolution=ignore-duplicates`, which PostgREST turns into
      // `ON CONFLICT (run_id, sequence) DO NOTHING`, so a batch the buffered
      // writer retries after a failure writes its rows once. Ignoring rather
      // than merging is the right half of the choice too: a trace is
      // append-only, so the first write of a position is the true one and a
      // later one is a retry of the same event, not a correction of it.
      const { error } = await client
        .from("trace_events")
        .upsert(rows, { onConflict: "run_id,sequence", ignoreDuplicates: true });

      if (error !== null) {
        throw failed("appendTraceEvents", error, {
          table: "trace_events",
          events: rows.length,
          runId: events[0]?.runId ?? null,
        });
      }
    },

    async getTrace(runId: RunId, cursor: TraceCursor = {}): Promise<TracePage> {
      const limit = resolvePageLimit(cursor.limit, DEFAULT_TRACE_PAGE_SIZE);

      let query = client.from("trace_events").select("*").eq("run_id", runId);

      if (cursor.after !== undefined) {
        query = query.gt("sequence", cursor.after);
      }

      const { data, error } = await query.order("sequence", { ascending: true }).limit(limit + 1);

      if (error !== null) {
        throw failed("getTrace", error, { table: "trace_events", runId });
      }

      const rows = data.slice(0, limit);
      const hasMore = data.length > limit;

      return {
        events: rows.map(readTraceEvent),
        nextCursor: hasMore ? (rows.at(-1)?.sequence ?? null) : null,
      };
    },

    // The workflow registry (M5-T1). ADR-0043 records the model; the columns
    // are `supabase/migrations/20260920202604_workflow_registry_columns.sql`.

    async saveWorkflow(record: WorkflowRecord): Promise<WorkflowRecord> {
      // The domain first, exactly as `saveJob` does it: `workflow_definitions`
      // has a foreign key to `domains`, and a workflow may be registered for a
      // domain that has not run anything yet.
      await saveDomain(record.domainId, record.domainVersion, "saveWorkflow");

      const { error } = await client.from("workflow_definitions").upsert(
        {
          id: record.id,
          domain_id: record.domainId,
          domain_version: record.domainVersion,
          workflow_key: record.workflowKey,
          job_type: record.jobType,
          created_at: record.createdAt,
        },
        // `ignoreDuplicates` rather than a merge, because re-registering a
        // workflow is the normal case and the row carries nothing a later
        // registration could correct. Merging would rewrite the row -- and its
        // `id` -- on every new version, and the id is what versions hang off.
        { onConflict: "domain_id,workflow_key", ignoreDuplicates: true },
      );

      if (error !== null) {
        throw failed("saveWorkflow", error, {
          table: "workflow_definitions",
          domainId: record.domainId,
          workflowKey: record.workflowKey,
        });
      }

      // Read back by the natural key rather than by `record.id`: when the key
      // was already taken the surviving row carries the *original* id, and that
      // is the id the caller must use.
      const { data, error: readError } = await client
        .from("workflow_definitions")
        .select("*")
        .eq("domain_id", record.domainId)
        .eq("workflow_key", record.workflowKey)
        .maybeSingle();

      if (readError !== null) {
        throw failed("saveWorkflow", readError, {
          table: "workflow_definitions",
          domainId: record.domainId,
          workflowKey: record.workflowKey,
        });
      }

      if (data === null) {
        throw new StorageError(
          `supabase storage: \`saveWorkflow\` wrote no row for \`${record.domainId}/${record.workflowKey}\``,
          {
            details: {
              operation: "saveWorkflow",
              domainId: record.domainId,
              workflowKey: record.workflowKey,
            },
          },
        );
      }

      return readWorkflowRecord(data);
    },

    async saveWorkflowVersion(record: WorkflowVersionRecord): Promise<WorkflowVersionRecord> {
      // A plain insert, not an upsert. `(workflow_id, fingerprint)` is unique,
      // and registering byte-identical IR twice must fail loudly: the
      // fingerprint is the version's identity, and two rows for one behavior
      // would make the promotion ledger ambiguous about which one a run used.
      const { data, error } = await client
        .from("workflow_versions")
        .insert({
          id: record.id,
          workflow_id: record.workflowId,
          domain_id: record.compatibility.domainId,
          job_type: record.compatibility.jobType,
          fingerprint: record.fingerprint,
          status: record.status,
          definition: asJson(record.definition as unknown as JsonValue),
          compatibility: asJson(record.compatibility as unknown as JsonValue),
          metadata: asJson(record.metadata),
          created_at: record.createdAt,
          status_changed_at: record.statusChangedAt,
        })
        .select("*")
        .single();

      if (error !== null) {
        throw failed("saveWorkflowVersion", error, {
          table: "workflow_versions",
          versionId: record.id,
          workflowId: record.workflowId,
          fingerprint: record.fingerprint,
        });
      }

      return readWorkflowVersionRecord(data);
    },

    async getWorkflowVersion(id: WorkflowVersionId): Promise<WorkflowVersionRecord | null> {
      const { data, error } = await client
        .from("workflow_versions")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (error !== null) {
        throw failed("getWorkflowVersion", error, { table: "workflow_versions", versionId: id });
      }

      return data === null ? null : readWorkflowVersionRecord(data);
    },

    async listWorkflowVersions(
      filter: WorkflowVersionFilter = {},
      cursor: WorkflowVersionListCursor = {},
    ): Promise<WorkflowVersionPage> {
      const limit = resolvePageLimit(cursor.limit, DEFAULT_WORKFLOW_VERSION_PAGE_SIZE);

      let query = client.from("workflow_versions").select("*");

      if (filter.domainId !== undefined) {
        query = query.eq("domain_id", filter.domainId);
      }
      if (filter.jobType !== undefined) {
        query = query.eq("job_type", filter.jobType);
      }
      if (filter.status !== undefined) {
        query = query.eq("status", filter.status);
      }
      if (filter.workflowId !== undefined) {
        query = query.eq("workflow_id", filter.workflowId);
      }
      if (cursor.after !== undefined) {
        query = query.lt("id", cursor.after);
      }

      const { data, error } = await query.order("id", { ascending: false }).limit(limit + 1);

      if (error !== null) {
        throw failed("listWorkflowVersions", error, { table: "workflow_versions" });
      }

      const rows = data.slice(0, limit);
      const hasMore = data.length > limit;

      return {
        versions: rows.map(readWorkflowVersionRecord),
        nextCursor: hasMore ? (parseEntityId("workflow-version", rows.at(-1)?.id) ?? null) : null,
      };
    },

    async setWorkflowVersionStatus(
      input: SetWorkflowVersionStatusInput,
    ): Promise<WorkflowVersionRecord> {
      if (!canTransition(input.from, input.to)) {
        throw new ValidationError(
          `supabase storage: \`${input.from}\` cannot transition to \`${input.to}\``,
          {
            issues: [
              { path: ["to"], message: `\`${input.from}\` cannot transition to \`${input.to}\`` },
            ],
          },
        );
      }

      // The compare-and-set, in one statement: the `eq("status", input.from)`
      // is what makes two processes promoting the same version unable to both
      // succeed, without a transaction and without a read-then-write race.
      const { data, error } = await client
        .from("workflow_versions")
        .update({ status: input.to, status_changed_at: input.changedAt })
        .eq("id", input.versionId)
        .eq("status", input.from)
        .select("*")
        .maybeSingle();

      if (error !== null) {
        throw failed("setWorkflowVersionStatus", error, {
          table: "workflow_versions",
          versionId: input.versionId,
        });
      }

      if (data === null) {
        // Matching nothing is not a database failure, so PostgREST reports
        // success with no row. Read the version back to say *which* of the two
        // causes it was, because "no such version" and "somebody else moved it
        // first" need different responses from a caller.
        const { data: current, error: readError } = await client
          .from("workflow_versions")
          .select("status")
          .eq("id", input.versionId)
          .maybeSingle();

        if (readError !== null) {
          throw failed("setWorkflowVersionStatus", readError, {
            table: "workflow_versions",
            versionId: input.versionId,
          });
        }

        throw new StorageError(
          current === null
            ? `supabase storage: \`setWorkflowVersionStatus\` found no workflow version \`${input.versionId}\``
            : `supabase storage: workflow version \`${input.versionId}\` is \`${current.status}\`, not \`${input.from}\``,
          {
            details: {
              operation: "setWorkflowVersionStatus",
              versionId: input.versionId,
              expected: input.from,
              actual: current?.status ?? null,
            },
          },
        );
      }

      // The ledger row is appended **after** the status moved, so a row exists
      // only for a transition that actually happened. PostgREST gives no
      // transaction across the two statements, so the failure mode is a status
      // change whose ledger row is missing; it raises here rather than being
      // swallowed, and it is visible afterwards as a version whose status does
      // not match its last promotion.
      const { error: ledgerError } = await client.from("workflow_promotions").insert({
        id: input.promotionId,
        workflow_version_id: input.versionId,
        from_status: input.from,
        to_status: input.to,
        actor: input.actor,
        reason: input.reason,
        created_at: input.changedAt,
      });

      if (ledgerError !== null) {
        throw failed("setWorkflowVersionStatus", ledgerError, {
          table: "workflow_promotions",
          versionId: input.versionId,
          promotionId: input.promotionId,
        });
      }

      return readWorkflowVersionRecord(data);
    },

    async listWorkflowPromotions(
      versionId: WorkflowVersionId,
    ): Promise<readonly WorkflowPromotionRecord[]> {
      // Ascending, unlike every other list here: this is the narrative of how a
      // version reached its current status, and a narrative read backwards is
      // not one.
      const { data, error } = await client
        .from("workflow_promotions")
        .select("*")
        .eq("workflow_version_id", versionId)
        .order("id", { ascending: true });

      if (error !== null) {
        throw failed("listWorkflowPromotions", error, {
          table: "workflow_promotions",
          versionId,
        });
      }

      return data.map(readWorkflowPromotionRecord);
    },

    // Decision evidence (M3-T3).

    async saveDecision(record: DecisionRecord): Promise<DecisionRecord> {
      const parsed = parseDecisionRecord(record);
      // A plain insert, not an upsert: a `DecisionId` is minted by the engine
      // when it answers, so the same id twice is either a retry that should not
      // have re-recorded or a collision, and both are facts the caller has to
      // see. Overwriting would destroy the evidence a replay depends on.
      //
      // The six denormalized columns are written from the parsed record rather
      // than from the raw argument, so a row cannot carry a `model_id` the
      // document does not.
      const { data, error } = await client
        .from("decisions")
        .insert({
          id: parsed.id,
          run_id: parsed.runId,
          node_id: parsed.nodeId,
          state_fingerprint: parsed.result.stateFingerprint,
          question_ids: questionRefsOf(parsed),
          result: asJson(parsed.result as unknown as JsonValue),
          policy: parsed.policy === null ? null : asJson(parsed.policy as unknown as JsonValue),
          model_provider: parsed.result.model.provider,
          model_id: parsed.result.model.modelId,
          cost_usd: parsed.result.usage.costUsd,
          latency_ms: parsed.result.latencyMs,
          created_at: parsed.createdAt,
        })
        .select("*")
        .single();

      if (error !== null) {
        throw failed("saveDecision", error, {
          table: "decisions",
          decisionId: parsed.id,
          runId: parsed.runId,
        });
      }

      return readDecisionRecord(data);
    },

    async listDecisions(runId: RunId): Promise<readonly DecisionRecord[]> {
      // Ascending, like the promotion ledger: these are one run's judgments in
      // the order they were made, and a `DecisionId` is a sortable UUIDv7, so
      // `id` order is that order.
      const { data, error } = await client
        .from("decisions")
        .select("*")
        .eq("run_id", runId)
        .order("id", { ascending: true });

      if (error !== null) {
        throw failed("listDecisions", error, { table: "decisions", runId });
      }

      return data.map(readDecisionRecord);
    },
  };
}

/**
 * Require a non-empty option, or throw naming it.
 *
 * An empty `url` produces a transport error mentioning neither the option nor
 * the adapter, and an empty key produces a 401 on the first query rather than
 * at construction. Both are much harder to read than this.
 */
function requireOption(value: string | undefined, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ValidationError(`createSupabaseStorage: \`${name}\` must be a non-empty string`, {
      issues: [{ path: [name], message: "expected a non-empty string" }],
    });
  }

  return value;
}
