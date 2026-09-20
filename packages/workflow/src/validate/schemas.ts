import type { ValidationIssue, WorkflowDefinition } from "@internal/core";
import { type GraphAnalysis, nodeEntries, ROOT_REGION, successorEdges } from "./graph.js";

/**
 * Schema compatibility between nodes (M4-T4's "incompatible schemas").
 *
 * **Compatibility is reference equality on the `id@version` string, and nothing
 * else.** A schema in this harness is an opaque Standard Schema validator
 * (ADR-0027): the registry holds the validator, not a description of it, and
 * `@internal/core` and `@internal/workflow` declare no schema library, so
 * nothing here can compare two schemas structurally or decide that one is
 * assignable to another. What it can decide, exactly and cheaply, is whether two
 * nodes name the *same* schema capability at the *same* version — which is the
 * check that actually catches the mistake compilation makes, where a node is
 * swapped for another that produces something different.
 *
 * Five pairings are ref-checked, including a `branch`'s own two, which are the
 * same schema because a branch routes rather than computes. The rest are
 * run-time checks, because a reference tells you nothing about them:
 *
 * - a binding with a `path` reads part of a value, and the part has no
 *   registered schema of its own;
 * - a `literal` or an `object` binding builds a value the IR describes
 *   structurally rather than by reference;
 * - an `item` binding reads one element of a collection, and "the element type
 *   of that schema" is not derivable from `id@version`;
 * - a `map`'s output is an array of its body's outputs, and a `reduce`'s and a
 *   `loop`'s outputs come from a handler and from repetition; no registered
 *   schema reference can be derived for any of them.
 *
 * ADR-0039 records the choice and what it deliberately does not catch. The
 * runtime (M4-T6) validates every node's actual input and output against the
 * resolved schema, which is where the remaining cases are caught.
 */
export function collectSchemaIssues(
  definition: WorkflowDefinition,
  graph: GraphAnalysis,
): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const [id, node] of nodeEntries(definition)) {
    const binding = node.input;

    if (binding.kind === "input" && node.inputSchema !== definition.inputSchema) {
      issues.push({
        path: ["nodes", id, "inputSchema"],
        message: `expected \`${definition.inputSchema}\`, the workflow's \`inputSchema\`, because this node's input is the whole job input; got \`${node.inputSchema}\``,
      });
    }

    if (binding.kind === "node" && binding.path === undefined) {
      const source = definition.nodes[binding.node];

      if (source !== undefined && node.inputSchema !== source.outputSchema) {
        issues.push({
          path: ["nodes", id, "inputSchema"],
          message: `expected \`${source.outputSchema}\`, the \`outputSchema\` of \`${binding.node}\`, whose whole output this node reads; got \`${node.inputSchema}\``,
        });
      }
    }

    // A `branch` routes rather than computes: the runtime records its own
    // validated input as its output, so a successor bound to the branch by
    // `{ kind: "node" }` receives the routed value. Its two schemas are
    // therefore the same schema, and a `branch` that declares two different ones
    // is describing a transformation it does not perform.
    if (node.type === "branch" && node.outputSchema !== node.inputSchema) {
      issues.push({
        path: ["nodes", id, "outputSchema"],
        message: `expected \`${node.inputSchema}\`, this node's own \`inputSchema\`, because a \`branch\` is pass-through and outputs the value it routed; got \`${node.outputSchema}\``,
      });
    }

    if (node.type === "chain") {
      const last = node.steps[node.steps.length - 1];
      const step = last === undefined ? undefined : definition.nodes[last];

      if (step !== undefined && node.outputSchema !== step.outputSchema) {
        issues.push({
          path: ["nodes", id, "outputSchema"],
          message: `expected \`${step.outputSchema}\`, the \`outputSchema\` of its last step \`${String(last)}\`, which is what a chain outputs; got \`${node.outputSchema}\``,
        });
      }
    }

    // The workflow's output is the output of whichever top-level node ends the
    // traversal, so every one of them has to produce the declared output.
    // `escalate` is exempt: it produces a `FallbackContext` and hands the job
    // back to the full agent rather than answering it.
    const isTopLevelTerminal =
      graph.regionOf.get(id) === ROOT_REGION && successorEdges(node).length === 0;

    if (
      isTopLevelTerminal &&
      node.type !== "escalate" &&
      node.outputSchema !== definition.outputSchema
    ) {
      issues.push({
        path: ["nodes", id, "outputSchema"],
        message: `expected \`${definition.outputSchema}\`, the workflow's \`outputSchema\`, because this node ends the top-level graph; got \`${node.outputSchema}\``,
      });
    }
  }

  return issues;
}
