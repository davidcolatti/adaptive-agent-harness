import type { Binding, JsonValue, NodeId } from "@internal/core";
import { isJsonValue, isPlainObject, WorkflowError } from "@internal/core";

/**
 * Evaluating a node's `input` binding against the run state (M4-T6).
 *
 * `docs/contracts/workflow-ir.md` fixes the model: run state is exactly
 *
 * ```ts
 * { input: <the job's input>, nodes: { [nodeId]: <that node's output> } }
 * ```
 *
 * plus the current element when execution is inside a `map` body, and a
 * `Binding` is a five-case closed union that reads from it. There is no
 * expression language, so this module is a `switch` with no operators, no
 * functions and no conditionals, and that is the whole point: a workflow's data
 * flow is inspectable by reading the IR rather than by interpreting code
 * (north-star invariant 3, AD-013, ADR-0038).
 *
 * Two runtime rules this module adds, both recorded in ADR-0040, because the
 * contract fixes the shape of a binding but not what a *failed* read means:
 *
 * - **Narrowing yields `undefined` rather than failing.** A `path` segment that
 *   is absent, or that is read through something that is not a plain object,
 *   produces `undefined`, and the node's own `inputSchema` is what decides
 *   whether that is acceptable. That keeps schemas the single arbiter of a
 *   node's input — "every node validates inputs and outputs" is a Milestone 4
 *   acceptance criterion — and it makes an optional field behave the way an
 *   author expects instead of crashing a run.
 * - **An `item` binding with no item in scope throws.** That is not a data
 *   problem, it is a graph the validator should have rejected: `{ kind: "item" }`
 *   is defined only inside a `map` body. It surfaces as a {@link WorkflowError}
 *   and makes the run `failed` rather than escalating, because escalating would
 *   hand a broken workflow to the full agent instead of reporting the defect.
 */

/** The current `map` element, when execution is inside a `map` body. */
export interface BindingItem {
  /** The element itself. */
  readonly value: unknown;
  /** Its index in the `map`'s items, counting from 0. */
  readonly index: number;
}

/** Everything a {@link Binding} may read. */
export interface BindingScope {
  /** The job's input, what `{ kind: "input" }` reads. */
  readonly input: unknown;
  /** Every node output recorded so far, what `{ kind: "node" }` reads. */
  readonly nodes: ReadonlyMap<NodeId, unknown>;
  /** The current `map` element, what `{ kind: "item" }` reads. Absent outside a `map` body. */
  readonly item?: BindingItem;
}

/**
 * Narrow `value` by a list of object keys.
 *
 * `path` is a list of keys and nothing else: no wildcards, no indices, no
 * filters (`docs/contracts/workflow-ir.md`). Reading through anything that is
 * not a plain object yields `undefined`, which is the same answer as reading an
 * absent key, so there is one rule rather than two.
 */
export function readPath(value: unknown, path: readonly string[]): unknown {
  let current = value;

  for (const key of path) {
    if (!isPlainObject(current)) {
      return undefined;
    }

    current = current[key];
  }

  return current;
}

/**
 * Evaluate one binding against the run state.
 *
 * @throws {WorkflowError} for an `item` binding outside a `map` body, or a
 * `node` binding naming a node that has not produced an output yet. Both are
 * graph defects the validator is expected to have caught, so they are reported
 * as workflow errors rather than routed around.
 */
export function evaluateBinding(binding: Binding, scope: BindingScope, nodeId: NodeId): unknown {
  switch (binding.kind) {
    case "input":
      return scope.input;

    case "literal":
      return binding.value;

    case "item": {
      if (scope.item === undefined) {
        throw new WorkflowError(
          `node \`${nodeId}\`: an \`item\` binding was evaluated outside a \`map\` body`,
          { details: { nodeId, binding: "item" } },
        );
      }

      return scope.item.value;
    }

    case "node": {
      if (!scope.nodes.has(binding.node)) {
        throw new WorkflowError(
          `node \`${nodeId}\`: its input reads node \`${binding.node}\`, which has not produced an output`,
          { details: { nodeId, reads: binding.node } },
        );
      }

      const output = scope.nodes.get(binding.node);

      return binding.path === undefined ? output : readPath(output, binding.path);
    }

    case "object": {
      const assembled: Record<string, unknown> = {};

      for (const [field, fieldBinding] of Object.entries(binding.fields)) {
        const value = evaluateBinding(fieldBinding, scope, nodeId);

        // An `undefined` field is omitted rather than written, because
        // `undefined` is not a JSON value and `JSON.stringify` would drop the
        // key anyway. Omitting it here makes the in-memory value and its
        // serialized form agree, which matters for a node input that is about
        // to be validated and then written into a trace payload.
        if (value !== undefined) {
          assembled[field] = value;
        }
      }

      return assembled;
    }
  }
}

/**
 * Assert that a value produced by the workflow is JSON, and return it as such.
 *
 * Used where a port's contract is JSON — a decision request, an artifact's
 * stored value, a trace payload — so that the conversion is a **check** rather
 * than a cast. Everything in a workflow is supposed to be JSON already
 * (`docs/contracts/workflow-ir.md`), so this only ever fires on a handler,
 * tool or agent that returned something exotic, which is exactly the case worth
 * reporting rather than silently serializing.
 *
 * @throws {WorkflowError} if `value` is not JSON-representable.
 */
export function asJsonValue(value: unknown, nodeId: NodeId, what: string): JsonValue {
  if (!isJsonValue(value)) {
    throw new WorkflowError(
      `node \`${nodeId}\`: its ${what} is not JSON-representable, so it cannot cross a workflow boundary`,
      { details: { nodeId, what } },
    );
  }

  return value;
}

/**
 * Render a value for a trace payload, never throwing.
 *
 * {@link asJsonValue} is the boundary that refuses a non-JSON value; this is the
 * observer that has to say *something* about one. A trace event must not fail
 * because the thing it is describing was odd, so a non-JSON value becomes a
 * descriptor naming its type rather than the value itself.
 */
export function traceValue(value: unknown): JsonValue {
  if (value === undefined) {
    return null;
  }

  return isJsonValue(value) ? value : { unserializable: typeof value };
}
