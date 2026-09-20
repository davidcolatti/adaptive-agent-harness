import type { ToolGrant, ValidationIssue, WorkflowDefinition, WorkflowNode } from "@internal/core";
import { type GraphAnalysis, nodeEntries } from "./graph.js";

/**
 * The per-node rules parse deliberately skips (M4-T4, M4-T7, M4-T8), plus the
 * two workflow-level rules about escalation.
 *
 * Parse checks that a node is a well-formed *value*. These are the rules that
 * make it a legitimate *node*: a `code` node that grants tools, a
 * `non-idempotent-write` `call` with no protection, a `branch` with nowhere to
 * send an unenumerated label, and a workflow with no way to fall back are all
 * well-formed values and invalid workflows.
 */

/**
 * The node types that may carry tool grants: exactly the two that use a tool.
 *
 * M4-T8 states one case of this rule ("a `code` node does not inherit agent
 * tools") and the IR generalizes it: `permissions` is a field of every node, so
 * something has to say which nodes it means anything on. An `agent` node's
 * grants are the tools the agent may use; a `call` node's grant is the
 * permission for the tool it calls. Every other type executes a registered
 * handler or policy, asks a question, writes an artifact or routes control, and
 * a grant on one would be permission nothing reads — which is the worst kind of
 * permission to have.
 */
const GRANTING_NODE_TYPES: readonly WorkflowNode["type"][] = ["agent", "call"];

/** The grants declared for one tool id, in declaration order. */
function grantsFor(permissions: readonly ToolGrant[], toolId: string): readonly ToolGrant[] {
  return permissions.filter((grant) => grant.toolId === toolId);
}

/**
 * Check one node's own rules.
 *
 * `registeredToolIds` is every id registered as a `tool` capability, at any
 * version. A grant carries no version — it is permission to use a tool, not a
 * pinned dependency on one — so registration is checked by id alone.
 */
function collectNodeRuleIssues(
  id: string,
  node: WorkflowNode,
  registeredToolIds: ReadonlySet<string>,
): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const at = (...rest: readonly (string | number)[]): readonly (string | number)[] => [
    "nodes",
    id,
    ...rest,
  ];

  if (node.permissions.length > 0 && !GRANTING_NODE_TYPES.includes(node.type)) {
    issues.push({
      path: at("permissions"),
      message:
        node.type === "code"
          ? "a `code` node runs a registered handler and uses no tools, so its `permissions` must be empty; it does not inherit an agent's tools"
          : `a \`${node.type}\` node uses no tools, so its \`permissions\` must be empty; only \`agent\` and \`call\` nodes carry grants`,
    });
  }

  if (node.type === "call") {
    if (node.effect === "non-idempotent-write" && node.protection === undefined) {
      issues.push({
        path: at("protection"),
        message:
          'a `non-idempotent-write` call must declare explicit protection, e.g. `{ kind: "idempotency-key" }`',
      });
    }

    const granted = grantsFor(node.permissions, node.tool.id);

    if (granted.length === 0) {
      issues.push({
        path: at("permissions"),
        message: `no grant for \`${node.tool.id}\`; a \`call\` node must declare permission for the tool it calls`,
      });
    } else if (node.effect !== "read-only" && !granted.some((grant) => grant.mode === "write")) {
      issues.push({
        path: at("permissions"),
        message: `\`${node.tool.id}\` is granted \`read\` but this call's effect is \`${node.effect}\`; a write needs a grant with \`mode: "write"\``,
      });
    }
  }

  // An `agent` node is the one place a grant may name an unregistered tool. A
  // runtime's own framework tools — eve's `load_skill`, for instance — are
  // granted to an agent but are not domain capabilities and are registered
  // nowhere, so requiring registration here would make a legitimate agent
  // unexpressible. A `call` node has no such excuse: it calls exactly one
  // registered tool, by reference, and its grants are about that tool.
  if (node.type === "call") {
    node.permissions.forEach((grant, index) => {
      if (!registeredToolIds.has(grant.toolId)) {
        issues.push({
          path: at("permissions", index, "toolId"),
          message: `no \`tool\` capability \`${grant.toolId}\` is registered; a \`call\` node's grants must resolve`,
        });
      }
    });
  }

  if (node.type === "branch" && node.default === undefined) {
    issues.push({
      path: at("default"),
      message:
        "a `branch` must declare a `default`; a selector can always produce a label nobody enumerated, and the alternative is a run that stops with no successor and no explanation",
    });
  }

  return issues;
}

/**
 * Every node rule, plus the workflow-level requirement that a fallback exists.
 *
 * North-star invariant 1 is "a domain can always fall back to its full agent". A
 * workflow with no reachable `escalate` node has no way to exercise it: every
 * path either succeeds or fails, and a failure is not a fallback. Reachability
 * is what makes the requirement mean something — an `escalate` node nothing
 * points at satisfies the letter of the rule and none of its purpose — and the
 * graph pass already rejects an unreachable node, so this checks the set of
 * nodes it owned.
 */
export function collectRuleIssues(
  definition: WorkflowDefinition,
  graph: GraphAnalysis,
  registeredToolIds: ReadonlySet<string>,
): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const [id, node] of nodeEntries(definition)) {
    issues.push(...collectNodeRuleIssues(id, node, registeredToolIds));
  }

  const hasReachableEscalate = [...graph.regionOf.keys()].some(
    (id) => definition.nodes[id]?.type === "escalate",
  );

  if (!hasReachableEscalate) {
    issues.push({
      path: ["nodes"],
      message:
        "a workflow must contain at least one `escalate` node reachable from `entry`; a domain can always fall back to its full agent",
    });
  }

  return issues;
}
