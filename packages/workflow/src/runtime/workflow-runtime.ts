import type {
  AgentExecution,
  AgentExecutionUsage,
  AgentNode,
  AgentRuntime,
  ArtifactNode,
  BranchNode,
  CallNode,
  CapabilityRegistry,
  ChainNode,
  Clock,
  CodeNode,
  ExecutionContext,
  FallbackContext,
  FallbackReason,
  JevNode,
  Job,
  JsonObject,
  JsonValue,
  LoopNode,
  MapNode,
  NodeCapabilityRef,
  NodeId,
  ReduceNode,
  RuntimeInfo,
  Schema,
  SerializedHarnessError,
  TraceEventId,
  TraceRecorder,
  TraceSpan,
  WorkflowDefinition,
  WorkflowNode,
  WorkflowNodeType,
} from "@internal/core";
import {
  AgentExecutionError,
  BudgetExceededError,
  createExecutionContext,
  DecisionError,
  formatCapabilityRef,
  PermissionDeniedError,
  serializeError,
  ToolExecutionError,
  ValidationError,
  validateWith,
  WorkflowError,
} from "@internal/core";
import type { CompiledWorkflow } from "../compiled.js";
import {
  asJsonValue,
  type BindingScope,
  evaluateBinding,
  readPath,
  traceValue,
} from "./bindings.js";
import { type BudgetLedger, createBudgetLedger, narrowBudget } from "./budget.js";
import { assertGrantsWithinJob, assertToolGranted, requiredMode } from "./grants.js";
import { attemptIdempotencyKey, protectionIdempotencyKey } from "./idempotency.js";
import {
  type ArtifactStorePort,
  createInMemoryArtifactStore,
  createInMemoryProtectedEffectStore,
  type ProtectedEffectStore,
  type WorkflowDecisionPort,
} from "./ports.js";

/**
 * The local deterministic workflow runtime (M4-T6, M4-T7, M4-T8), and with it
 * the execution half of M4-T3 and M4-T4.
 *
 * It is an **interpreter over a {@link CompiledWorkflow} and nothing else**.
 * That type's doc comment lists what holding one guarantees — the definition
 * parsed, the graph is valid, every capability reference resolved, the node
 * rules hold — and this file assumes every one of them rather than re-checking
 * it. "A workflow with a missing capability MUST fail validation before any node
 * executes" (M4-T9) is therefore a type-level fact here, not a runtime check.
 *
 * What it does per node is exactly build plan M4-T6's list: evaluate the node's
 * `input` binding against run state, **validate the input**, execute, **validate
 * the output**, emit trace events, enforce the timeout, enforce the budget,
 * follow the edge, and keep the result. There is deliberately **no durability** —
 * M4-T6 says not to build it yet — so a node result lives in run state, in the
 * returned {@link WorkflowRunResult} and in the trace, and a crashed process
 * loses it.
 *
 * Three properties are worth stating up front, because the rest of the file
 * assumes them and ADR-0040 records them:
 *
 * - **It records through the run's existing {@link TraceRecorder}**
 *   (`context.trace`), never its own. A run has one total order and one owner of
 *   `sequence` (ADR-0031), and a workflow is part of a run rather than a second
 *   run beside it. It emits no `run.*` events for the same reason: those belong
 *   to `createHarness()`.
 * - **`node.*` payloads carry the node's input and output**, which amends
 *   ADR-0031's identity-only convention for those three event types. M4-T6 says
 *   "persist node result" and nothing else persists one in M4; M6's replay needs
 *   the values; and redaction sits above the buffer (ADR-0035), so a secret is
 *   still stripped before anything is written. The amendment is deliberate and
 *   scoped to `node.*`.
 * - **A node that exhausts its retries escalates; it does not fail.** A `failed`
 *   result is reserved for a defect — a broken binding, a graph the validator
 *   should have rejected — because north-star invariant 1 is that a domain can
 *   always fall back to its full agent, and a node that could not do its job is
 *   precisely the case the fallback exists for.
 */

/** This package, as it identifies itself in `AgentExecution.runtime`. */
const RUNTIME_NAME = "@internal/workflow";

/**
 * This package's version.
 *
 * A module constant tracked by hand rather than a value read from `package.json`
 * at runtime, for the reason `HARNESS_RUNTIME_INFO` gives: reading a package
 * manifest from a compiled `dist/` at an unknown path is brittle and would make
 * the contract depend on file layout. Nothing branches on it.
 */
const RUNTIME_VERSION = "0.0.0";

/**
 * A ceiling on how many nodes one traversal may visit.
 *
 * Defence in depth, not a semantic limit. The IR admits no unbounded loop and a
 * {@link CompiledWorkflow} has already been checked for undeclared cycles, so
 * this can only fire if that guarantee is broken — in which case stopping with a
 * named error beats spinning forever.
 */
const MAX_GRAPH_STEPS = 100_000;

/** What one node execution produced, for the run result and the fallback envelope. */
export interface NodeExecutionRecord {
  /** The node that executed. */
  readonly nodeId: NodeId;
  /** Its type, so a reader need not look the node up to know what it was. */
  readonly type: WorkflowNodeType;
  /** Whether the execution ended in a completed node or an exhausted one. */
  readonly status: "completed" | "failed";
  /** How many attempts it took, counting from 1. */
  readonly attempts: number;
  /** Its index inside an enclosing `map`, or `null`. */
  readonly itemIndex: number | null;
  /** The per-attempt idempotency key of its **last** attempt (M4-T7). */
  readonly idempotencyKey: string;
  /** How long every attempt took together, in milliseconds. */
  readonly durationMs: number;
  /** The validated output, when it completed. */
  readonly output?: unknown;
  /** Why it failed, when it did. */
  readonly error?: SerializedHarnessError;
}

/**
 * How many decisions a run asked for, on every {@link WorkflowRunResult}.
 *
 * Separate from {@link AgentExecutionUsage}'s four dimensions because a Jev
 * decision is not a model call in the sense a budget limits — the interpreter
 * charges the budget one model call per decision, which is a floor rather than
 * a measurement — and `runs.jev_calls` is a ledger column of its own that M6
 * and M7 compare against cost.
 */
interface WorkflowRunJevCalls {
  /** Decisions asked of a `jev` node's engine, including ones that threw. */
  readonly jevCalls: number;
}

/** The workflow produced an output that satisfied the workflow's `outputSchema`. */
export interface CompletedWorkflowRun extends WorkflowRunJevCalls {
  readonly status: "completed";
  /** The terminal node's validated output. */
  readonly output: unknown;
  /** What the run consumed. */
  readonly usage: AgentExecutionUsage;
  /** Every node execution, in completion order. */
  readonly nodes: readonly NodeExecutionRecord[];
}

/**
 * The run hit a defect rather than a failure it could route around.
 *
 * Reserved for invariant violations: a binding that reads a node which has not
 * run, an `item` binding outside a `map` body, a `branch` label with neither a
 * case nor a default, a node id no node answers to. All of these are graphs the
 * validator (M4-T4/M4-T9) is expected to have rejected, so reporting them as a
 * fallback would hide a bug behind a working system.
 */
export interface FailedWorkflowRun extends WorkflowRunJevCalls {
  readonly status: "failed";
  /** The defect, in its trace-safe form. */
  readonly error: SerializedHarnessError;
  readonly usage: AgentExecutionUsage;
  readonly nodes: readonly NodeExecutionRecord[];
}

/** `ExecutionContext.signal` fired. */
export interface AbortedWorkflowRun extends WorkflowRunJevCalls {
  readonly status: "aborted";
  readonly usage: AgentExecutionUsage;
  readonly nodes: readonly NodeExecutionRecord[];
}

