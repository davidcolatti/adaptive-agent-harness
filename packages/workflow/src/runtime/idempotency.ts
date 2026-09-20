import type { NodeId, RunId, WorkflowDefinition } from "@internal/core";

/**
 * The two idempotency keys a node execution has (M4-T7).
 *
 * Build plan M4-T7 states one formula, "run + workflow version + node + logical
 * item + attempt", and `docs/contracts/workflow-ir.md` writes it out:
 *
 * ```text
 * ${runId}:${workflowId}@${workflowVersion}:${nodeId}:${itemIndex ?? "-"}:${attempt}
 * ```
 *
 * That key identifies **one attempt**, which is what a trace, a node record and
 * a future durable execution log need: two attempts at the same node are two
 * different executions and must not collide.
 *
 * It is the wrong key for *protection*, and following it there would defeat the
 * point. Protection exists so that retrying a node does not send the same email
 * twice — but a retry is, by definition, a different attempt, so a key
 * containing the attempt number is different on every retry and would never
 * match. What must be stable across the retries of one logical execution is
 * everything *except* the attempt:
 *
 * ```text
 * ${runId}:${workflowId}@${workflowVersion}:${nodeId}:${itemIndex ?? "-"}
 * ```
 *
 * So the runtime derives both, and they are siblings rather than alternatives:
 * {@link attemptIdempotencyKey} is what identifies an execution and
 * {@link protectionIdempotencyKey} is what guards a side effect.
 * `protectionIdempotencyKey(x) + ":" + attempt === attemptIdempotencyKey(x,
 * attempt)`, so one is literally the prefix of the other and a reader of a
 * trace can see the relationship. ADR-0040 records the split.
 *
 * Both parse back unambiguously, because every component is already constrained
 * to contain no `:`: a run id is a UUIDv7, a workflow id and a node id obey the
 * identifier rule which bans `:`, a version is `major.minor.patch`, and the last
 * two are integers.
 */

/** The placeholder an execution with no enclosing `map` uses for its item. */
export const NO_ITEM_INDEX = "-";

/** What both key functions need to know about where an execution sits. */
export interface IdempotencyCoordinates {
  /** The run this execution belongs to. */
  readonly runId: RunId;
  /** The workflow being executed. */
  readonly workflow: WorkflowDefinition;
  /** The node being executed. */
  readonly nodeId: NodeId;
  /**
   * The element's index inside an enclosing `map`, or `null` when there is no
   * enclosing `map`. Rendered as {@link NO_ITEM_INDEX} when `null`.
   */
  readonly itemIndex: number | null;
}

/**
 * The key that identifies one *logical* node execution, stable across retries.
 *
 * This is what a protected `call` node looks a side effect up under (M4-T7), so
 * that attempt 2 of a node finds what attempt 1 already did to the world instead
 * of doing it again.
 */
export function protectionIdempotencyKey(coordinates: IdempotencyCoordinates): string {
  const { runId, workflow, nodeId, itemIndex } = coordinates;
  const item = itemIndex === null ? NO_ITEM_INDEX : String(itemIndex);

  return `${runId}:${workflow.id}@${workflow.version}:${nodeId}:${item}`;
}

/**
 * The key that identifies one *attempt* at a node execution: build plan
 * M4-T7's formula verbatim.
 *
 * It is recorded on the node's `node.started` trace event, so a reader can tell
 * two attempts apart and line an attempt up against whatever it did.
 */
export function attemptIdempotencyKey(
  coordinates: IdempotencyCoordinates,
  attempt: number,
): string {
  return `${protectionIdempotencyKey(coordinates)}:${attempt}`;
}
