import {
  type AgentExecution,
  type AgentExecutionUsage,
  type AgentRuntime,
  type Budget,
  type CapabilityRegistry,
  createExecutionContext,
  type ExecutionContext,
  type FallbackContext,
  isJsonValue,
  type Job,
  type JsonObject,
  type JsonValue,
  type TraceEventId,
  type TraceRecorder,
  ValidationError,
  type WorkflowRejection,
  type WorkflowVersionId,
  type WorkflowVersionRecord,
} from "@internal/core";
import {
  type CompiledWorkflow,
  compileWorkflow,
  fallbackContextPayload,
  type NodeExecutionRecord,
  type WorkflowRuntime,
} from "@internal/workflow";
import type { CircuitBreaker } from "./circuit-breaker.js";
import { HARNESS_VERSION, type WorkflowRegistry } from "./workflow-registry.js";

/**
 * The router (M5-T3 through M5-T6, ADR-0044).
 *
 * It is the thing Milestone 5 exists to produce: "the same harness call can
 * execute either workflow or full agent". A router **is** an `AgentRuntime`, so
 * `createHarness({ agentRuntime: router })` needs no new option and nothing
 * about `createHarness()`'s contract changes. From the harness's point of view
 * there is still exactly one runtime; from the domain's point of view the
 * cheapest safe primitive is chosen per job.
 *
 * ```text
 * job ──▶ registry.resolve(job, env)
 *           │
 *           ├─ match ──▶ compiled workflow ──┬─ completed ──▶ result
 *           │                                ├─ failed ─────▶ failure (never "completed")
 *           │                                └─ escalated ──▶ full agent + FallbackContext
 *           └─ none ───▶ full agent
 * ```
 *
 * Three properties are load-bearing and none of them is an accident:
 *
 * - **It is deterministic and makes no model call.** The decision is
 *   `selectCompatibleWorkflow()`, a pure function over the job and the active
 *   versions (ADR-0043). "Do not use an LLM to decide whether a known workflow
 *   exists" is M5-T3 stated directly, and the router has no model to ask.
 * - **It resolves on every run.** There is no cache of "the active version for
 *   this domain", which is why "retiring an active workflow immediately returns
 *   traffic to the full agent" is true with nothing to invalidate.
 * - **An escalation is not a failure.** A workflow that hands the job back
 *   reaches the full agent with what it established, which is north-star
 *   invariant 1. A workflow that genuinely *failed* is reported as a failure and
 *   never as a completed run.
 */

/** Why the router refused a version the selector considered compatible. */
export interface RouteRefusal {
  /**
   * `circuit-breaker` when a configured breaker reports the version is tripped
   * (M5-T7); `compile-failed` when the stored IR no longer compiles against the
   * domain's capability registry.
   */
  readonly kind: "circuit-breaker" | "compile-failed";
  /** The version that was refused. */
  readonly versionId: WorkflowVersionId;
  /** One line for a human reading a trace or a ledger row. */
  readonly detail: string;
}

/** What {@link Router.route} decided, before anything has executed. */
export interface RouteDecision {
  /** Where the job is going. */
  readonly route: "workflow" | "full-agent";
  /** The version that will run, or `null` for the full agent. */
  readonly version: WorkflowVersionRecord | null;
  /** That version compiled against the domain's registry, or `null`. */
  readonly compiled: CompiledWorkflow | null;
  /**
   * Every active candidate that was considered and rejected, with the first
   * reason it failed.
   *
   * This is what answers "why is my workflow not getting traffic?" from the
   * ledger alone, which is why the router copies it into the execution's
   * `metadata` rather than leaving it in the registry. It is populated on a
   * `full-agent` route and empty on a `workflow` one: `selectCompatibleWorkflow()`
   * reports rejections only when it chose nothing, because a selector that
   * matched stops rather than continuing to judge the rest.
   */
  readonly rejections: readonly WorkflowRejection[];
  /** Why a matched version was refused anyway, or `null`. */
  readonly refusal: RouteRefusal | null;
}

