import type { RunRecord, Storage, WorkflowVersionId, WorkflowVersionRecord } from "@internal/core";
import type { PromoteWorkflowOptions, WorkflowRegistry } from "./workflow-registry.js";

/**
 * The circuit breaker (M5-T7, ADR-0044).
 *
 * "If an active workflow exceeds configured failure/fallback thresholds over a
 * rolling local evaluation window, disable routing to it." The build plan adds
 * that the initial version "can require manual invocation", and this one does:
 * {@link CircuitBreaker.evaluate} reads and reports, {@link CircuitBreaker.trip}
 * acts, and nothing calls `trip` on a timer.
 *
 * That separation is AD-005 rather than caution. Tripping a breaker retires a
 * version, retiring is a status change, and every status change in this harness
 * takes an `actor`. A breaker that retired versions by itself would be the
 * harness promoting and demoting its own workflows, which is exactly what the
 * status model was built to prevent.
 *
 * **Disabling routing needs no cache invalidation.** The router re-resolves the
 * active version on every run, so a retired version stops receiving traffic on
 * the next job — which is also Milestone 5's "retiring an active workflow
 * immediately returns traffic to the full agent", proved by the same mechanism
 * rather than by a second one.
 *
 * The window is **local evidence**: the last N runs of one version, read
 * through the `Storage` port's `listRuns` with a `workflowVersionId` filter. It
 * is not a time window, because a workflow that runs twice a day and a workflow
 * that runs twice a minute need the same number of observations before anyone
 * should conclude anything about either.
 */

/** What {@link CircuitBreaker.evaluate} measured. */
export interface CircuitBreakerReading {
  /** Whether either threshold was met or exceeded over the window. */
  readonly tripped: boolean;
  /** Finished runs that fell back, over finished runs in the window. */
  readonly fallbackRate: number;
  /** Finished runs that failed, over finished runs in the window. */
  readonly failureRate: number;
  /**
   * How many finished runs the rates were computed over.
   *
   * `0` means there is no evidence, and no evidence never trips: an untried
   * workflow is not a failing one, and `0/0` is not `1`.
   */
  readonly sample: number;
}

/** The rolling window {@link createCircuitBreaker} evaluates over. */
export interface CircuitBreakerWindow {
  /**
   * How many of the version's most recent runs to consider.
   *
   * Runs, not minutes. See the note on the module above.
   */
  readonly runs: number;
}

/** The rates at which {@link CircuitBreakerReading.tripped} becomes true. */
export interface CircuitBreakerThresholds {
  /** Trip at or above this fraction of finished runs that fell back. */
  readonly fallbackRate: number;
  /** Trip at or above this fraction of finished runs that failed. */
  readonly failureRate: number;
}

/** What {@link createCircuitBreaker} accepts. */
export interface CreateCircuitBreakerOptions {
  /** Where the run ledger is read from. */
  readonly storage: Storage;
  /** The registry a trip retires a version through. */
  readonly registry: WorkflowRegistry;
  /** The rolling window. */
  readonly window: CircuitBreakerWindow;
  /** The thresholds. */
  readonly thresholds: CircuitBreakerThresholds;
}

/** The breaker. */
export interface CircuitBreaker {
  /**
   * Measure one version's recent runs. **Reads only**; it changes nothing.
   *
   * A `running` or `aborted` run is not counted: a run still in flight has no
   * outcome yet, and a run its caller cancelled is evidence about the caller.
   * Counting either would let a busy afternoon or a cancelled batch trip a
   * workflow that never misbehaved.
   */
  evaluate(versionId: WorkflowVersionId): Promise<CircuitBreakerReading>;
  /**
   * Retire `versionId`, so the router stops choosing it.
   *
   * Deliberately **not** conditional on {@link CircuitBreaker.evaluate}: an
   * operator who has read the reading and decided may trip it, and an operator
   * who has other evidence may trip it too. The decision is theirs, and the
   * `actor` records whose it was.
   *
   * @throws {ValidationError} if the version does not exist, or is not in a
   * status from which `retired` is reachable.
   * @throws {StorageError} if the version moved between the read and the write.
   */
  trip(
    versionId: WorkflowVersionId,
    options: PromoteWorkflowOptions,
  ): Promise<WorkflowVersionRecord>;
}

/** Whether a run is finished and therefore evidence. */
function isFinished(run: RunRecord): boolean {
  return run.status === "completed" || run.status === "failed";
}

/**
 * Create a {@link CircuitBreaker}.
 *
 * ```ts
 * const breaker = createCircuitBreaker({
 *   storage,
 *   registry,
 *   window: { runs: 20 },
 *   thresholds: { fallbackRate: 0.5, failureRate: 0.2 },
 * });
 *
 * const reading = await breaker.evaluate(versionId);
 *
 * if (reading.tripped) {
 *   await breaker.trip(versionId, { actor: "david", reason: "fallback rate over 50%" });
 * }
 * ```
 */
export function createCircuitBreaker(options: CreateCircuitBreakerOptions): CircuitBreaker {
  const { storage, registry, window, thresholds } = options;

  return {
    async evaluate(versionId: WorkflowVersionId): Promise<CircuitBreakerReading> {
      // One page, newest first, of exactly the window size. `listRuns` already
      // orders by run id descending and a run id is sortable, so "the last N
      // runs of this version" is one indexed range rather than a scan plus a
      // filter (M5-T7's `RunFilter.workflowVersionId`).
      const page = await storage.listRuns({ workflowVersionId: versionId }, { limit: window.runs });
      const finished = page.runs.filter(isFinished);
      const sample = finished.length;

      if (sample === 0) {
        return { tripped: false, fallbackRate: 0, failureRate: 0, sample: 0 };
      }

      const fallbackRate = finished.filter((run) => run.fallbackCount > 0).length / sample;
      const failureRate = finished.filter((run) => run.status === "failed").length / sample;

      return {
        // At or above, not strictly above: a threshold of `0.5` is the point at
        // which an operator said they wanted to know, and `exactly 0.5` is that
        // point.
        tripped: fallbackRate >= thresholds.fallbackRate || failureRate >= thresholds.failureRate,
        fallbackRate,
        failureRate,
        sample,
      };
    },

    async trip(
      versionId: WorkflowVersionId,
      promoteOptions: PromoteWorkflowOptions,
    ): Promise<WorkflowVersionRecord> {
      return await registry.retire(versionId, promoteOptions);
    },
  };
}
