import {
  canTransition,
  DEFAULT_RUN_PAGE_SIZE,
  DEFAULT_TRACE_PAGE_SIZE,
  DEFAULT_WORKFLOW_VERSION_PAGE_SIZE,
  type Job,
  type JobId,
  parseJob,
  parseRunRecord,
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

/**
 * An in-memory {@link Storage} (M2-T5), for tests and for a caller that wants a
 * run's record without a database.
 *
 * It is a **real implementation of the port, not a stub**. It runs the same
 * `storage.contract.test.ts` suite as `createSupabaseStorage()`, which is the
 * build plan's rule for an adapter contract (section 8: every implementation
 * runs the same suite), and that is what makes it a legitimate substitute in a
 * unit test rather than a second set of semantics everyone has to remember.
 *
 * Two things it deliberately does **not** do.
 *
 * - **It does not redact.** Redaction happens on the way to persistence, in the
 *   writer chain and in the Supabase adapter (ADR-0035). A test double that
 *   redacted would hide from a test exactly the values the test is checking
 *   are absent.
 * - **It does not fail.** There is no injected-failure switch, because a test
 *   that needs one wants a bespoke object with one throwing method, not a
 *   general implementation carrying a fault-injection surface into every other
 *   test. `packages/core/src/harness.test.ts` writes that object inline.
 */
export interface InMemoryStorage extends Storage {
  /** Every job saved, newest last, for assertions. */
  readonly jobs: readonly Job<unknown, unknown>[];
  /** Every run row, in start order, for assertions. */
  readonly runs: readonly RunRecord[];
  /** Every trace event appended, in append order, for assertions. */
  readonly events: readonly TraceEvent[];
  /** Every registered workflow, in registration order, for assertions. */
  readonly workflows: readonly WorkflowRecord[];
  /** Every workflow version, oldest first, for assertions. */
  readonly workflowVersions: readonly WorkflowVersionRecord[];
  /** Every promotion ledger row, oldest first, for assertions. */
  readonly workflowPromotions: readonly WorkflowPromotionRecord[];
}

/** Compare two sortable entity ids. */
function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function matchesFilter(run: RunRecord, filter: RunFilter): boolean {
  return (
    (filter.domainId === undefined || run.domain.id === filter.domainId) &&
    (filter.domainVersion === undefined || run.domain.version === filter.domainVersion) &&
    (filter.jobType === undefined || run.jobType === filter.jobType) &&
    (filter.status === undefined || run.status === filter.status) &&
    (filter.jobId === undefined || run.jobId === filter.jobId)
  );
}

/**
 * Create an {@link InMemoryStorage}.
 *
 * ```ts
 * const storage = createInMemoryStorage();
 * const harness = createHarness({ agentRuntime, storage });
 *
 * await harness.run({ domain, input });
 *
 * expect(storage.runs[0]?.status).toBe("completed");
 * ```
 *
 * Every value it hands back has been through the same `parseJob()` /
 * `parseRunRecord()` boundary a database row goes through, so a test that
 * passes against this implementation is testing the same contract a Supabase
 * row has to satisfy, rather than testing that objects survive being put in a
 * `Map`.
 */
export function createInMemoryStorage(): InMemoryStorage {
  const jobs = new Map<JobId, Job<unknown, unknown>>();
  const runs = new Map<RunId, RunRecord>();
  // Keyed `${runId}\u0000${sequence}`, which is the uniqueness rule the
  // database enforces with a constraint. A plain array would let a retried
  // batch duplicate a run's narrative, and then this implementation and the
  // Supabase one would disagree about the one property the contract suite
  // exists to pin down.
  const events = new Map<string, TraceEvent>();
  const appendOrder: TraceEvent[] = [];
  // The workflow registry (M5-T1). `workflowKeys` is the `(domainId,
  // workflowKey)` unique constraint, `versionFingerprints` is the
  // `(workflowId, fingerprint)` one, and `promotions` is the append-only
  // ledger; all three are the constraints the database enforces, held here so
  // that the two implementations of the port fail in the same places.
  const workflows = new Map<string, WorkflowRecord>();
  const workflowKeys = new Map<string, string>();
  const versions = new Map<WorkflowVersionId, WorkflowVersionRecord>();
  const versionFingerprints = new Set<string>();
  const promotions: WorkflowPromotionRecord[] = [];

  function eventKey(event: TraceEvent): string {
    return `${event.runId}\u0000${event.sequence}`;
  }

  function requireRun(runId: RunId, operation: string): RunRecord {
    const run = runs.get(runId);

    if (run === undefined) {
      throw new StorageError(`storage: \`${operation}\` found no run \`${runId}\``, {
        details: { operation, runId },
      });
    }

    return run;
  }

  return {
    get jobs(): readonly Job<unknown, unknown>[] {
      return [...jobs.values()];
    },
    get runs(): readonly RunRecord[] {
      return [...runs.values()].sort((left, right) => compareIds(left.runId, right.runId));
    },
    get events(): readonly TraceEvent[] {
      return [...appendOrder];
    },
    get workflows(): readonly WorkflowRecord[] {
      return [...workflows.values()].sort((left, right) => compareIds(left.id, right.id));
    },
    get workflowVersions(): readonly WorkflowVersionRecord[] {
      return [...versions.values()].sort((left, right) => compareIds(left.id, right.id));
    },
    get workflowPromotions(): readonly WorkflowPromotionRecord[] {
      return [...promotions];
    },

    // Every method is `async`, even where nothing is awaited. The port says
    // each one *rejects* on failure, and `parseJob()` / `parseRunRecord()`
    // throw synchronously; `async` is what turns those throws into the
    // rejections the contract promises, so a caller using `.catch()` rather
    // than `await` sees the same thing the Supabase implementation gives it.
    async saveJob(job: Job): Promise<void> {
      // Through `parseJob()` rather than stored as handed over, so that a value
      // this implementation accepts is one the Supabase adapter would also
      // accept. An in-memory store that swallowed a malformed job would let a
      // unit test pass and the integration fail.
      jobs.set(job.id, parseJob(job));
    },

    async startRun(input: RunStart): Promise<RunRecord> {
      const duplicate = [...runs.values()].find(
        (run) => run.jobId === input.jobId && run.attempt === input.attempt,
      );

      if (duplicate !== undefined) {
        throw new StorageError(
          `storage: run attempt ${input.attempt} of job \`${input.jobId}\` already exists`,
          { details: { operation: "startRun", jobId: input.jobId, attempt: input.attempt } },
        );
      }

      const record = parseRunRecord({
        runId: input.runId,
        jobId: input.jobId,
        attempt: input.attempt,
        domain: { id: input.domain.id, version: input.domain.version },
        jobType: input.jobType,
        status: "running",
        success: null,
        qualityScore: null,
        costUsd: null,
        latencyMs: null,
        modelCalls: 0,
        toolCalls: 0,
        jevCalls: 0,
        fallbackCount: 0,
        humanReview: null,
        workflowVersionId: input.workflowVersionId,
        agentVersion: input.agentVersion,
        behaviorFingerprint: input.behaviorFingerprint,
        runtime: {
          name: input.runtime.name,
          version: input.runtime.version,
          metadata: input.runtime.metadata,
        },
        target: input.target,
        startedAt: input.startedAt,
        finishedAt: null,
        error: null,
      });

      runs.set(record.runId, record);

      return record;
    },

    async finishRun(input: RunFinish): Promise<RunRecord> {
      const existing = requireRun(input.runId, "finishRun");
      const record = parseRunRecord({
        ...existing,
        status: input.status,
        success: input.success,
        costUsd: input.costUsd,
        latencyMs: input.latencyMs,
        modelCalls: input.modelCalls,
        toolCalls: input.toolCalls,
        jevCalls: input.jevCalls,
        fallbackCount: input.fallbackCount,
        runtime: {
          name: input.runtime.name,
          version: input.runtime.version,
          metadata: input.runtime.metadata,
        },
        finishedAt: input.finishedAt,
        error: input.error,
      });

      runs.set(record.runId, record);

      return record;
    },

    async getRun(runId: RunId): Promise<RunRecord | null> {
      return runs.get(runId) ?? null;
    },

    async getJob(jobId: JobId): Promise<Job<unknown, unknown> | null> {
      return jobs.get(jobId) ?? null;
    },

    async listRuns(filter: RunFilter = {}, cursor: RunListCursor = {}): Promise<RunPage> {
      const limit = resolvePageLimit(cursor.limit, DEFAULT_RUN_PAGE_SIZE);
      const matching = [...runs.values()]
        .filter((run) => matchesFilter(run, filter))
        // Newest first, which is what a keyset cursor over a sortable id makes
        // cheap and what an inspector asks for.
        .sort((left, right) => compareIds(right.runId, left.runId))
        .filter((run) => cursor.after === undefined || compareIds(run.runId, cursor.after) < 0);

      const page = matching.slice(0, limit);
      const last = page.at(-1);

      return {
        runs: page,
        // A full page is not proof there is another one, but claiming there
        // might be costs one empty request and claiming there is not can lose
        // rows. The Supabase implementation answers this the same way.
        nextCursor: page.length === limit && matching.length > limit ? (last?.runId ?? null) : null,
      };
    },

    async appendTraceEvents(batch: readonly TraceEvent[]): Promise<void> {
      for (const event of batch) {
        const key = eventKey(event);

        // Idempotent on `(runId, sequence)`, and the **first** write of a
        // position wins. A trace is append-only, so a later write of the same
        // position is a retry of the same event, not a correction of it.
        if (events.has(key)) {
          continue;
        }

        events.set(key, event);
        appendOrder.push(event);
      }
    },

    async getTrace(runId: RunId, cursor: TraceCursor = {}): Promise<TracePage> {
      const limit = resolvePageLimit(cursor.limit, DEFAULT_TRACE_PAGE_SIZE);
      const matching = [...events.values()]
        .filter(
          (event) =>
            event.runId === runId && (cursor.after === undefined || event.sequence > cursor.after),
        )
        .sort((left, right) => left.sequence - right.sequence);

      const page = matching.slice(0, limit);
      const last = page.at(-1);

      return {
        events: page,
        nextCursor:
          page.length === limit && matching.length > limit ? (last?.sequence ?? null) : null,
      };
    },

    // The workflow registry (M5-T1). The three uniqueness rules the database
    // enforces are enforced here too, because the contract suite runs against
    // both and a test that passes here must mean the same thing there.

    async saveWorkflow(record: WorkflowRecord): Promise<WorkflowRecord> {
      const parsed = parseWorkflowRecord(record);
      const key = `${parsed.domainId}\u0000${parsed.workflowKey}`;
      const existingId = workflowKeys.get(key);

      // `(domainId, workflowKey)` is unique, and re-registering a workflow is
      // the normal case: every new version of `vendor-triage` does it. The
      // *original* id is returned, because that is the id versions hang off.
      if (existingId !== undefined) {
        const existing = workflows.get(existingId);

        if (existing !== undefined) {
          return existing;
        }
      }

      workflows.set(parsed.id, parsed);
      workflowKeys.set(key, parsed.id);

      return parsed;
    },

    async saveWorkflowVersion(record: WorkflowVersionRecord): Promise<WorkflowVersionRecord> {
      const parsed = parseWorkflowVersionRecord(record);
      const key = `${parsed.workflowId}\u0000${parsed.fingerprint}`;

      if (versionFingerprints.has(key)) {
        throw new StorageError(
          `storage: workflow \`${parsed.workflowId}\` already has a version with fingerprint \`${parsed.fingerprint}\``,
          {
            details: {
              operation: "saveWorkflowVersion",
              workflowId: parsed.workflowId,
              fingerprint: parsed.fingerprint,
            },
          },
        );
      }

      if (versions.has(parsed.id)) {
        throw new StorageError(`storage: workflow version \`${parsed.id}\` already exists`, {
          details: { operation: "saveWorkflowVersion", versionId: parsed.id },
        });
      }

      versions.set(parsed.id, parsed);
      versionFingerprints.add(key);

      return parsed;
    },

    async getWorkflowVersion(id: WorkflowVersionId): Promise<WorkflowVersionRecord | null> {
      return versions.get(id) ?? null;
    },

    async listWorkflowVersions(
      filter: WorkflowVersionFilter = {},
      cursor: WorkflowVersionListCursor = {},
    ): Promise<WorkflowVersionPage> {
      const limit = resolvePageLimit(cursor.limit, DEFAULT_WORKFLOW_VERSION_PAGE_SIZE);
      const matching = [...versions.values()]
        .filter(
          (version) =>
            (filter.domainId === undefined || version.compatibility.domainId === filter.domainId) &&
            (filter.jobType === undefined || version.compatibility.jobType === filter.jobType) &&
            (filter.status === undefined || version.status === filter.status) &&
            (filter.workflowId === undefined || version.workflowId === filter.workflowId),
        )
        .sort((left, right) => compareIds(right.id, left.id))
        .filter(
          (version) => cursor.after === undefined || compareIds(version.id, cursor.after) < 0,
        );

      const page = matching.slice(0, limit);
      const last = page.at(-1);

      return {
        versions: page,
        nextCursor: page.length === limit && matching.length > limit ? (last?.id ?? null) : null,
      };
    },

    async setWorkflowVersionStatus(
      input: SetWorkflowVersionStatusInput,
    ): Promise<WorkflowVersionRecord> {
      if (!canTransition(input.from, input.to)) {
        throw new ValidationError(
          `storage: \`${input.from}\` cannot transition to \`${input.to}\``,
          {
            issues: [
              { path: ["to"], message: `\`${input.from}\` cannot transition to \`${input.to}\`` },
            ],
          },
        );
      }

      const existing = versions.get(input.versionId);

      if (existing === undefined) {
        throw new StorageError(
          `storage: \`setWorkflowVersionStatus\` found no workflow version \`${input.versionId}\``,
          { details: { operation: "setWorkflowVersionStatus", versionId: input.versionId } },
        );
      }

      // The compare-and-set. A promotion decided against a status that has
      // since changed must fail rather than overwrite whatever happened in
      // between; the Supabase implementation gets this from a conditional
      // update, and this one gets it from the same check written out.
      if (existing.status !== input.from) {
        throw new StorageError(
          `storage: workflow version \`${input.versionId}\` is \`${existing.status}\`, not \`${input.from}\``,
          {
            details: {
              operation: "setWorkflowVersionStatus",
              versionId: input.versionId,
              expected: input.from,
              actual: existing.status,
            },
          },
        );
      }

      const updated = parseWorkflowVersionRecord({
        ...existing,
        status: input.to,
        statusChangedAt: input.changedAt,
      });

      versions.set(updated.id, updated);
      promotions.push(
        parseWorkflowPromotionRecord({
          id: input.promotionId,
          workflowVersionId: input.versionId,
          fromStatus: input.from,
          toStatus: input.to,
          actor: input.actor,
          reason: input.reason,
          createdAt: input.changedAt,
        }),
      );

      return updated;
    },

    async listWorkflowPromotions(
      versionId: WorkflowVersionId,
    ): Promise<readonly WorkflowPromotionRecord[]> {
      return promotions
        .filter((promotion) => promotion.workflowVersionId === versionId)
        .sort((left, right) => compareIds(left.id, right.id));
    },
  };
}