/** What {@link createRouter} accepts. */
export interface CreateRouterOptions {
  /** The registry the active versions are read from. */
  readonly registry: WorkflowRegistry;
  /**
   * The domain's capability registry.
   *
   * The registry needs **both** halves of it and the router is the only thing
   * that holds both: the selector compares a version's pinned capabilities
   * against `capabilities.toManifest()`, and `compileWorkflow()` resolves those
   * pins to the actual schemas, handlers, tools and policies. Taking a manifest
   * alone would mean a router that could choose a workflow it cannot run.
   */
  readonly capabilities: CapabilityRegistry;
  /** The local interpreter a matched version runs on. */
  readonly workflowRuntime: WorkflowRuntime;
  /**
   * The full agent: what runs when no workflow matches, and what a fallback
   * escalates to.
   *
   * Required, not optional. A router with no full agent could not satisfy
   * north-star invariant 1, and constructing one would be constructing a
   * system in which a domain cannot always fall back.
   */
  readonly fullAgent: AgentRuntime;
  /** The harness version the selector compares `minHarnessVersion` against. */
  readonly harnessVersion?: string;
  /** The digest of the SOP this caller is running, when it knows it. */
  readonly sopFingerprint?: string;
  /**
   * A circuit breaker consulted before routing to a matched version (M5-T7).
   *
   * **Opt-in.** The build plan's initial breaker "can require manual
   * invocation", and a router with no breaker asks storage nothing extra per
   * run. Supplying one adds a read of the version's recent runs to every route
   * and sends the job to the full agent while the version is tripped, without
   * retiring it — retiring is a status change, and AD-005 keeps a human in
   * front of those.
   */
  readonly breaker?: CircuitBreaker;
}

/** An {@link AgentRuntime} that chooses between a compiled workflow and a full agent. */
export interface Router extends AgentRuntime {
  /**
   * Decide where `job` would go, without running it.
   *
   * Exposed because routing is a question worth asking on its own: an operator
   * checking why a job is not taking the compiled path, and this package's own
   * tests, both want the decision rather than the execution.
   */
  route(job: Job): Promise<RouteDecision>;
}

/** What the router reports about itself when it ran a workflow. */
const ROUTER_NAME = "@internal/registry";

/** Tracks `packages/registry/package.json`, like every other adapter's constant. */
const ROUTER_VERSION = "0.0.0";

/** A rejection as JSON, for `AgentExecution.metadata`. */
function rejectionPayload(rejection: WorkflowRejection): JsonObject {
  return {
    versionId: rejection.versionId,
    reason: rejection.reason,
    detail: rejection.detail,
  };
}

/**
 * What is left of `budget` after `usage`, recalculated at the moment of
 * handoff (M5-T6).
 *
 * **An absent dimension stays absent**, because an absent dimension is
 * unlimited and subtracting from unlimited yields unlimited, not a number. A
 * dimension that has been overspent floors at `0` rather than going negative:
 * "you have less than nothing left" is not a budget a runtime can act on, and
 * `0` says the same thing in a form every consumer already handles.
 *
 * `costUsd` is optional on usage; an adapter that does not know what it spent
 * has not proved it spent nothing, but there is nothing else to subtract, so a
 * run with unknown cost leaves the cost budget where it was.
 */
export function remainingBudgetAfter(budget: Budget, usage: AgentExecutionUsage): Budget {
  const left = (limit: number, spent: number): number => Math.max(0, limit - spent);

  return {
    ...(budget.maxCostUsd === undefined
      ? {}
      : { maxCostUsd: left(budget.maxCostUsd, usage.costUsd ?? 0) }),
    ...(budget.maxDurationMs === undefined
      ? {}
      : { maxDurationMs: left(budget.maxDurationMs, usage.durationMs) }),
    ...(budget.maxModelCalls === undefined
      ? {}
      : { maxModelCalls: left(budget.maxModelCalls, usage.modelCalls) }),
    ...(budget.maxToolCalls === undefined
      ? {}
      : { maxToolCalls: left(budget.maxToolCalls, usage.toolCalls) }),
  };
}