/** The compiled path gave up and handed the job back, with what it had established. */
export interface EscalatedWorkflowRun extends WorkflowRunJevCalls {
  readonly status: "escalated";
  /** Build plan section 5's envelope, ready for M5's router to hand to the full agent. */
  readonly fallback: FallbackContext;
  /**
   * The id of this escalation's `fallback.started` event, the span the full
   * agent's own events hang off (M5-T5, ADR-0044).
   *
   * The runtime records `fallback.started` because it is the only thing that
   * knows *why* the compiled path stopped; the router is the only thing that
   * knows what happens next, so it parents the agent run on this id and closes
   * the span with `fallback.completed`. Returning the id is what links the two
   * halves without either one having to emit the other's event.
   *
   * Always present: a `TraceRecorder` stamps an id on every event it accepts,
   * whether the writer behind it persists, buffers or discards.
   */
  readonly fallbackSpanId: TraceEventId;
  readonly usage: AgentExecutionUsage;
  readonly nodes: readonly NodeExecutionRecord[];
}

/**
 * What a workflow run produced, as a discriminated union on `status`.
 *
 * Four cases rather than three, because `escalated` is not a failure: it is the
 * designed exit north-star invariant 1 requires, and collapsing it into `failed`
 * would make "how often does this workflow carry its weight?" (M5) unanswerable.
 */
export type WorkflowRunResult =
  | CompletedWorkflowRun
  | FailedWorkflowRun
  | AbortedWorkflowRun
  | EscalatedWorkflowRun;

/** What {@link createWorkflowRuntime} accepts. */
export interface CreateWorkflowRuntimeOptions {
  /**
   * The registry every capability value is resolved against.
   *
   * Required, because a {@link CompiledWorkflow} carries capability *metadata*
   * and the runtime needs the executable values: the handler a `code` node
   * calls, the tool a `call` node calls, the policy a `branch` consults, and
   * every node's input and output `Schema`.
   */
  readonly registry: CapabilityRegistry;
  /**
   * Required to execute an `agent` node.
   *
   * Optional here rather than required, because a workflow with no `agent` node
   * has no use for one, and a runtime that demanded one would force every caller
   * to supply a stub it never calls.
   */
  readonly agentRuntime?: AgentRuntime;
  /** Required to execute a `jev` node. M3 implements it; M4's tests fake it. */
  readonly decisionEngine?: WorkflowDecisionPort;
  /** Where `artifact` nodes write. Defaults to an in-memory store. */
  readonly artifacts?: ArtifactStorePort;
  /** Where protected non-idempotent writes record themselves (M4-T7). Defaults to memory. */
  readonly effects?: ProtectedEffectStore;
  /** The time source for durations and budgets. Defaults to the system clock. */
  readonly clock?: Clock;
  /**
   * How a retry backoff waits. Defaults to a real timer that resolves early on
   * abort.
   *
   * Injectable because `createFakeClock()` deliberately schedules nothing, so a
   * test that wants a deterministic retry has to supply the waiting as well as
   * the time.
   */
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/** The local interpreter. */
export interface WorkflowRuntime {
  /**
   * Run `workflow` for `job` under `context`.
   *
   * Never throws for a workflow that failed, timed out, ran out of budget or
   * escalated: all four are {@link WorkflowRunResult} values with usage
   * attached, the same contract `AgentRuntime.run()` and `harness.run()` keep.
   */
  run(workflow: CompiledWorkflow, job: Job, context: ExecutionContext): Promise<WorkflowRunResult>;
  /**
   * Present `workflow` as an {@link AgentRuntime}, so
   * `createHarness({ agentRuntime })` can run it unchanged.
   *
   * This is the M4 status file's "design option for the runtime task": trace,
   * storage and `pnpm harness run show` keep working with no router, because
   * from the harness's point of view a workflow is just another thing that runs
   * a job. M5 replaces it with a real router that can invoke the full agent.
   */
  asAgentRuntime(workflow: CompiledWorkflow): AgentRuntime;
}

/** The run stopped because `ExecutionContext.signal` fired. Internal control flow. */
class RunAborted extends Error {
  constructor() {
    super("workflow: the run was cancelled");
    this.name = "RunAborted";
  }
}

/** The run is handing the job back to the full agent. Internal control flow. */
class Escalation extends Error {
  /** Which of the six closed reasons applies. */
  readonly fallbackReason: FallbackReason;
  /** The node that gave up, or `null` when the workflow itself did. */
  readonly nodeId: NodeId | null;
  /** One line for a trace payload, saying what happened. */
  readonly detail: string;

