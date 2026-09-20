import {
  type Clock,
  type DomainRef,
  describeWorkflowCompatibility,
  HARNESS_RUNTIME_INFO,
  type Job,
  type JsonObject,
  newPromotionId,
  newWorkflowId,
  newWorkflowVersionId,
  type Storage,
  selectCompatibleWorkflow,
  ValidationError,
  type WorkflowRecord,
  type WorkflowSelection,
  type WorkflowSelectionEnvironment,
  type WorkflowStatus,
  type WorkflowVersionRecord,
} from "@internal/core";
import type { CompiledWorkflow } from "@internal/workflow";

/**
 * The workflow registry service (M5-T1, M5-T2).
 *
 * `@internal/core` declares the model — the seven statuses, the transition
 * table, what a version declares about the jobs it can handle, and the pure
 * selector — and this package is the part that needs a `Storage` and a
 * `CompiledWorkflow` to do anything. It is the same split `@internal/trace` and
 * `@internal/workflow` already make: core states the contract, a package beside
 * it does the work.
 *
 * It is **not an adapter**. It touches no database and no model provider; it
 * takes the `Storage` port and a compiled workflow and nothing else, which is
 * why it carries core's dependency bans in `tests/architecture/boundaries.ts`.
 * "No domain package may mutate harness registry tables directly" (build plan
 * section 4) is exactly what this package exists to make unnecessary: a domain
 * registers a workflow through this, not through SQL.
 *
 * What it deliberately does **not** do:
 *
 * - **It does not promote anything by itself.** AD-005 puts a human in front of
 *   every promotion, so every method that moves a status takes an `actor` and
 *   is called by something, never by a timer or a threshold.
 * - **It does not route.** {@link WorkflowRegistry.resolve} answers "which
 *   version could serve this job?"; deciding what to do with that answer, and
 *   what to record about it, is the router's (M5-T3).
 * - **It does not compile or validate.** It takes a `CompiledWorkflow`, which
 *   already carries the guarantee that the graph is valid and every capability
 *   resolved.
 */

/** What {@link createWorkflowRegistry} accepts. */
export interface CreateWorkflowRegistryOptions {
  /** Where versions and promotions are persisted. */
  readonly storage: Storage;
  /**
   * The time source. Defaults to the system clock.
   *
   * Injected rather than read, because `createdAt` and `statusChangedAt` are
   * asserted on by tests and compared by humans reading a promotion ledger.
   */
  readonly clock?: Clock;
}

/** What {@link WorkflowRegistry.register} needs beyond the compiled workflow. */
export interface RegisterWorkflowOptions {
  /**
   * The domain and version the workflow is registered under.
   *
   * The IR carries only a domain **id** (ADR-0038: a workflow that pinned a
   * domain version would stop matching whenever the domain's version moved for
   * an unrelated reason). The registry row records the version the workflow was
   * registered under, which is provenance rather than a matching rule, so it is
   * supplied here. `domain.id` MUST equal the IR's `domain`.
   */
  readonly domain: DomainRef;
  /** Who registered it. Recorded in the version's metadata. */
  readonly actor: string;
  /**
   * The SOP identifier the workflow was authored against.
   *
   * Required, and not defaulted: the IR does not carry one, a workflow is
   * authored *against* a procedure, and a registry that guessed would produce a
   * compatibility declaration nobody checked.
   */
  readonly sop: string;
  /** The `sha256:` digest of that SOP's content, when the author knows it. */
  readonly sopFingerprint?: string;
  /** The oldest harness version that can run it. Defaults to the running one. */
  readonly minHarnessVersion?: string;
  /** Extra registry-owned detail: which compiler run produced it, and so on. */
  readonly metadata?: JsonObject;
}

/** What every status change needs. */
export interface PromoteWorkflowOptions {
  /** Who is moving it. AD-005: promotion is human-invoked. */
  readonly actor: string;
  /** Why, in their words. Defaults to `null`. */
  readonly reason?: string | null;
}

/** Which versions {@link WorkflowRegistry.findActive} returns. */
export interface FindActiveOptions {
  /** The domain to look in. */
  readonly domainId: string;
  /** The job type to look for. */
  readonly jobType: string;
}