/**
 * How many bytes of serialized envelope the router will hand to an adapter.
 *
 * **Harness-chosen, because eve documents no limit.** `clientContext` is typed
 * `string | readonly string[] | JsonObject` in
 * `eve/dist/src/protocol/message.d.ts`, and neither the type nor
 * `eve/docs/guides/client/messages.mdx` states a maximum
 * (`docs/research/vercel/2026-09-20-m5-eve-client-context-for-fallback.md`).
 * An undocumented limit is not an absent one, though, and a `clientContext`
 * becomes a context message on **every model call of the turn**, so an
 * unbounded envelope is paid for repeatedly in tokens even where it is
 * accepted.
 *
 * 64 KiB is a budget rather than a measurement: large enough for the completed
 * outputs of any workflow a human would hand-author, small enough that a
 * `map` node over a thousand items cannot quietly multiply the cost of every
 * step of the fallback turn. Revisit it against a real limit if one is ever
 * documented.
 */
export const FALLBACK_ENVELOPE_MAX_BYTES = 65_536;

/** A node's validated output as JSON, or `null` when it is not JSON data. */
function outputAsJson(output: unknown): JsonValue | null {
  // `NodeExecutionRecord.output` is `unknown`: it passed the node's own
  // `Schema`, which a domain wrote, and a Standard Schema may return anything.
  // Nothing here can prove it is JSON, so it is checked rather than cast.
  return output !== undefined && isJsonValue(output) ? output : null;
}

/** How many bytes `value` serializes to. */
function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? "null", "utf8");
}

/**
 * Fill each completed node's inline `output` from the run's records (M5-T6).
 *
 * The interpreter leaves them `null` because it has no agent to hand them to;
 * this is the step that makes the envelope usable by one. The **last**
 * completed execution of a node wins, matching how the interpreter chose the
 * entry: a `map` or `loop` body runs many times and run state holds the last
 * output.
 */
function withNodeOutputs(
  fallback: FallbackContext,
  records: readonly NodeExecutionRecord[],
): FallbackContext {
  const outputs = new Map<string, unknown>();

  for (const record of records) {
    if (record.status === "completed") {
      outputs.set(record.nodeId, record.output);
    }
  }

  return {
    ...fallback,
    completedNodes: fallback.completedNodes.map((node) => ({
      ...node,
      output: outputAsJson(outputs.get(node.nodeId)),
    })),
  };
}

/**
 * Drop the largest inline outputs until the envelope fits in `maxBytes`.
 *
 * **Largest first**, because dropping one big output saves what dropping many
 * small ones would, and the many small ones are more likely to be the
 * deterministic intermediate results an agent can actually act on. `outputRef`
 * survives every drop, so a dropped value is still *named*: the agent is told
 * the node completed and where its result lives, rather than being told
 * nothing. `detail` gains a sentence, because an agent that was silently given
 * less than it asked for would conclude the work was never done.
 *
 * Returns the envelope unchanged when it already fits, which is the ordinary
 * case.
 */
export function capFallbackOutputs(
  fallback: FallbackContext,
  maxBytes: number = FALLBACK_ENVELOPE_MAX_BYTES,
): FallbackContext {
  if (jsonBytes(fallback) <= maxBytes) {
    return fallback;
  }

  // Largest first, and ties broken by node id so the result does not depend on
  // `sort` stability for equal sizes.
  const order = fallback.completedNodes
    .map((node, index) => ({ index, size: jsonBytes(node.output) }))
    .filter((entry) => fallback.completedNodes[entry.index]?.output !== null)
    .sort((left, right) => right.size - left.size || left.index - right.index);

  const dropped: string[] = [];
  let nodes = [...fallback.completedNodes];

  for (const entry of order) {
    const node = nodes[entry.index];

    if (node === undefined) {
      continue;
    }

    nodes = nodes.map((each, index) => (index === entry.index ? { ...each, output: null } : each));
    dropped.push(node.nodeId);

    if (jsonBytes({ ...fallback, completedNodes: nodes }) <= maxBytes) {
      break;
    }
  }

  if (dropped.length === 0) {
    return fallback;
  }

  return {
    ...fallback,
    completedNodes: nodes,
    detail: `${fallback.detail} (the result of ${dropped.join(", ")} was too large to carry inline and is available by reference only)`,
  };
}