  constructor(fallbackReason: FallbackReason, nodeId: NodeId | null, detail: string) {
    super(`workflow: escalating (${fallbackReason})`);
    this.name = "Escalation";
    this.fallbackReason = fallbackReason;
    this.nodeId = nodeId;
    this.detail = detail;
  }
}

/**
 * A node exceeded its `timeoutMs`.
 *
 * A {@link WorkflowError} subclass rather than a new taxonomy member: the code
 * stays `WORKFLOW`, which is what a trace and a stored record branch on, while
 * `instanceof` lets the escalation reason be `timeout` rather than
 * `node-failed`. The error taxonomy is closed (ADR-0026) and this does not open
 * it.
 */
class NodeTimeoutError extends WorkflowError {}

/** Everything one run carries while it executes. */
interface RunState {
  readonly workflow: CompiledWorkflow;
  readonly definition: WorkflowDefinition;
  readonly job: Job;
  readonly context: ExecutionContext;
  readonly recorder: TraceRecorder;
  /** Every node output so far, which is half the run state the contract defines. */
  readonly outputs: Map<NodeId, unknown>;
  /** Every node execution, in completion order. */
  readonly records: NodeExecutionRecord[];
  readonly ledger: BudgetLedger;
  readonly startedAtMs: number;
  /**
   * How many decisions this run asked a `jev` node's engine for (M3, M5).
   *
   * Counted where `decide()` is actually invoked rather than derived from the
   * node records afterwards, because a record's `attempts` counts retries of
   * the whole node — including an attempt that failed input validation before
   * any engine was reached — and `runs.jev_calls` is meant to be what the
   * decision layer was asked to do. A call that threw still counts: it was
   * made, and it may well have been paid for.
   */
  jevCalls: number;
}

/** Where a node sits in the traversal: its trace parent and its `map` element. */
interface ExecScope {
  /** The span a node's `node.started` hangs off: the run root, or its container's node span. */
  readonly parentSpanId: TraceEventId | null;
  /** The current `map` element, absent outside a `map` body. */
  readonly item?: { readonly value: unknown; readonly index: number };
}

/** What executing one node decided: a value and an edge, or an escalation. */
type NodeOutcome =
  | {
      readonly kind: "output";
      readonly output: unknown;
      readonly next: NodeId | null;
      /**
       * The label a `branch` selected, and the node it selected, when the node
       * was a `branch`.
       *
       * A `branch` is **pass-through**: its output is the value it routed, so
       * neither the label nor the chosen target is anywhere in that value and
       * both would be invisible without this. They are carried here only to
       * reach the node's `node.completed` payload, where a reader of a trace —
       * or of `pnpm harness run show` — can see which way the run went.
       */
      readonly route?: { readonly label: string; readonly target: NodeId };
    }
  | { readonly kind: "escalate"; readonly reason: string };

/** Anything the registry hands back that the runtime then calls. */
type CapabilityFunction = (...args: readonly unknown[]) => unknown;

/** The node types whose output a fallback may be handed as trusted. */
const TRUSTED_NODE_TYPES: ReadonlySet<WorkflowNodeType> = new Set<WorkflowNodeType>([
  "code",
  "artifact",
  "chain",
  "branch",
  "map",
  "reduce",
  "loop",
]);

/**
 * Whether a completed node's output may be handed to the full agent as trusted.
 *
 * `FallbackContext.completedNodes[].trusted` is the load-bearing field: the
 * agent is told which results it may build on and which it should re-examine,
 * rather than being handed a flat list it has to take on faith.
 *
 * The rule is about **who produced the value**, not whether it validated —
 * everything in `completedNodes` validated, or it would not be there:
 *
 * - `code`, `artifact` and every control shape are deterministic harness-side
 *   computation over already-validated inputs, so they are trusted;
 * - a `read-only` `call` is trusted, because it observed the world and changed
 *   nothing;
 * - a write `call` is **not**, because a retry, a partial write or a protected
 *   replay all mean the world and the recorded value may disagree;
 * - `agent` and `jev` are **not**, because they are probabilistic. A schema says
 *   an answer is well shaped, not that it is right, and telling the full agent
 *   otherwise would be exactly the over-trust ADR-0005 and north-star invariant
 *   2 exist to prevent.
 */
function isTrustedNode(node: WorkflowNode): boolean {
  if (node.type === "call") {
    return node.effect === "read-only";
  }

  return TRUSTED_NODE_TYPES.has(node.type);
}

/** The system clock. The default when none is supplied. */
const SYSTEM_CLOCK: Clock = {
  now(): Date {
    return new Date();
  },
};

/** Wait `ms`, resolving early if `signal` aborts. The default retry backoff. */
function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Resolve a capability value, reporting a miss as a workflow error.
 *
 * `CapabilityRegistry.resolve()` throws {@link ValidationError} for an
 * unregistered reference, and this runtime maps a `ValidationError` to the
 * `validation-failed` fallback reason, which means "a node's input or output
 * failed its schema". A capability that is not registered is a different
 * problem, so it is re-reported as a {@link WorkflowError} and escalates as
 * `node-failed`.
 */
function resolveCapability<TValue>(
  registry: CapabilityRegistry,
  kind: "schema" | "tool" | "handler" | "policy" | "agent",
  ref: NodeCapabilityRef | string,
  nodeId: NodeId,
): TValue {
  try {
    return registry.resolve<TValue>(kind, ref);
  } catch (cause) {
    const label = typeof ref === "string" ? ref : formatCapabilityRef(ref);

    throw new WorkflowError(
      `node \`${nodeId}\`: its ${kind} capability \`${label}\` is not registered in this runtime's registry`,
      { cause, details: { nodeId, kind, ref: label } },
    );
  }
}

/**
 * Race `work` against a signal, rejecting when the signal aborts first.
 *
 * The signal is `AbortSignal.any([context.signal, AbortSignal.timeout(node.timeoutMs)])`,
 * so one listener covers both cancellation and the node deadline, and which one
 * fired is decided by asking the run's own signal. The race is necessary rather
 * than decorative: a `code` handler or a tool is a plain function and is under no
 * obligation to watch a signal, so the runtime has to stop *waiting* for it even
 * though it cannot stop it running.
 */
function withDeadline<TValue>(
  work: Promise<TValue>,
  combined: AbortSignal,
  runSignal: AbortSignal,
  nodeId: NodeId,
  timeoutMs: number,
): Promise<TValue> {
  const failure = (): Error =>
    runSignal.aborted
      ? new RunAborted()
      : new NodeTimeoutError(`node \`${nodeId}\`: it exceeded its ${timeoutMs}ms timeout`, {
          details: { nodeId, timeoutMs },
        });

  if (combined.aborted) {
    return Promise.reject(failure());
  }

  return new Promise<TValue>((resolve, reject) => {
    const onAbort = (): void => {
      reject(failure());
    };

    combined.addEventListener("abort", onAbort, { once: true });

    work.then(
      (value) => {
        combined.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (cause: unknown) => {
        combined.removeEventListener("abort", onAbort);
        reject(cause instanceof Error ? cause : new Error(String(cause)));
      },
    );
  });
}

/**
 * Whether a failed attempt is worth retrying.
 *
 * Only two failures are never retried, and both for the same reason: retrying
 * cannot change the answer. A budget that has run out does not refill, and a
 * permission the job did not grant is not granted by asking again. Everything
 * else — a tool that threw, an agent that failed, an output that did not
 * validate, a decision that could not be obtained — is what `retry.maxAttempts`
 * is for.
 */
function isRetryable(cause: unknown): boolean {
  return !(cause instanceof BudgetExceededError || cause instanceof PermissionDeniedError);
}

/**
 * Which fallback reason a stopped node or run escalates with (ADR-0044).
 *
 * `FallbackReason` is a closed union whose members are stored, aggregated and
 * compared (M5 counts fallbacks per reason), so the mapping is explicit rather
 * than a catch-all. It maps the interpreter's *mechanical* causes onto the
 * build plan's eight "why the compiled path could not be trusted" reasons:
 *
 * | Cause | Reason |
 * | --- | --- |
 * | `BudgetExceededError`, a node timeout | `budget` |
 * | `ValidationError` (a node's or the workflow's own schema) | `schema_mismatch` |
 * | `PermissionDeniedError` | `policy` |
 * | anything else in a `call` node | `tool_failure` |
 * | anything else, including an unusable `jev` answer | `workflow_error` |
 *
 * `nodeType` is what separates the last two rows: a tool that kept failing is a
 * fact about the world the workflow depends on, and a handler that threw is a
 * fact about the workflow, and a human triaging a spike of fallbacks needs to
 * know which. It is `null` when the workflow itself stopped rather than a node.
 *
 * Two members are deliberately unreachable from here. `unsupported_case` is
 * raised only by an `escalate` node, which is an authored decision rather than
 * a failure, and `low_confidence` and `missing_evidence` belong to a policy
 * layer that reads a judgment's confidence — M3's, not the interpreter's. A
 * decision the engine could not produce at all is a `workflow_error`, because
 * no judgment was made and "low confidence" would claim one was.
 */
function escalationReasonFor(cause: unknown, nodeType: WorkflowNodeType | null): FallbackReason {
  if (cause instanceof BudgetExceededError || cause instanceof NodeTimeoutError) {
    return "budget";
  }

  if (cause instanceof ValidationError) {
    return "schema_mismatch";
  }

  if (cause instanceof PermissionDeniedError) {
    return "policy";
  }

  if (cause instanceof DecisionError) {
    return "workflow_error";
  }

  return nodeType === "call" ? "tool_failure" : "workflow_error";
}

/**
 * Render a fallback envelope as JSON, for an error's `details` or a trace
 * payload.
 *
 * Written out field by field rather than cast, because `FallbackContext` is an
 * interface and therefore carries no index signature: building the JSON
 * explicitly is what makes it a conversion rather than an assertion.
 */
export function fallbackContextPayload(fallback: FallbackContext): JsonObject {
  return {
    reason: fallback.reason,
    detail: fallback.detail,
    nodeId: fallback.nodeId,
    workflow: {
      id: fallback.workflow.id,
      version: fallback.workflow.version,
      fingerprint: fallback.workflow.fingerprint,
    },
    completedNodes: fallback.completedNodes.map((node) => ({
      nodeId: node.nodeId,
      outputRef: node.outputRef,
      trusted: node.trusted,
      output: node.output,
    })),
    evidenceRefs: [...fallback.evidenceRefs],
    remainingBudget: { ...fallback.remainingBudget },
  };
}

/**
 * Create the local workflow runtime.
 *
 * ```ts
 * const runtime = createWorkflowRuntime({ registry, agentRuntime, decisionEngine });
 * const result = await runtime.run(compiled, job, context);
 * // or, to drive it through the existing harness:
 * const harness = createHarness({ agentRuntime: runtime.asAgentRuntime(compiled), trace, storage });
 * ```
 *
 * The runtime holds no state between runs: it is a closure over its ports, and
 * everything a run mutates lives in a `RunState` that `run()` creates.
 */
export function createWorkflowRuntime(options: CreateWorkflowRuntimeOptions): WorkflowRuntime {
  const { registry, agentRuntime, decisionEngine } = options;
  const artifacts = options.artifacts ?? createInMemoryArtifactStore();
  const effects = options.effects ?? createInMemoryProtectedEffectStore();
  const clock = options.clock ?? SYSTEM_CLOCK;
  const sleep = options.sleep ?? defaultSleep;

  /** Milliseconds since the epoch, from the injected clock. */
  const nowMs = (): number => clock.now().getTime();

  /** The binding scope for a node at `scope`. */
  const bindingScope = (state: RunState, scope: ExecScope): BindingScope => ({
    input: state.job.input,
    nodes: state.outputs,
    ...(scope.item === undefined ? {} : { item: scope.item }),
  });

  /** The usage a run reports, in `AgentExecutionUsage`'s four dimensions. */
  const usageOf = (state: RunState): AgentExecutionUsage => {
    const totals = state.ledger.totals();

    return {
      modelCalls: totals.modelCalls,
      toolCalls: totals.toolCalls,
      durationMs: Math.max(0, nowMs() - state.startedAtMs),
      ...(totals.costUsd === null ? {} : { costUsd: totals.costUsd }),
    };
  };

  /** Build the fallback envelope for an escalation. */
  const fallbackFor = (state: RunState, escalation: Escalation): FallbackContext => {
    // One entry per node, not per execution: a `map` body or a `loop` body runs
    // many times, and the agent cares which nodes established something rather
    // than how many attempts it took. The last completed execution of a node
    // wins, because that is the output run state is holding.
    const completed = new Map<
      NodeId,
      { readonly outputRef: string; readonly trusted: boolean; readonly output: JsonValue | null }
    >();
    // Every artifact this run stored, in save order and deduplicated. An
    // `artifact` node's validated output is `{ artifactId, name, … }`, so the
    // references are read off the records rather than invented: an invented
    // reference would be worse than none, because the agent would follow it.
    const evidence = new Set<string>();

    for (const record of state.records) {
      if (record.status !== "completed") {
        continue;
      }

      const node = state.definition.nodes[record.nodeId];

      // An `escalate` node "completes" — it ran, and its span closed — but it
      // produces a `FallbackContext` rather than a value, so it has no output
      // for `outputRef` to point at. Listing it would hand the agent a
      // reference that resolves to nothing, which is the one thing worse than
      // omitting it.
      if (node?.type === "escalate") {
        continue;
      }

      completed.set(record.nodeId, {
        outputRef: `node:${record.nodeId}`,
        trusted: node !== undefined && isTrustedNode(node),
        // **The interpreter leaves this null and the router fills it**
        // (ADR-0044). The value is on the record this loop is reading, but
        // carrying it here would put every node output inside the
        // `WorkflowError.details` that `asAgentRuntime()` builds, where nothing
        // reads it and a trace has to store it. The router is the only caller
        // that has an agent to hand it to, and it is where the size budget is
        // applied.
        output: null,
      });

      if (node?.type === "artifact") {
        const artifactId = readArtifactId(record.output);

        if (artifactId !== null) {
          evidence.add(`artifact:${artifactId}`);
        }
      }
    }

    return {
      reason: escalation.fallbackReason,
      detail: escalation.detail,
      nodeId: escalation.nodeId,
      workflow: {
        id: state.definition.id,
        version: state.definition.version,
        fingerprint: state.workflow.fingerprint,
      },
      completedNodes: [...completed].map(([nodeId, entry]) => ({ nodeId, ...entry })),
      evidenceRefs: [...evidence],
      remainingBudget: state.ledger.remaining(nowMs()),
    };
  };

  /** Resolve a node's input or output schema from the registry. */
  const schemaFor = (node: WorkflowNode, side: "inputSchema" | "outputSchema"): Schema<unknown> =>
    resolveCapability<Schema<unknown>>(registry, "schema", node[side], node.id);

  /** Resolve a registered function capability. */
  const functionFor = (
    kind: "tool" | "handler" | "policy",
    ref: NodeCapabilityRef,
    nodeId: NodeId,
  ): CapabilityFunction => resolveCapability<CapabilityFunction>(registry, kind, ref, nodeId);

  /** Execute a `code` node: a pure handler, called with its input and nothing else. */
  const executeCode = async (node: CodeNode, input: unknown): Promise<unknown> => {
    // M4-T8: "a `code` node does not inherit agent tools". The handler receives
    // exactly one argument — its validated input. No context, no registry, no
    // tool table, no signal: there is nothing for it to reach through, which is
    // a stronger statement than a grant list it is trusted to respect.
    const handler = functionFor("handler", node.handler, node.id);

    return await handler(input);
  };

  /** Execute a `call` node: grants, protection, the tool, and its trace span. */
  const executeCall = async (
    state: RunState,
    node: CallNode,
    input: unknown,
    parentSpanId: TraceEventId,
    itemIndex: number | null,
  ): Promise<unknown> => {
    // M4-T8, before anything else and before any `tool.*` event exists: a denied
    // call leaves a record of being refused, never of being attempted.
    assertToolGranted(node.id, node.permissions, node.tool.id, requiredMode(node.effect));

    const coordinates = {
      runId: state.context.runId,
      workflow: state.definition,
      nodeId: node.id,
      itemIndex,
    };
    // M4-T7: the *logical* key, without the attempt, because protection has to
    // recognise a retry of the same logical execution. See `idempotency.ts`.
    const protectionKey =
      node.protection === undefined ? null : protectionIdempotencyKey(coordinates);
    const identity = {
      toolId: node.tool.id,
      toolVersion: node.tool.version,
      effect: node.effect,
      protected: protectionKey !== null,
      ...(protectionKey === null ? {} : { idempotencyKey: protectionKey }),
    };

    if (protectionKey !== null) {
      const recorded = await effects.get(protectionKey);

      if (recorded !== undefined) {
        // The side effect already happened, so the tool is not called and **no
        // tool call is charged**: counting a call that did not happen would make
        // the ledger and the world disagree, which is the thing protection
        // exists to prevent. The span is still recorded, with `replayed: true`,
        // because a reader of the trace needs to see that protection fired.
        const replay = await state.recorder.span({
          type: "tool.started",
          node: node.id,
          parentId: parentSpanId,
          payload: { ...identity, replayed: true },
        });

        await replay.end({
          type: "tool.completed",
          node: node.id,
          payload: { ...identity, replayed: true },
          usage: { toolCalls: 0 },
        });

        return recorded.value;
      }
    }

    const tool = functionFor("tool", node.tool, node.id);

    state.ledger.chargeToolCalls(1);

    const span = await state.recorder.span({
      type: "tool.started",
      node: node.id,
      parentId: parentSpanId,
      payload: identity,
    });

    let output: unknown;

    try {
      output = await tool(input);
    } catch (cause) {
      const error = new ToolExecutionError(`node \`${node.id}\`: tool \`${node.tool.id}\` failed`, {
        cause,
        toolId: node.tool.id,
        details: { nodeId: node.id },
      });

      await span.end({
        type: "tool.failed",
        node: node.id,
        payload: identity,
        error: serializeError(error),
      });

      throw error;
    }

    // Recorded **before** the output is validated and before the node's span
    // closes. The store answers "did this side effect happen?", and by this
    // point it has; a later validation failure must not be able to make the
    // runtime do it again.
    if (protectionKey !== null) {
      await effects.set(protectionKey, { value: output });
    }

    await span.end({
      type: "tool.completed",
      node: node.id,
      payload: identity,
      usage: { toolCalls: 1 },
    });

    return output;
  };

  /** Execute a `jev` node through the decision port, with its `decision.*` span. */
  const executeJev = async (
    state: RunState,
    node: JevNode,
    input: unknown,
    parentSpanId: TraceEventId,
  ): Promise<unknown> => {
    if (decisionEngine === undefined) {
      throw new DecisionError(
        `node \`${node.id}\`: a \`jev\` node needs a decision engine, and this runtime was created without one`,
        { details: { nodeId: node.id, question: formatCapabilityRef(node.question) } },
      );
    }

    // A judgment costs a model call. The port reports no usage of its own in M4
    // — M3 owns what a decision costs — so one call is the honest floor rather
    // than a guess at tokens or spend.
    state.ledger.chargeModelCalls(1);

    const identity = {
      questionId: node.question.id,
      questionVersion: node.question.version,
      questionKind: node.questionKind,
    };
    const span = await state.recorder.span({
      type: "decision.started",
      node: node.id,
      parentId: parentSpanId,
      payload: identity,
    });

    let answer: JsonValue;

    // Before the call, not after it: a decision that throws was still asked
    // for. See `RunState.jevCalls`.
    state.jevCalls += 1;

    try {
      answer = await decisionEngine.decide({
        node,
        input: asJsonValue(input, node.id, "input"),
        context: state.context,
      });
    } catch (cause) {
      const error =
        cause instanceof DecisionError
          ? cause
          : new DecisionError(
              `node \`${node.id}\`: the decision engine could not answer question \`${formatCapabilityRef(node.question)}\``,
              { cause, details: { nodeId: node.id } },
            );

      await span.end({
        type: "decision.failed",
        node: node.id,
        payload: identity,
        error: serializeError(error),
      });

      throw error;
    }

    await span.end({
      type: "decision.completed",
      node: node.id,
      payload: identity,
      usage: { modelCalls: 1 },
    });

    return answer;
  };

  /** Execute an `agent` node: a sub-run under the node's own grants and budget. */
  const executeAgent = async (
    state: RunState,
    node: AgentNode,
    input: unknown,
    combined: AbortSignal,
  ): Promise<unknown> => {
    if (agentRuntime === undefined) {
      throw new WorkflowError(
        `node \`${node.id}\`: an \`agent\` node needs an agent runtime, and this runtime was created without one`,
        { details: { nodeId: node.id, agent: formatCapabilityRef(node.agent) } },
      );
    }

    const budget = narrowBudget(state.ledger.remaining(nowMs()), node.budget);
    // The job the sub-agent sees is this job, narrowed to this node: its input
    // is the node's, its contracts are the node's schemas, and its permissions
    // and budget are the node's. Its **id and domain are unchanged**, because it
    // is the same unit of work being advanced rather than a new one.
    const derivedJob: Job = {
      ...state.job,
      input,
      contracts: {
        ...state.job.contracts,
        inputSchema: node.inputSchema,
        outputSchema: node.outputSchema,
      },
      permissions: node.permissions,
      budget,
    };
    // The **same recorder**, so the sub-run's `agent.*`, `model.*` and `tool.*`
    // events share this run's single sequence (ADR-0031) instead of starting a
    // second order beside it.
    const derived = createExecutionContext({
      runId: state.context.runId,
      jobId: state.context.jobId,
      domain: state.context.domain,
      attempt: state.context.attempt,
      budget,
      // M4-T8: "an `agent` node receives only its granted tools". This list, and
      // not the job's, is what the adapter enforces against.
      permissions: node.permissions,
      recorder: state.recorder,
      signal: combined,
    });

    // The runtime emits **no `agent.*` events of its own here**. Every
    // `AgentRuntime` implementation already opens its own `agent.started` span
    // and closes it (`EveAgentRuntime` does, and so does
    // `createFakeAgentRuntime()`), so emitting a second pair would double-count
    // the taxonomy's own accounting. The cost is that the adapter parents its
    // span on `recorder.rootId` rather than on this node's span, because it has
    // no way to know it is inside a node; the events still carry the run's order
    // and the node span brackets them in time. ADR-0040 records it.
    const execution: AgentExecution<unknown> = await agentRuntime.run(derivedJob, derived);

    state.ledger.chargeModelCalls(execution.usage.modelCalls);
    state.ledger.chargeToolCalls(execution.usage.toolCalls);

    if (execution.usage.costUsd !== undefined) {
      state.ledger.chargeCost(execution.usage.costUsd);
    }

    if (execution.status === "aborted") {
      throw new RunAborted();
    }

    if (execution.status === "failed") {
      throw new AgentExecutionError(
        `node \`${node.id}\`: agent \`${formatCapabilityRef(node.agent)}\` reported a failed execution`,
        { details: { nodeId: node.id, agentError: execution.error } },
      );
    }

    return execution.output;
  };

  /** Execute an `artifact` node: store the input, output the reference. */
  const executeArtifact = async (
    state: RunState,
    node: ArtifactNode,
    input: unknown,
    parentSpanId: TraceEventId,
  ): Promise<unknown> => {
    const { artifactId } = await artifacts.save({
      runId: state.context.runId,
      nodeId: node.id,
      name: node.name,
      ...(node.contentType === undefined ? {} : { contentType: node.contentType }),
      value: asJsonValue(input, node.id, "input"),
    });

    const reference = {
      artifactId,
      name: node.name,
      ...(node.contentType === undefined ? {} : { contentType: node.contentType }),
    };

    // A record rather than a span: the taxonomy has `artifact.created` and no
    // `artifact.completed`, because storing an artifact is an event, not an
    // interval.
    await state.recorder.record({
      type: "artifact.created",
      node: node.id,
      parentId: parentSpanId,
      payload: reference,
    });

    return reference;
  };

  /** Read a `branch`'s label out of its input, or out of a registered policy. */
  const branchLabel = async (node: BranchNode, input: unknown): Promise<string> => {
    // `on.path` is a list of object keys over the node's validated input, the
    // same grammar `Binding.path` uses; the policy form is AD-009's separation,
    // where a `jev` node produces judgment and a versioned **policy** turns it
    // into a decision, so a threshold can move without the question changing.
    const label =
      node.on.kind === "field"
        ? readPath(input, node.on.path)
        : await functionFor("policy", node.on.policy, node.id)(input);

    if (typeof label !== "string") {
      throw new WorkflowError(
        `node \`${node.id}\`: its branch selector produced ${label === null ? "null" : typeof label} rather than a string label`,
        { details: { nodeId: node.id, selector: node.on.kind } },
      );
    }

    return label;
  };

  /** Whether a `loop`'s `until` condition holds for the body's latest output. */
  const loopSatisfied = async (node: LoopNode, bodyOutput: unknown): Promise<boolean> => {
    if (node.until.kind === "policy") {
      return (await functionFor("policy", node.until.policy, node.id)(bodyOutput)) === true;
    }

    const value = readPath(bodyOutput, node.until.path);

    // Compared as canonical JSON text rather than by `===`, because
    // `LoopUntilField.equals` is a whole `JsonValue` and may be an object or an
    // array. `JSON.stringify` is exact for the scalars that matter and
    // structural for the rest; key order is fixed by the IR being frozen, so two
    // runs of the same workflow compare the same way.
    return JSON.stringify(value ?? null) === JSON.stringify(node.until.equals);
  };

  /** Run `count` items with at most `limit` in flight, preserving result order. */
  const mapBounded = async <TValue>(
    count: number,
    limit: number,
    work: (index: number) => Promise<TValue>,
  ): Promise<TValue[]> => {
    const results = new Array<TValue>(count);
    let next = 0;

    const worker = async (): Promise<void> => {
      for (;;) {
        const index = next;

        next += 1;

        if (index >= count) {
          return;
        }

        results[index] = await work(index);
      }
    };

    const lanes = Math.max(1, Math.min(limit, count));

    await Promise.all(Array.from({ length: lanes }, () => worker()));

    return results;
  };

  /** `chain`: a fixed sequence of sub-graphs; the chain's output is the last one's. */
  const runChain = async (state: RunState, node: ChainNode, scope: ExecScope): Promise<unknown> => {
    let last: unknown;

    for (const step of node.steps) {
      last = await runSegment(state, step, scope);
    }

    return last;
  };

  /** `map`: a bounded fan-out over an array, one sub-graph run per element. */
  const runMap = async (
    state: RunState,
    node: MapNode,
    scope: ExecScope,
    span: TraceSpan,
  ): Promise<unknown> => {
    const items = evaluateBinding(node.items, bindingScope(state, scope), node.id);

    if (!Array.isArray(items)) {
      throw new WorkflowError(
        `node \`${node.id}\`: its \`items\` binding produced ${items === null ? "null" : typeof items} rather than an array`,
        { details: { nodeId: node.id } },
      );
    }

    if (items.length > node.maxItems) {
      // The bound is the guarantee, so exceeding it is a failure rather than a
      // silent truncation: quietly processing the first `maxItems` elements
      // would produce a result that looks complete and is not.
      throw new WorkflowError(
        `node \`${node.id}\`: its \`items\` binding produced ${items.length} elements, above its \`maxItems\` of ${node.maxItems}`,
        { details: { nodeId: node.id, items: items.length, maxItems: node.maxItems } },
      );
    }

    return await mapBounded(items.length, node.concurrency ?? 1, (index) =>
      runSegment(state, node.body, {
        parentSpanId: span.id,
        item: { value: items[index], index },
      }),
    );
  };

  /** `reduce`: fold an array with a registered handler, from `initial`. */
  const runReduce = async (
    state: RunState,
    node: ReduceNode,
    scope: ExecScope,
  ): Promise<unknown> => {
    const items = evaluateBinding(node.items, bindingScope(state, scope), node.id);

    if (!Array.isArray(items)) {
      throw new WorkflowError(
        `node \`${node.id}\`: its \`items\` binding produced ${items === null ? "null" : typeof items} rather than an array`,
        { details: { nodeId: node.id } },
      );
    }

    const handler = functionFor("handler", node.handler, node.id);
    let accumulator: unknown = node.initial;

    for (const item of items) {
      accumulator = await handler(accumulator, item);
    }

    return accumulator;
  };

  /** `loop`: run the body until `until` holds, or fail at `maxIterations`. */
  const runLoop = async (state: RunState, node: LoopNode, scope: ExecScope): Promise<unknown> => {
    let last: unknown;

    for (let iteration = 0; iteration < node.maxIterations; iteration += 1) {
      last = await runSegment(state, node.body, scope);

      if (await loopSatisfied(node, last)) {
        return last;
      }
    }

    // `until` is the intent and `maxIterations` is the guarantee
    // (`docs/contracts/workflow-ir.md`). A loop that reached the bound without
    // satisfying its condition did not finish its work, so reporting the last
    // iteration as the answer would be a success the workflow never earned.
    throw new WorkflowError(
      `node \`${node.id}\`: its bounded loop reached ${node.maxIterations} iterations without satisfying \`until\``,
      { details: { nodeId: node.id, maxIterations: node.maxIterations } },
    );
  };

  /**
   * Execute one node, whatever its type, and say where control goes next.
   *
   * Everything this calls is per-type; everything that calls it — validation,
   * the span, the timeout, the retry loop — is shared, which is what makes
   * "every node validates inputs and outputs" a property of the interpreter
   * rather than of eleven implementations remembering to do it.
   */
  const executeNode = async (
    state: RunState,
    node: WorkflowNode,
    input: unknown,
    scope: ExecScope,
    span: TraceSpan,
    combined: AbortSignal,
  ): Promise<NodeOutcome> => {
    const itemIndex = scope.item?.index ?? null;
    // A container's children hang off the container's own node span, and inherit
    // its `map` element if it has one, so a nested `chain` inside a `map` body
    // still sees `{ kind: "item" }`.
    const childScope: ExecScope = {
      parentSpanId: span.id,
      ...(scope.item === undefined ? {} : { item: scope.item }),
    };

    switch (node.type) {
      case "code":
        return { kind: "output", output: await executeCode(node, input), next: node.next };

      case "call":
        return {
          kind: "output",
          output: await executeCall(state, node, input, span.id, itemIndex),
          next: node.next,
        };

      case "jev":
        return {
          kind: "output",
          output: await executeJev(state, node, input, span.id),
          next: node.next,
        };

      case "agent":
        return {
          kind: "output",
          output: await executeAgent(state, node, input, combined),
          next: node.next,
        };

      case "artifact":
        return {
          kind: "output",
          output: await executeArtifact(state, node, input, span.id),
          next: node.next,
        };

      case "escalate":
        // Terminal by design, and not a failure: the author wrote this branch to
        // give up. Its `reason` is static prose for a human, which is why it is
        // not a `FallbackReason`; the runtime chooses `escalate-node` for that.
        return { kind: "escalate", reason: node.reason };

      case "chain":
        return { kind: "output", output: await runChain(state, node, childScope), next: node.next };

      case "branch": {
        const label = await branchLabel(node, input);
        const target = node.cases[label] ?? node.default;

        if (target === undefined) {
          throw new WorkflowError(
            `node \`${node.id}\`: its selector produced label \`${label}\`, which has no case and no default`,
            { details: { nodeId: node.id, label } },
          );
        }

        // A `branch` carries no `next`: the chosen case target *is* the
        // continuation of the top-level graph, which is what lets one case
        // escalate while another carries on.
        //
        // **A `branch` is pass-through**: it routes rather than computes, so its
        // output is the value it routed, unchanged. That is why the validator
        // requires a `branch`'s `outputSchema` to be its own `inputSchema`, and
        // it is what lets the node after a branch bind the branch's output and
        // receive the thing being decided about rather than a wrapper around a
        // label. The label itself goes into the trace payload, which is the only
        // place it is needed.
        return { kind: "output", output: input, next: target, route: { label, target } };
      }

      case "map":
        return {
          kind: "output",
          output: await runMap(state, node, scope, span),
          next: node.next,
        };

      case "reduce":
        return { kind: "output", output: await runReduce(state, node, scope), next: node.next };

      case "loop":
        return { kind: "output", output: await runLoop(state, node, childScope), next: node.next };
    }
  };

  /**
   * Run one node to completion, retrying per its `retry` policy.
   *
   * The order inside an attempt is build plan M4-T6's list, and it is the same
   * for every node type: evaluate the binding, open the span, validate the
   * input, execute under the deadline, validate the output, close the span.
   */
  const runNode = async (
    state: RunState,
    node: WorkflowNode,
    scope: ExecScope,
  ): Promise<NodeOutcome> => {
    // M4-T8, for every node type and before any attempt: a workflow may not
    // widen what the job was allowed to do.
    assertGrantsWithinJob(node, state.job.permissions);

    const itemIndex = scope.item?.index ?? null;
    const coordinates = {
      runId: state.context.runId,
      workflow: state.definition,
      nodeId: node.id,
      itemIndex,
    };
    const nodeStartedAtMs = nowMs();
    let attempt = 0;
    let lastCause: unknown;
    let lastKey = attemptIdempotencyKey(coordinates, 1);

    while (attempt < node.retry.maxAttempts) {
      attempt += 1;

      if (state.context.signal.aborted) {
        throw new RunAborted();
      }

      const attemptStartedAtMs = nowMs();

      state.ledger.checkDuration(attemptStartedAtMs);
      state.ledger.enter(node.budget, attemptStartedAtMs);

      const idempotencyKey = attemptIdempotencyKey(coordinates, attempt);

      lastKey = idempotencyKey;

      // Evaluated **before** the span opens, so the started event can carry the
      // input. A binding that cannot be evaluated is a graph defect rather than
      // a node failure, so it leaves no node event and fails the run.
      let input: unknown;

      try {
        input = evaluateBinding(node.input, bindingScope(state, scope), node.id);
      } catch (cause) {
        state.ledger.exit();
        throw cause;
      }

      const span = await state.recorder.span({
        type: "node.started",
        node: node.id,
        parentId: scope.parentSpanId,
        payload: {
          nodeId: node.id,
          type: node.type,
          version: node.version,
          attempt,
          idempotencyKey,
          itemIndex,
          // ADR-0031's identity-only rule is amended for `node.*`; see this
          // file's header and ADR-0040.
          input: traceValue(input),
        },
      });

      // Node 24 built-ins, both verified against the installed `@types/node`.
      // `AbortSignal.timeout` is the node's deadline; `AbortSignal.any` folds it
      // together with the run's cancellation so one listener covers both.
      const timeoutSignal = AbortSignal.timeout(node.timeoutMs);
      const combined = AbortSignal.any([state.context.signal, timeoutSignal]);

      try {
        const validInput = await validateWith(schemaFor(node, "inputSchema"), input, {
          label: `node \`${node.id}\` input`,
        });
        const outcome = await withDeadline(
          executeNode(state, node, validInput, scope, span, combined),
          combined,
          state.context.signal,
          node.id,
          node.timeoutMs,
        );

        if (outcome.kind === "escalate") {
          // An `escalate` node has no output to validate — it produces a
          // `FallbackContext`, not a value — so it closes as completed with the
          // author's reason instead of being run through `outputSchema`.
          await span.end({
            type: "node.completed",
            node: node.id,
            payload: {
              nodeId: node.id,
              type: node.type,
              attempt,
              escalated: true,
              escalateReason: outcome.reason,
            },
          });
          state.ledger.exit();
          state.records.push({
            nodeId: node.id,
            type: node.type,
            status: "completed",
            attempts: attempt,
            itemIndex,
            idempotencyKey,
            durationMs: Math.max(0, nowMs() - nodeStartedAtMs),
          });

          return outcome;
        }

        const validOutput = await validateWith(schemaFor(node, "outputSchema"), outcome.output, {
          label: `node \`${node.id}\` output`,
        });

        await span.end({
          type: "node.completed",
          node: node.id,
          payload: {
            nodeId: node.id,
            type: node.type,
            attempt,
            // Only a `branch` sets this, and it is the only place the routing
            // decision is visible: a pass-through branch's output is the value
            // it routed, not the label it chose or the node it chose.
            ...(outcome.route === undefined
              ? {}
              : { label: outcome.route.label, target: outcome.route.target }),
            output: traceValue(validOutput),
          },
        });
        state.ledger.exit();
        state.records.push({
          nodeId: node.id,
          type: node.type,
          status: "completed",
          attempts: attempt,
          itemIndex,
          idempotencyKey,
          durationMs: Math.max(0, nowMs() - nodeStartedAtMs),
          output: validOutput,
        });

        return { kind: "output", output: validOutput, next: outcome.next };
      } catch (cause) {
        state.ledger.exit();

        if (cause instanceof RunAborted) {
          // Not a node failure and not retryable: the run was cancelled, and the
          // span closes saying so rather than claiming the node broke.
          await span.end({
            type: "node.failed",
            node: node.id,
            payload: { nodeId: node.id, type: node.type, attempt, cancelled: true },
            error: serializeError(cause),
          });

          throw cause;
        }

        if (cause instanceof Escalation) {
          // An escalation raised **inside** this node — by a child of a
          // container, or by an `escalate` node in its sub-graph — passes
          // through unchanged. Re-wrapping it would overwrite the reason the
          // node that actually gave up chose, turning a `budget-exceeded` into
          // a `node-failed` one level up, and retrying it would re-run a
          // sub-graph that has already exhausted its own attempts.
          await span.end({
            type: "node.failed",
            node: node.id,
            payload: { nodeId: node.id, type: node.type, attempt, escalated: true },
            error: serializeError(cause),
          });
          state.records.push({
            nodeId: node.id,
            type: node.type,
            status: "failed",
            attempts: attempt,
            itemIndex,
            idempotencyKey,
            durationMs: Math.max(0, nowMs() - nodeStartedAtMs),
            error: serializeError(cause),
          });

          throw cause;
        }

        lastCause = cause;

        // "A failed node is visible in the trace" (a Milestone 4 acceptance
        // criterion): **every** failed attempt closes its own span with
        // `node.failed` and the serialized error, not just the last one.
        await span.end({
          type: "node.failed",
          node: node.id,
          payload: { nodeId: node.id, type: node.type, attempt },
          error: serializeError(cause),
        });

        if (!isRetryable(cause) || attempt >= node.retry.maxAttempts) {
          break;
        }

        const backoffMs = node.retry.backoffMs ?? 0;

        if (backoffMs > 0) {
          await sleep(backoffMs, state.context.signal);
        }
      }
    }

    state.records.push({
      nodeId: node.id,
      type: node.type,
      status: "failed",
      attempts: attempt,
      itemIndex,
      idempotencyKey: lastKey,
      durationMs: Math.max(0, nowMs() - nodeStartedAtMs),
      error: serializeError(lastCause),
    });

    // A node that ran out of attempts hands the job back rather than failing the
    // run. North-star invariant 1: a domain can always fall back to its full
    // agent, and this is the case that exists for.
    throw new Escalation(
      escalationReasonFor(lastCause, node.type),
      node.id,
      `node \`${node.id}\` failed after ${attempt} attempt(s): ${messageOf(lastCause)}`,
    );
  };

  /**
   * Follow edges from `startNodeId` until one ends the segment.
   *
   * One function serves both the top-level graph and every container's
   * sub-graph, which is what makes "a container child's sub-graph ends with
   * `next: null` and control returns to the container" true by construction
   * rather than by special case.
   */
  const runSegment = async (
    state: RunState,
    startNodeId: NodeId,
    scope: ExecScope,
  ): Promise<unknown> => {
    let current: NodeId | null = startNodeId;
    let last: unknown;
    let steps = 0;

    while (current !== null) {
      steps += 1;

      if (steps > MAX_GRAPH_STEPS) {
        throw new WorkflowError(
          `workflow \`${state.definition.id}\`: traversal visited more than ${MAX_GRAPH_STEPS} nodes, which a validated graph cannot do`,
          { details: { workflowId: state.definition.id, entry: startNodeId } },
        );
      }

      const node: WorkflowNode | undefined = state.definition.nodes[current];

      if (node === undefined) {
        throw new WorkflowError(
          `workflow \`${state.definition.id}\`: node \`${current}\` does not exist`,
          { details: { workflowId: state.definition.id, nodeId: current } },
        );
      }

      const outcome = await runNode(state, node, scope);

      if (outcome.kind === "escalate") {
        // The designed exit, not a failure: the author wrote this branch to give
        // up, and `unsupported_case` is what "this graph has no route it can
        // justify for this job" is called (ADR-0044). The node's authored prose
        // becomes the envelope's `detail`, which is why the IR needs no change.
        throw new Escalation("unsupported_case", node.id, outcome.reason);
      }

      state.outputs.set(node.id, outcome.output);
      last = outcome.output;
      current = outcome.next;
    }

    return last;
  };

  const run = async (
    workflow: CompiledWorkflow,
    job: Job,
    context: ExecutionContext,
  ): Promise<WorkflowRunResult> => {
    const startedAtMs = nowMs();
    const state: RunState = {
      workflow,
      definition: workflow.definition,
      job,
      context,
      recorder: context.trace,
      outputs: new Map<NodeId, unknown>(),
      records: [],
      ledger: createBudgetLedger(context.budget, startedAtMs),
      startedAtMs,
      jevCalls: 0,
    };
    const { definition } = state;

    try {
      if (context.signal.aborted) {
        throw new RunAborted();
      }

      // The workflow's own contracts, validated the way a node's are. A job
      // routed to a workflow whose `inputSchema` it does not satisfy is a
      // routing mistake, and escalating is the right answer to one: the full
      // agent can still do the work.
      await validateWith(
        resolveCapability<Schema<unknown>>(
          registry,
          "schema",
          definition.inputSchema,
          definition.id,
        ),
        job.input,
        { label: `workflow \`${definition.id}\` input` },
      );

      const output = await runSegment(state, definition.entry, {
        // The run's root span, so a workflow's node tree hangs off `run.started`
        // when the harness opened one, and off nothing when it did not.
        parentSpanId: context.trace.rootId,
      });
      const validOutput = await validateWith(
        resolveCapability<Schema<unknown>>(
          registry,
          "schema",
          definition.outputSchema,
          definition.id,
        ),
        output,
        { label: `workflow \`${definition.id}\` output` },
      );

      return {
        status: "completed",
        output: validOutput,
        usage: usageOf(state),
        nodes: state.records,
        jevCalls: state.jevCalls,
      };
    } catch (cause) {
      if (cause instanceof RunAborted) {
        return {
          status: "aborted",
          usage: usageOf(state),
          nodes: state.records,
          jevCalls: state.jevCalls,
        };
      }

      const escalation = asEscalation(cause);

      if (escalation === null) {
        // A defect, not a fallback. See `FailedWorkflowRun`.
        return {
          status: "failed",
          error: serializeError(cause),
          usage: usageOf(state),
          nodes: state.records,
          jevCalls: state.jevCalls,
        };
      }

      const fallback = fallbackFor(state, escalation);

      const started = await context.trace.record({
        type: "fallback.started",
        node: escalation.nodeId,
        parentId: context.trace.rootId,
        payload: {
          reason: fallback.reason,
          workflowId: fallback.workflow.id,
          workflowVersion: fallback.workflow.version,
          workflowFingerprint: fallback.workflow.fingerprint,
          nodeId: escalation.nodeId,
          detail: escalation.detail,
          completedNodes: fallback.completedNodes.length,
          // How many of those the agent may build on. The count rather than the
          // list, because the list is the envelope's and a trace payload stays
          // identity-sized (ADR-0031).
          trustedNodes: fallback.completedNodes.filter((node) => node.trusted).length,
          evidenceRefs: fallback.evidenceRefs.length,
        },
      });

      return {
        status: "escalated",
        fallback,
        fallbackSpanId: started.id,
        usage: usageOf(state),
        nodes: state.records,
        jevCalls: state.jevCalls,
      };
    }
  };

  const asAgentRuntime = (workflow: CompiledWorkflow): AgentRuntime => {
    const runtime: RuntimeInfo = {
      name: RUNTIME_NAME,
      version: RUNTIME_VERSION,
      metadata: {
        workflowId: workflow.definition.id,
        workflowVersion: workflow.definition.version,
        workflowFingerprint: workflow.fingerprint,
      },
    };

    return {
      async run<TInput, TOutput>(
        job: Job<TInput, TOutput>,
        context: ExecutionContext,
      ): Promise<AgentExecution<TOutput>> {
        const result = await run(workflow, job as Job, context);

        switch (result.status) {
          case "completed":
            // The one assertion in this file, and the same one
            // `createFakeAgentRuntime()` makes: the interpreter validated the
            // output against the *workflow's* `outputSchema`, but it cannot
            // prove that schema produces the caller's `TOutput`.
            // `createHarness()` re-validates against the *domain's* schema
            // before any caller sees it, which is exactly why that second check
            // exists.
            return {
              status: "completed",
              output: result.output as TOutput,
              usage: result.usage,
              runtime,
              jevCalls: result.jevCalls,
            };

          case "failed":
            return {
              status: "failed",
              error: result.error,
              usage: result.usage,
              runtime,
              jevCalls: result.jevCalls,
            };

          case "aborted":
            return { status: "aborted", usage: result.usage, runtime, jevCalls: result.jevCalls };

          case "escalated": {
            // **This is the standalone mapping, not the fallback path.** M5-T3's
            // `createRouter()` in `@internal/registry` is what actually falls
            // back: it calls `WorkflowRuntime.run()` directly, reads
            // `result.fallback`, and invokes the registered full agent with it
            // (ADR-0044). This method has no full agent to invoke — it presents
            // *one* workflow as an `AgentRuntime` and nothing else — so an
            // escalation it cannot act on is reported as a failure carrying the
            // envelope in a `WorkflowError`'s `details`, where a caller and a
            // trace can both read it. A run driven this way therefore shows
            // `fallback.started` with no `fallback.completed`, which is the
            // honest record of a fallback that had nowhere to go. Prefer the
            // router for anything that should actually fall back.
            const error = new WorkflowError(
              `workflow \`${workflow.definition.id}\`: escalated to the full agent (${result.fallback.reason})`,
              { details: { fallback: fallbackContextPayload(result.fallback) } },
            );

            return {
              status: "failed",
              error: serializeError(error),
              usage: result.usage,
              runtime,
              jevCalls: result.jevCalls,
            };
          }
        }
      },
    };
  };

  return { run, asAgentRuntime };
}

/**
 * The escalation a thrown value represents, or `null` when it is a defect.
 *
 * Three things escalate: an {@link Escalation} thrown by an exhausted node or an
 * `escalate` node, a budget that ran out anywhere, and a failure of the
 * workflow's own input or output contract. Everything else is a defect and fails
 * the run.
 */
function asEscalation(cause: unknown): Escalation | null {
  if (cause instanceof Escalation) {
    return cause;
  }

  if (cause instanceof BudgetExceededError || cause instanceof ValidationError) {
    // No node: the workflow's own input or output contract failed, or a budget
    // ran out between nodes.
    return new Escalation(escalationReasonFor(cause, null), null, cause.message);
  }

  return null;
}

/**
 * The artifact id an `artifact` node's output carries, or `null`.
 *
 * Read defensively rather than cast: the value went through the node's own
 * `outputSchema`, which a domain wrote, so nothing here can prove it kept the
 * shape `executeArtifact` produced.
 */
function readArtifactId(output: unknown): string | null {
  if (typeof output !== "object" || output === null) {
    return null;
  }

  const artifactId: unknown = (output as { readonly artifactId?: unknown }).artifactId;

  return typeof artifactId === "string" && artifactId !== "" ? artifactId : null;
}

/** One readable line from a thrown value, for a fallback envelope's `detail`. */
function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