/** The registry service. */
export interface WorkflowRegistry {
  /**
   * Register a compiled workflow as a new `draft` version.
   *
   * It upserts the `workflow_definitions` row for `(domain.id, IR id)` — so the
   * second version of a workflow joins the first rather than creating a second
   * workflow — derives the version's compatibility from the IR, and inserts the
   * version. **Nothing is promoted**: a freshly registered workflow is a draft,
   * because AD-005 puts a human between compilation and traffic.
   *
   * @throws {ValidationError} if `domain.id` disagrees with the IR's domain.
   * @throws {StorageError} if a version with this IR's fingerprint already
   * exists for this workflow.
   */
  register(
    compiled: CompiledWorkflow,
    options: RegisterWorkflowOptions,
  ): Promise<WorkflowVersionRecord>;
  /**
   * Move a version to `to`, recording who and why.
   *
   * The current status is read and passed as the transition's `from`, so the
   * caller does not have to know it; the store still applies the change as a
   * compare-and-set against that value, so a version that moved in between
   * fails rather than being overwritten.
   *
   * @throws {ValidationError} if the transition is not in the table.
   * @throws {StorageError} if the version does not exist, or moved first.
   */
  promote(
    versionId: WorkflowVersionRecord["id"],
    to: WorkflowStatus,
    options: PromoteWorkflowOptions,
  ): Promise<WorkflowVersionRecord>;
  /**
   * Retire a version.
   *
   * Exactly {@link WorkflowRegistry.promote} to `retired`, named separately
   * because it is the operation Milestone 5's acceptance criteria name:
   * "retiring an active workflow immediately returns traffic to the full
   * agent". It does, and there is no cache in between for it not to.
   */
  retire(
    versionId: WorkflowVersionRecord["id"],
    options: PromoteWorkflowOptions,
  ): Promise<WorkflowVersionRecord>;
  /**
   * Every `active` version for a domain and job type, newest first.
   *
   * Pages the store to exhaustion, because the selector's tie-break is defined
   * over *all* the candidates and a first page is not all of them.
   */
  findActive(options: FindActiveOptions): Promise<readonly WorkflowVersionRecord[]>;
  /**
   * Answer "which compiled version can serve this job?", or explain why none
   * can.
   *
   * The registry's one impure step is the lookup; the decision itself is
   * `selectCompatibleWorkflow()`, unchanged and pure, so the answer is
   * reproducible from the candidates alone.
   */
  resolve(job: Job, env: WorkflowSelectionEnvironment): Promise<WorkflowSelection>;
}

/** The system clock. The default when no clock is supplied. */
const SYSTEM_CLOCK: Clock = {
  now(): Date {
    return new Date();
  },
};

/**
 * Create a {@link WorkflowRegistry} over a `Storage`.
 *
 * ```ts
 * const registry = createWorkflowRegistry({ storage: createInMemoryStorage() });
 *
 * const version = await registry.register(compiled, {
 *   domain: { id: "vendor-triage", version: "1.0.0" },
 *   actor: "david",
 *   sop: "vendor-triage-sop",
 * });
 *
 * await registry.promote(version.id, "candidate", { actor: "david" });
 * ```
 */