/** Two usages added: what the whole attempt consumed, workflow plus fallback. */
function addUsage(left: AgentExecutionUsage, right: AgentExecutionUsage): AgentExecutionUsage {
  const costUsd =
    left.costUsd === undefined && right.costUsd === undefined
      ? undefined
      : (left.costUsd ?? 0) + (right.costUsd ?? 0);

  return {
    modelCalls: left.modelCalls + right.modelCalls,
    toolCalls: left.toolCalls + right.toolCalls,
    durationMs: left.durationMs + right.durationMs,
    ...(costUsd === undefined ? {} : { costUsd }),
  };
}

/**
 * The same recorder, reporting a different root.
 *
 * This is what makes "the trace links the compiled run span to the fallback
 * agent execution" true without asking every adapter to learn a new field. An
 * adapter parents its first event on `context.trace.rootId`, which is normally
 * the run's `run.started`; during a fallback it is the escalation's
 * `fallback.started`, so the agent's whole subtree hangs under the fallback
 * rather than beside it.
 *
 * It delegates everything else, including `record`, `span` and `flush`, so the
 * run still has exactly **one** sequence owner (ADR-0031). The live fields are
 * getters rather than copies for the same reason: `lastEventId` and `recorded`
 * change as the run proceeds, and a snapshot would go stale the moment the
 * agent recorded anything.
 */
function recorderRootedAt(recorder: TraceRecorder, rootId: TraceEventId): TraceRecorder {
  return {
    runId: recorder.runId,
    attempt: recorder.attempt,
    behaviorFingerprint: recorder.behaviorFingerprint,
    rootId,
    get lastEventId(): TraceEventId | null {
      return recorder.lastEventId;
    },
    get recorded(): number {
      return recorder.recorded;
    },
    record: (input) => recorder.record(input),
    span: (input) => recorder.span(input),
    flush: () => recorder.flush(),
  };
}

/**
 * Create a {@link Router}.
 *
 * ```ts
 * const router = createRouter({
 *   registry: createWorkflowRegistry({ storage }),
 *   capabilities,
 *   workflowRuntime: createWorkflowRuntime({ registry: capabilities, agentRuntime, decisionEngine }),
 *   fullAgent: agentRuntime,
 * });
 *
 * const harness = createHarness({ agentRuntime: router, trace, storage });
 * ```
 */
