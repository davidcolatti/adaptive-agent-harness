import type { CallEffect, NodeId, ToolGrant, ToolGrantMode, WorkflowNode } from "@internal/core";
import { PermissionDeniedError } from "@internal/core";

/**
 * Tool grants (M4-T8): "node permissions are explicit", "an `agent` node
 * receives only its granted tools", "a `code` node does not inherit agent
 * tools".
 *
 * The IR already expresses the rule as data — `permissions` is a per-node field
 * and is never inherited (`docs/contracts/workflow-ir.md`) — so what is left for
 * the runtime is to enforce two things before anything executes:
 *
 * 1. **A node's grants must be a subset of the job's.** A workflow cannot widen
 *    what a job was allowed to do. A node granting a tool the job does not, or
 *    granting `write` where the job granted `read`, is a
 *    {@link PermissionDeniedError} before the node runs.
 * 2. **A `call` node may only call the tool its own grants cover**, at a mode
 *    the call's `effect` requires: `read-only` needs `read`, `idempotent-write`
 *    and `non-idempotent-write` need `write`.
 *
 * Both fail **closed** and both fail **early**: the check happens before the
 * tool is resolved and before any `tool.started` event exists, so a denied call
 * leaves no trace of having been attempted, only of having been refused. That is
 * what makes Milestone 4's "an agent node cannot call an ungranted tool"
 * checkable rather than hoped for, and it is the same "absence of a grant is a
 * denial" rule `PermissionDeniedError` already documents (north-star invariant
 * 7).
 *
 * A `code` node needs no check here: the validator (M4-T4/M4-T9) rejects a
 * `code` node whose `permissions` are non-empty, and the interpreter passes a
 * `code` handler nothing but its input — no context, no registry, no tools.
 */

/** The access a `call` node's `effect` requires of a grant. */
export function requiredMode(effect: CallEffect): ToolGrantMode {
  return effect === "read-only" ? "read" : "write";
}

/**
 * True when `grant` confers at least `mode`.
 *
 * `write` satisfies a `read` request and `read` never satisfies a `write` one,
 * which is exactly what {@link ToolGrantMode} documents: "`read` is strictly
 * weaker: a `read` grant never satisfies a `write` request".
 */
function modeSatisfies(grant: ToolGrantMode, mode: ToolGrantMode): boolean {
  return mode === "read" ? true : grant === "write";
}

/**
 * True when `outer` covers everything `inner` claims.
 *
 * Scope is compared conservatively: an unnarrowed outer grant covers any inner
 * scope, and a narrowed one covers only the identical scope. The alternative —
 * interpreting a scope string — is the tool's job, not the harness's
 * ({@link ToolGrant.scope}: "interpreted by the tool itself"), and guessing at a
 * prefix or a glob rule here would silently widen a grant.
 */
function covers(outer: ToolGrant, inner: ToolGrant): boolean {
  if (outer.toolId !== inner.toolId || !modeSatisfies(outer.mode, inner.mode)) {
    return false;
  }

  return outer.scope === undefined || outer.scope === inner.scope;
}

/**
 * Assert that every grant a node declares is one the job already granted.
 *
 * Called for every node before it executes, whatever its type: a node with no
 * grants passes trivially, so there is one rule rather than a per-type table.
 *
 * @throws {PermissionDeniedError} naming the first grant the job does not cover.
 */
export function assertGrantsWithinJob(
  node: WorkflowNode,
  jobPermissions: readonly ToolGrant[],
): void {
  for (const grant of node.permissions) {
    if (jobPermissions.some((permitted) => covers(permitted, grant))) {
      continue;
    }

    throw new PermissionDeniedError(
      `node \`${node.id}\`: it grants \`${grant.mode}\` on tool \`${grant.toolId}\`, which the job does not grant`,
      {
        toolId: grant.toolId,
        requested: grant.mode,
        details: { nodeId: node.id, nodeType: node.type, scope: grant.scope ?? null },
      },
    );
  }
}

/**
 * Assert that a node's own grants permit calling `toolId` at `mode`.
 *
 * @throws {PermissionDeniedError} when no grant on the node covers the call.
 */
export function assertToolGranted(
  nodeId: NodeId,
  permissions: readonly ToolGrant[],
  toolId: string,
  mode: ToolGrantMode,
): void {
  const granted = permissions.some(
    (grant) => grant.toolId === toolId && modeSatisfies(grant.mode, mode),
  );

  if (granted) {
    return;
  }

  throw new PermissionDeniedError(
    `node \`${nodeId}\`: it may not call tool \`${toolId}\` with \`${mode}\` access, because its own permissions do not grant it`,
    { toolId, requested: mode, details: { nodeId } },
  );
}