export function createWorkflowRegistry(options: CreateWorkflowRegistryOptions): WorkflowRegistry {
  const { storage } = options;
  const clock = options.clock ?? SYSTEM_CLOCK;

  const now = (): string => clock.now().toISOString();

  async function move(
    versionId: WorkflowVersionRecord["id"],
    to: WorkflowStatus,
    promoteOptions: PromoteWorkflowOptions,
  ): Promise<WorkflowVersionRecord> {
    const existing = await storage.getWorkflowVersion(versionId);

    if (existing === null) {
      throw new ValidationError(`registry: no workflow version \`${versionId}\``, {
        issues: [{ path: ["versionId"], message: "no such workflow version" }],
      });
    }

    return storage.setWorkflowVersionStatus({
      versionId,
      from: existing.status,
      to,
      actor: promoteOptions.actor,
      reason: promoteOptions.reason ?? null,
      promotionId: newPromotionId(),
      changedAt: now(),
    });
  }

  async function findActive(
    findOptions: FindActiveOptions,
  ): Promise<readonly WorkflowVersionRecord[]> {
    const found: WorkflowVersionRecord[] = [];
    let after: WorkflowVersionRecord["id"] | undefined;

    // To exhaustion. The selector's tie-break is "the newest matching version",
    // which is a statement about every candidate; stopping at the first page
    // would make the answer depend on the page size.
    for (;;) {
      const page = await storage.listWorkflowVersions(
        { domainId: findOptions.domainId, jobType: findOptions.jobType, status: "active" },
        after === undefined ? {} : { after },
      );

      found.push(...page.versions);

      if (page.nextCursor === null) {
        return found;
      }

      after = page.nextCursor;
    }
  }

  return {
    async register(
      compiled: CompiledWorkflow,
      registerOptions: RegisterWorkflowOptions,
    ): Promise<WorkflowVersionRecord> {
      const { definition } = compiled;

      if (registerOptions.domain.id !== definition.domain) {
        throw new ValidationError(
          `registry: the workflow's domain is \`${definition.domain}\`, not \`${registerOptions.domain.id}\``,
          {
            issues: [
              {
                path: ["domain", "id"],
                message: `expected \`${definition.domain}\`, the domain the IR declares`,
              },
            ],
          },
        );
      }

      const timestamp = now();
      const workflow: WorkflowRecord = {
        id: newWorkflowId(),
        domainId: registerOptions.domain.id,
        domainVersion: registerOptions.domain.version,
        // The IR's own `id` is the workflow's key within the domain. It is what
        // makes "the next version of vendor-triage" resolve to the same
        // workflow rather than to a second one.
        workflowKey: definition.id,
        jobType: definition.jobType,
        createdAt: timestamp,
      };

      // The row that now exists, which carries the *original* id when this
      // workflow was registered before.
      const saved = await storage.saveWorkflow(workflow);

      return storage.saveWorkflowVersion({
        id: newWorkflowVersionId(),
        workflowId: saved.id,
        definition,
        // From the compiled workflow rather than recomputed, because it already
        // carries the digest of exactly these bytes.
        fingerprint: compiled.fingerprint,
        // AD-005. Registration is not promotion, and there is no option here
        // that would make it one.
        status: "draft",
        compatibility: describeWorkflowCompatibility(compiled, {
          sop: registerOptions.sop,
          ...(registerOptions.sopFingerprint === undefined
            ? {}
            : { sopFingerprint: registerOptions.sopFingerprint }),
          ...(registerOptions.minHarnessVersion === undefined
            ? {}
            : { minHarnessVersion: registerOptions.minHarnessVersion }),
        }),
        createdAt: timestamp,
        statusChangedAt: timestamp,
        metadata: { ...registerOptions.metadata, registeredBy: registerOptions.actor },
      });
    },

    async promote(
      versionId: WorkflowVersionRecord["id"],
      to: WorkflowStatus,
      promoteOptions: PromoteWorkflowOptions,
    ): Promise<WorkflowVersionRecord> {
      return move(versionId, to, promoteOptions);
    },

    async retire(
      versionId: WorkflowVersionRecord["id"],
      promoteOptions: PromoteWorkflowOptions,
    ): Promise<WorkflowVersionRecord> {
      return move(versionId, "retired", promoteOptions);
    },

    findActive,

    async resolve(job: Job, env: WorkflowSelectionEnvironment): Promise<WorkflowSelection> {
      const candidates = await findActive({
        domainId: job.domain.id,
        jobType: job.jobType,
      });

      return selectCompatibleWorkflow(job, candidates, env);
    },
  };
}

/**
 * The harness version a registry defaults to, re-exported so a caller building
 * a {@link WorkflowSelectionEnvironment} does not have to reach into
 * `HARNESS_RUNTIME_INFO` to find it.
 */
export const HARNESS_VERSION: string = HARNESS_RUNTIME_INFO.version;
