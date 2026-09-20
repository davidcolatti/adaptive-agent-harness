import type { CapabilityRegistry, ValidationIssue, WorkflowDefinition } from "@internal/core";
import { collectBindingIssues } from "./bindings.js";
import { collectCapabilityIssues, registeredToolIds } from "./capabilities.js";
import { analyzeGraph } from "./graph.js";
import { collectRuleIssues } from "./rules.js";
import { collectSchemaIssues } from "./schemas.js";

export type { BindingSite } from "./bindings.js";
export { nodeBindings } from "./bindings.js";
export { registeredToolIds } from "./capabilities.js";
export type { ContainerChild, GraphAnalysis, GraphEdge, IssuePath, Region } from "./graph.js";
export { analyzeGraph, containerChildren, ROOT_REGION, successorEdges } from "./graph.js";

/**
 * Every reason a parsed workflow is still not a valid one, in one list.
 *
 * **It never throws for a validation problem**, which is the whole reason it is
 * exported beside `compileWorkflow()`. The typed DSL reports a mistake at the
 * call site that made it, and the run inspector explains a workflow it cannot
 * run; neither wants to catch an exception to read a list. `compileWorkflow()`
 * is this function plus one throw plus canonicalization.
 *
 * It takes a definition that has already been through
 * `parseWorkflowDefinition()`. The shape rules are that function's — unknown
 * fields, malformed references, reserved node types — and repeating them here
 * would mean two implementations of one contract.
 *
 * The passes run in a fixed order, and every pass runs: a workflow with five
 * problems reports five, because fixing them one exception at a time is five
 * compile cycles. The order is what makes the list readable rather than what
 * makes it complete — structural problems first, because an unreachable node or
 * a missing edge target explains most of what follows it.
 *
 * | Pass | Rejects |
 * | --- | --- |
 * | graph | a missing `entry`/edge/containment target; a node with more than one owner; an unreachable node; any cycle |
 * | bindings | `{ kind: "item" }` outside a `map` body; a `{ kind: "node" }` binding on a node that does not always run first |
 * | node rules | tool grants on a node that uses no tools; a `call` without a grant, or a write without a `write` grant, or a grant naming an unregistered tool; a `non-idempotent-write` without protection; a `branch` with no `default`; a workflow with no reachable `escalate` |
 * | schemas | a node reading the job input, or another node's whole output, whose `inputSchema` is not that schema; a `chain` whose `outputSchema` is not its last step's; a top-level terminal node whose `outputSchema` is not the workflow's |
 * | capabilities | any `schema`, `handler`, `tool`, `agent` or `policy` reference that does not resolve at its exact version; a node whose schemas contradict the ones its capability declares |
 */
export function validateWorkflow(
  definition: WorkflowDefinition,
  registry: CapabilityRegistry,
): readonly ValidationIssue[] {
  const graph = analyzeGraph(definition);

  return [
    ...graph.issues,
    ...collectBindingIssues(definition, graph),
    ...collectRuleIssues(definition, graph, registeredToolIds(registry)),
    ...collectSchemaIssues(definition, graph),
    ...collectCapabilityIssues(definition, registry),
  ];
}