export function createRouter(options: CreateRouterOptions): Router {
  const { registry, capabilities, workflowRuntime, fullAgent, breaker } = options;
  const harnessVersion = options.harnessVersion ?? HARNESS_VERSION;

  /**
   * Compiled workflows, keyed by version id.
   *
   * A cache of **compilation**, not of routing. Which version is active is
   * re-resolved on every run, because that is what makes a retirement take
   * effect immediately; compiling the same immutable IR twice would only be
   * slower. A version record is immutable apart from its status, and its id
   * never outlives its definition, so the key cannot go stale.
   */
  const compiledByVersion = new Map<WorkflowVersionId, CompiledWorkflow>();

  const compileFor = (version: WorkflowVersionRecord): CompiledWorkflow => {
    const cached = compiledByVersion.get(version.id);

    if (cached !== undefined) {
      return cached;
    }

    const compiled = compileWorkflow(version.definition, capabilities);

    compiledByVersion.set(version.id, compiled);

    return compiled;
  };

  const route = async (job: Job): Promise<RouteDecision> => {
    const selection = await registry.resolve(job, {
      manifest: capabilities.toManifest(),
      harnessVersion,
      ...(options.sopFingerprint === undefined ? {} : { sopFingerprint: options.sopFingerprint }),
    });

    if (selection.kind === "none") {
      // "Unsupported jobs never force-fit into a workflow." There is no
      // second-best match and no nearest neighbour: an exact-match selector
      // that found nothing means the full agent, with every rejection recorded
      // so a human can see what was considered.
      return {
        route: "full-agent",
        version: null,
        compiled: null,
        rejections: selection.rejections,
        refusal: null,
      };
    }

    const { version } = selection;

    if (breaker !== undefined) {
      const reading = await breaker.evaluate(version.id);

      if (reading.tripped) {
        return {
          route: "full-agent",
          version: null,
          compiled: null,
          rejections: [],
          refusal: {
            kind: "circuit-breaker",
            versionId: version.id,
            detail: `${reading.sample} recent run(s): fallback rate ${reading.fallbackRate.toFixed(2)}, failure rate ${reading.failureRate.toFixed(2)}`,
          },
        };
      }
    }

    let compiled: CompiledWorkflow;

    try {
      compiled = compileFor(version);
    } catch (cause) {
      // A stored version whose IR no longer compiles here — a capability
      // renamed, a schema version moved on. The full agent can still do the
      // work, so this is a routing outcome rather than a run-ending error, and
      // the refusal says which version and why. A non-`ValidationError` is a
      // defect in the compiler and propagates.
      if (!(cause instanceof ValidationError)) {
        throw cause;
      }

      return {
        route: "full-agent",
        version: null,
        compiled: null,
        rejections: [],
        refusal: { kind: "compile-failed", versionId: version.id, detail: cause.message },
      };
    }

    return {
      route: "workflow",
      version,
      compiled,
      // A `match` reports no rejections: the selector returns the chosen
      // version and stops, so the candidates it never had to consider are not
      // a list anyone can truthfully print.
      rejections: [],
      refusal: null,
    };
  };

  /** The metadata every execution this router returns carries. */
  const routeMetadata = (decision: RouteDecision, extra: JsonObject = {}): JsonObject => ({
    route: decision.route,
    workflowVersionId: decision.version?.id ?? null,
    ...(decision.version === null
      ? {}
      : {
          workflowId: decision.version.definition.id,
          workflowVersion: decision.version.definition.version,
        }),
    rejections: decision.rejections.map(rejectionPayload) satisfies readonly JsonValue[],
    ...(decision.refusal === null
      ? {}
      : {
          refusal: {
            kind: decision.refusal.kind,
            versionId: decision.refusal.versionId,
            detail: decision.refusal.detail,
          },
        }),
    ...extra,
  });

  /**
   * Run the full agent for `job`, optionally as the fallback from `fallback`.
   *
   * One function for both, because the difference between "no workflow matched"
   * and "a workflow handed this back" is entirely in the context the agent
   * receives: a narrowed budget, an envelope, and a trace root under the
   * escalation. The invocation itself is the same, which is the point — a
   * fallback is an ordinary full-agent run that happens to start better
   * informed.
   */
  const runFullAgent = async <TInput, TOutput>(
    job: Job<TInput, TOutput>,
    context: ExecutionContext,
    fallback: { readonly envelope: FallbackContext; readonly spanId: TraceEventId } | null,
  ): Promise<AgentExecution<TOutput>> => {
    if (fallback === null) {
      return await fullAgent.run(job, context);
    }

    // The **original immutable job**, unchanged (M5-T6). Everything the
    // fallback adds is in the context: what is left of the budget, what the
    // workflow established, and where in the trace this run belongs.
    const fallbackContext = createExecutionContext({
      runId: context.runId,
      jobId: context.jobId,
      domain: context.domain,
      attempt: context.attempt,
      budget: fallback.envelope.remainingBudget,
      permissions: context.permissions,
      recorder: recorderRootedAt(context.trace, fallback.spanId),
      signal: context.signal,
      runtime: context.runtime,
      fallback: fallback.envelope,
    });

    return await fullAgent.run(job, fallbackContext);
  };

  return {
    route,

    async run<TInput, TOutput>(
      job: Job<TInput, TOutput>,
      context: ExecutionContext,
    ): Promise<AgentExecution<TOutput>> {
      const decision = await route(job as Job);

      if (decision.route === "full-agent" || decision.compiled === null) {
        const execution = await runFullAgent(job, context, null);

        return {
          ...execution,
          metadata: { ...execution.metadata, ...routeMetadata(decision) },
          fallbackCount: 0,
          // Whatever the full agent reported. A runtime that makes no decisions
          // reports none, and `0` is then a measurement rather than a guess.
          jevCalls: execution.jevCalls ?? 0,
        };
      }

      const versionId = decision.version?.id;
      const result = await workflowRuntime.run(decision.compiled, job as Job, context);

      switch (result.status) {
        case "completed":
          return {
            status: "completed",
            // The same contained assertion `asAgentRuntime()` and every other
            // runtime makes: the interpreter validated this against the
            // *workflow's* output schema, and `createHarness()` re-validates it
            // against the *domain's* before any caller sees it.
            output: result.output as TOutput,
            usage: result.usage,
            runtime: { name: ROUTER_NAME, version: ROUTER_VERSION, metadata: {} },
            metadata: routeMetadata(decision),
            fallbackCount: 0,
            jevCalls: result.jevCalls,
            ...(versionId === undefined ? {} : { workflowVersionId: versionId }),
          };

        case "failed":
          // A defect in the compiled path, not a fallback condition. It is
          // reported as a failure and never as a completed run: "workflow
          // failure does not mark the job successful" is an acceptance
          // criterion of this milestone, and escalating a defect would hide a
          // bug behind a working system (ADR-0040).
          return {
            status: "failed",
            error: result.error,
            usage: result.usage,
            runtime: { name: ROUTER_NAME, version: ROUTER_VERSION, metadata: {} },
            metadata: routeMetadata(decision),
            fallbackCount: 0,
            jevCalls: result.jevCalls,
            ...(versionId === undefined ? {} : { workflowVersionId: versionId }),
          };

        case "aborted":
          return {
            status: "aborted",
            usage: result.usage,
            runtime: { name: ROUTER_NAME, version: ROUTER_VERSION, metadata: {} },
            metadata: routeMetadata(decision),
            fallbackCount: 0,
            jevCalls: result.jevCalls,
            ...(versionId === undefined ? {} : { workflowVersionId: versionId }),
          };

        case "escalated": {
          // M5-T5. The envelope's budget is recalculated **here**, immediately
          // before the agent is invoked, rather than taken as the interpreter
          // left it: the workflow kept spending until the moment it returned,
          // and a budget computed a step earlier would hand the agent more room
          // than the job has left.
          const envelope: FallbackContext = capFallbackOutputs(
            withNodeOutputs(
              {
                ...result.fallback,
                remainingBudget: remainingBudgetAfter(context.budget, result.usage),
              },
              result.nodes,
            ),
          );
          const execution = await runFullAgent(job, context, {
            envelope,
            spanId: result.fallbackSpanId,
          });
          const usage = addUsage(result.usage, execution.usage);

          await context.trace.record({
            type: "fallback.completed",
            node: envelope.nodeId,
            parentId: result.fallbackSpanId,
            payload: {
              reason: envelope.reason,
              outcome: execution.status,
              workflowId: envelope.workflow.id,
              workflowVersion: envelope.workflow.version,
              agentRuntime: execution.runtime.name,
            },
            usage: {
              modelCalls: execution.usage.modelCalls,
              toolCalls: execution.usage.toolCalls,
              ...(execution.usage.costUsd === undefined
                ? {}
                : { costUsd: execution.usage.costUsd }),
            },
            latencyMs: execution.usage.durationMs,
            ...(execution.status === "failed" ? { error: execution.error } : {}),
          });

          // The agent's own outcome, with the whole attempt's usage: the job
          // cost what the workflow spent **plus** what the agent spent, and
          // reporting only the second half would make the compiled path look
          // free every time it gave up.
          const metadata = routeMetadata(decision, {
            fallback: fallbackContextPayload(envelope),
          });

          return {
            ...(execution as AgentExecution<TOutput>),
            usage,
            metadata: { ...execution.metadata, ...metadata },
            fallbackCount: 1,
            // Both halves: the compiled path's decisions plus any the full
            // agent made after it took over. Reporting only the agent's would
            // make the workflow's judgments free on the ledger.
            jevCalls: result.jevCalls + (execution.jevCalls ?? 0),
            ...(versionId === undefined ? {} : { workflowVersionId: versionId }),
          };
        }
      }
    },
  };
}
