import type {
  Binding,
  NodeId,
  ValidationIssue,
  WorkflowDefinition,
  WorkflowNode,
} from "@internal/core";
import { type GraphAnalysis, type IssuePath, nodeEntries } from "./graph.js";

/**
 * The data-flow rules (M4-T4): where `{ kind: "item" }` may appear, and which
 * nodes a `{ kind: "node" }` binding may read.
 *
 * Parse already knows a binding is *well formed*. What it cannot know is whether
 * the value the binding names will exist when the node runs, because that is a
 * question about the graph. Both rules here are that question:
 *
 * - `item` names the current element, and there is a current element only inside
 *   a `map` body. Anywhere else it would read nothing at all.
 * - `node` names another node's output, and an output exists only if that node
 *   has already run. Requiring the referenced node to **dominate** the reader —
 *   to run on every path to it — is what makes "the output is there" a fact
 *   rather than a hope (ADR-0039).
 */

/** One binding, and the path of the field that declares it, relative to its node. */
export interface BindingSite {
  readonly binding: Binding;
  readonly path: IssuePath;
}

/**
 * Every binding a node declares, including the ones nested inside an `object`
 * binding's fields.
 *
 * A node's `input` always; a `map`'s and a `reduce`'s `items` as well, because
 * those are read in the node's own scope rather than in the body's.
 */
export function nodeBindings(node: WorkflowNode): readonly BindingSite[] {
  const sites: BindingSite[] = [];

  const push = (binding: Binding, path: IssuePath): void => {
    sites.push({ binding, path });

    if (binding.kind === "object") {
      for (const field of Object.keys(binding.fields).sort()) {
        const child = binding.fields[field];
        if (child !== undefined) {
          push(child, [...path, "fields", field]);
        }
      }
    }
  };

  push(node.input, ["input"]);

  if (node.type === "map" || node.type === "reduce") {
    push(node.items, ["items"]);
  }

  return sites;
}

/**
 * Check every binding in the workflow against the graph model.
 *
 * A node the graph pass never assigned to a region is skipped: it is already
 * reported as unreachable, and every binding on it would produce a second issue
 * describing the same mistake.
 */
export function collectBindingIssues(
  definition: WorkflowDefinition,
  graph: GraphAnalysis,
): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const [id, node] of nodeEntries(definition)) {
    const region = graph.regions.get(graph.regionOf.get(id) ?? "");

    if (region === undefined) {
      continue;
    }

    for (const site of nodeBindings(node)) {
      const path: IssuePath = ["nodes", id, ...site.path];

      if (site.binding.kind === "item" && !region.insideMap) {
        issues.push({
          path,
          message:
            '`{ kind: "item" }` is valid only inside a `map` node\'s body, where there is a current element to read',
        });
        continue;
      }

      if (site.binding.kind !== "node") {
        continue;
      }

      const referenced: NodeId = site.binding.node;

      if (definition.nodes[referenced] === undefined) {
        issues.push({
          path: [...path, "node"],
          message: `\`${referenced}\` names no node in \`nodes\``,
        });
        continue;
      }

      if (referenced === id) {
        issues.push({
          path: [...path, "node"],
          message: "a node cannot read its own output; it has not produced one yet",
        });
        continue;
      }

      const dominators = graph.dominators.get(id);

      if (dominators === undefined) {
        continue;
      }

      if (!dominators.has(referenced)) {
        issues.push({
          path: [...path, "node"],
          message: `\`${referenced}\` does not run on every path to \`${id}\`, so its output may not exist; a \`node\` binding must name a node that always runs first`,
        });
      }
    }
  }

  return issues;
}
