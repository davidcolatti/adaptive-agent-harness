import type { NodeId, ValidationIssue, WorkflowDefinition, WorkflowNode } from "@internal/core";

/**
 * The graph model of a workflow (M4-T4) — ownership, reachability, acyclicity
 * and dominance — and the issues it produces.
 *
 * The IR stores nodes in a flat map and control shapes name their sub-graphs by
 * id, so every structural question is a question about one object. This module
 * is what turns that map into the two relations the rest of validation needs:
 *
 * - **which region owns each node**, which is what makes `{ kind: "item" }`
 *   scoping, "a container child's subgraph ends where the container does" and
 *   "a node has exactly one owner" decidable; and
 * - **which nodes are guaranteed to have run before a given node**, which is
 *   what makes a `{ kind: "node" }` binding checkable before anything executes
 *   rather than a run-time `WorkflowError`.
 *
 * ADR-0039 records the model. `docs/contracts/workflow-ir.md` states the rules
 * it enforces in table form.
 */

/** A path into the definition being validated, used for every issue's `path`. */
export type IssuePath = readonly (string | number)[];

/** The id of the region every node reached from `entry` belongs to. */
export const ROOT_REGION = "#root";

/**
 * One region: the top-level graph, or one container child slot and everything
 * its subgraph reaches.
 *
 * A region is the unit of ownership. Its root is either `entry` (the top-level
 * graph) or a node a container names in `steps`, `body`; everything reachable
 * from that root by `next`/`cases`/`default` without leaving the region belongs
 * to it.
 */
export interface Region {
  /** The region's id: {@link ROOT_REGION}, or `` `${container}#${slot}` ``. */
  readonly id: string;
  /** The container that opened it, or `null` for the top-level graph. */
  readonly container: NodeId | null;
  /** The container's slot, e.g. `steps[0]` or `body`. `null` at the top level. */
  readonly slot: string | null;
  /** The region the container itself belongs to, or `null` at the top level. */
  readonly parent: string | null;
  /**
   * True when this region is a `map` body, or lies inside one transitively.
   *
   * This is exactly the scope in which `{ kind: "item" }` has a meaning: there
   * is a current element only inside a `map` body.
   */
  readonly insideMap: boolean;
}

/** One successor edge out of a node: `next`, a `branch` case, or `default`. */
export interface GraphEdge {
  /** The node the edge points at. */
  readonly target: NodeId;
  /** The path of the field that declares it, relative to the node. */
  readonly path: IssuePath;
}

/** One container child: a `chain` step, a `map` body or a `loop` body. */
export interface ContainerChild extends GraphEdge {
  /** The slot the child fills, e.g. `steps[0]` or `body`. */
  readonly slot: string;
}

/** Everything the graph pass established, plus everything it found wrong. */
export interface GraphAnalysis {
  /** Every structural problem, each with the path to the field that caused it. */
  readonly issues: readonly ValidationIssue[];
  /** The region each node belongs to. A node missing here is unreachable. */
  readonly regionOf: ReadonlyMap<NodeId, string>;
  /** Every region, by id. */
  readonly regions: ReadonlyMap<string, Region>;
  /**
   * The nodes that execute on **every** path to each node, including itself.
   *
   * A node missing here was not reachable in the flow graph.
   */
  readonly dominators: ReadonlyMap<NodeId, ReadonlySet<NodeId>>;
  /** Every referenced node id that names nothing in `nodes`. */
  readonly missingTargets: ReadonlySet<string>;
}

/**
 * The successor edges out of a node: where control goes when it finishes.
 *
 * `escalate` is terminal and has none. `branch` has one per case plus its
 * `default`, and no `next` at all. Everything else has exactly `next`, which may
 * be `null` to say the node ends its subgraph. Cases are enumerated in sorted
 * label order so that traversal, and therefore which of two conflicting nodes is
 * reported first, does not depend on object key order.
 */
export function successorEdges(node: WorkflowNode): readonly GraphEdge[] {
  if (node.type === "escalate") {
    return [];
  }

  if (node.type === "branch") {
    const edges: GraphEdge[] = [];

    for (const label of Object.keys(node.cases).sort()) {
      const target = node.cases[label];
      if (target !== undefined) {
        edges.push({ target, path: ["cases", label] });
      }
    }

    if (node.default !== undefined) {
      edges.push({ target: node.default, path: ["default"] });
    }

    return edges;
  }

  return node.next === null ? [] : [{ target: node.next, path: ["next"] }];
}

/**
 * The sub-graphs a node contains: `chain` steps, a `map` body, a `loop` body.
 *
 * `reduce` contains nothing — its per-element work is a registered `handler`,
 * not a node — and `branch` contains nothing either, because its cases are
 * ordinary successor edges that continue the same region.
 */
export function containerChildren(node: WorkflowNode): readonly ContainerChild[] {
  switch (node.type) {
    case "chain":
      return node.steps.map((target, index) => ({
        target,
        slot: `steps[${String(index)}]`,
        path: ["steps", index],
      }));
    case "map":
    case "loop":
      return [{ target: node.body, slot: "body", path: ["body"] }];
    default:
      return [];
  }
}

/**
 * Every node with its id, in sorted id order.
 *
 * Sorted rather than in the definition's own key order, so that the list of
 * issues a workflow produces is a function of the workflow and not of the order
 * its literal happened to be written in. The canonical bytes already have that
 * property (ADR-0029); this gives the error message the same one.
 */
export function nodeEntries(
  definition: WorkflowDefinition,
): readonly (readonly [NodeId, WorkflowNode])[] {
  return Object.keys(definition.nodes)
    .sort()
    .flatMap((id) => {
      const node = definition.nodes[id];
      return node === undefined ? [] : [[id, node] as const];
    });
}

/** The id of the region a container's slot opens. */
function regionId(container: NodeId, slot: string): string {
  return `${container}#${slot}`;
}

/** How a region reads in an error message. */
function describeRegion(region: Region | undefined): string {
  if (region === undefined || region.container === null) {
    return "the top-level graph reached from `entry`";
  }
  return `\`${region.slot}\` of the node \`${region.container}\``;
}

/** One item of the ownership traversal's work queue. */
interface Visit {
  readonly region: string;
  readonly node: NodeId;
  /** `root` claims the node as a region's root; `edge` follows a successor. */
  readonly claim: "root" | "edge";
  /** The node and field the claim came from, for the issue path. `null` at `entry`. */
  readonly from: { readonly node: NodeId; readonly path: IssuePath } | null;
}

/**
 * Every node id a definition references, checked against `nodes`.
 *
 * Run before the traversal so that a missing target is reported once, as itself,
 * rather than as an unreachable node or a silent dead end.
 */
function collectMissingTargets(definition: WorkflowDefinition): {
  readonly issues: readonly ValidationIssue[];
  readonly missing: Set<string>;
} {
  const issues: ValidationIssue[] = [];
  const missing = new Set<string>();

  const check = (target: string, path: IssuePath): void => {
    if (definition.nodes[target] === undefined) {
      missing.add(target);
      issues.push({ path, message: `\`${target}\` names no node in \`nodes\`` });
    }
  };

  check(definition.entry, ["entry"]);

  for (const [id, node] of nodeEntries(definition)) {
    for (const edge of successorEdges(node)) {
      check(edge.target, ["nodes", id, ...edge.path]);
    }
    for (const child of containerChildren(node)) {
      check(child.target, ["nodes", id, ...child.path]);
    }
  }

  return { issues, missing };
}

/**
 * Assign every reachable node to exactly one region, and report every node that
 * has more than one owner or no owner at all.
 *
 * The rule, stated once: **a node has exactly one owner.** It is either reached
 * from `entry` through successor edges, or it is the child of exactly one
 * container — never both, and never two containers. That is what makes
 * `{ kind: "item" }` scoping well defined: "inside a `map` body" is a property
 * of the node, not of the path that happened to reach it.
 *
 * Traversal is breadth-first from `entry`, and a container opens its child
 * regions only when the container itself is reached, so a node that is never
 * assigned is genuinely unreachable rather than merely unvisited.
 */
function assignRegions(
  definition: WorkflowDefinition,
  missing: ReadonlySet<string>,
): {
  readonly issues: readonly ValidationIssue[];
  readonly regionOf: Map<NodeId, string>;
  readonly regions: Map<string, Region>;
} {
  const issues: ValidationIssue[] = [];
  const regionOf = new Map<NodeId, string>();
  const regions = new Map<string, Region>();

  regions.set(ROOT_REGION, {
    id: ROOT_REGION,
    container: null,
    slot: null,
    parent: null,
    insideMap: false,
  });

  if (missing.has(definition.entry)) {
    return { issues, regionOf, regions };
  }

  const queue: Visit[] = [
    { region: ROOT_REGION, node: definition.entry, claim: "root", from: null },
  ];

  while (queue.length > 0) {
    const visit = queue.shift();
    if (visit === undefined) {
      break;
    }

    const existing = regionOf.get(visit.node);

    if (existing !== undefined) {
      if (existing === visit.region && visit.claim === "edge") {
        // An ordinary join inside one region: two branches converging on one
        // continuation. Already expanded, so there is nothing more to do.
        continue;
      }

      const issuePath: IssuePath =
        visit.from === null ? ["entry"] : ["nodes", visit.from.node, ...visit.from.path];
      const owner = regions.get(existing);
      const source = regions.get(visit.region);

      if (visit.claim === "edge" && source?.container != null) {
        issues.push({
          path: issuePath,
          message: `\`${visit.node}\` is owned by ${describeRegion(owner)}; a container child's subgraph must end with \`next: null\` rather than continue into a node it does not own`,
        });
      } else {
        issues.push({
          path: issuePath,
          message: `\`${visit.node}\` is already owned by ${describeRegion(owner)}; a node has exactly one owner, either reached from \`entry\` or the child of exactly one container`,
        });
      }

      continue;
    }

    regionOf.set(visit.node, visit.region);

    const node = definition.nodes[visit.node];
    if (node === undefined) {
      continue;
    }

    const parent = regions.get(visit.region);

    for (const child of containerChildren(node)) {
      if (missing.has(child.target)) {
        continue;
      }

      const id = regionId(visit.node, child.slot);
      regions.set(id, {
        id,
        container: visit.node,
        slot: child.slot,
        parent: visit.region,
        insideMap: (node.type === "map" && child.slot === "body") || (parent?.insideMap ?? false),
      });
      queue.push({
        region: id,
        node: child.target,
        claim: "root",
        from: { node: visit.node, path: child.path },
      });
    }

    for (const edge of successorEdges(node)) {
      if (missing.has(edge.target)) {
        continue;
      }
      queue.push({
        region: visit.region,
        node: edge.target,
        claim: "edge",
        from: { node: visit.node, path: edge.path },
      });
    }
  }

  for (const id of Object.keys(definition.nodes).sort()) {
    if (!regionOf.has(id)) {
      issues.push({
        path: ["nodes", id],
        message:
          "unreachable: no path of edges or containment reaches this node from `entry`; remove it or connect it",
      });
    }
  }

  return { issues, regionOf, regions };
}

/**
 * Report every cycle in the graph of successor edges plus containment.
 *
 * **Any cycle is invalid.** Bounded repetition is expressed by a `map` or `loop`
 * node containing its body, never by an edge pointing backwards, so there is no
 * legitimate back edge to distinguish from an illegitimate one. That is what
 * makes north-star invariant 6, "every loop is bounded", structural rather than
 * a matter of counting.
 */
function collectCycleIssues(
  definition: WorkflowDefinition,
  missing: ReadonlySet<string>,
): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const state = new Map<NodeId, "open" | "closed">();
  const stack: NodeId[] = [];
  const reported = new Set<string>();

  const visit = (id: NodeId): void => {
    const node = definition.nodes[id];
    if (node === undefined) {
      return;
    }

    state.set(id, "open");
    stack.push(id);

    for (const step of [...containerChildren(node), ...successorEdges(node)]) {
      if (missing.has(step.target)) {
        continue;
      }

      const seen = state.get(step.target);

      if (seen === "open") {
        const start = stack.indexOf(step.target);
        const cycle = [...stack.slice(start < 0 ? 0 : start), step.target];
        const key = cycle.join(">");

        if (!reported.has(key)) {
          reported.add(key);
          issues.push({
            path: ["nodes", id, ...step.path],
            message: `cycle ${cycle.map((member) => `\`${member}\``).join(" -> ")}; repetition must be a \`loop\` or \`map\` node, never a back edge`,
          });
        }
      } else if (seen === undefined) {
        visit(step.target);
      }
    }

    state.set(id, "closed");
    stack.pop();
  };

  if (!missing.has(definition.entry)) {
    visit(definition.entry);
  }

  return issues;
}

/**
 * The flow graph dominance is computed over: which node can run immediately
 * after which.
 *
 * It is **not** the edge graph, because containment carries execution too, and
 * the two containers differ in a way that matters:
 *
 * - a `chain` always runs every step, in order, so the chain enters its first
 *   step, each step's terminal nodes lead into the next step, and the last
 *   step's terminals lead into the chain's own `next`. Nothing goes from the
 *   chain straight to its `next`, because nothing skips a chain's steps.
 * - a `map` body may run zero times (an empty collection) and a `loop` body's
 *   `until` condition may stop it, so both lead **both** into their body and
 *   straight on to their `next`. A node after a `map` therefore cannot be told
 *   that a node inside the body ran, which is correct.
 */
function buildFlowGraph(
  definition: WorkflowDefinition,
  regionOf: ReadonlyMap<NodeId, string>,
  missing: ReadonlySet<string>,
): Map<NodeId, NodeId[]> {
  const terminalsByRegion = new Map<string, NodeId[]>();

  for (const [id, region] of regionOf) {
    const node = definition.nodes[id];
    if (node !== undefined && successorEdges(node).length === 0) {
      const terminals = terminalsByRegion.get(region) ?? [];
      terminals.push(id);
      terminalsByRegion.set(region, terminals);
    }
  }

  const flow = new Map<NodeId, NodeId[]>();

  const add = (from: NodeId, to: NodeId): void => {
    if (missing.has(to)) {
      return;
    }
    const targets = flow.get(from) ?? [];
    targets.push(to);
    flow.set(from, targets);
  };

  for (const id of regionOf.keys()) {
    const node = definition.nodes[id];
    if (node === undefined) {
      continue;
    }

    if (node.type === "chain") {
      const first = node.steps[0];
      if (first !== undefined) {
        add(id, first);
      }

      for (let index = 0; index + 1 < node.steps.length; index += 1) {
        const next = node.steps[index + 1];
        if (next === undefined) {
          continue;
        }
        for (const terminal of terminalsByRegion.get(regionId(id, `steps[${String(index)}]`)) ??
          []) {
          add(terminal, next);
        }
      }

      const lastSlot = `steps[${String(node.steps.length - 1)}]`;
      if (node.next !== null) {
        for (const terminal of terminalsByRegion.get(regionId(id, lastSlot)) ?? []) {
          add(terminal, node.next);
        }
      }

      continue;
    }

    for (const child of containerChildren(node)) {
      add(id, child.target);
    }
    for (const edge of successorEdges(node)) {
      add(id, edge.target);
    }
  }

  return flow;
}

/**
 * The dominator sets of the flow graph: for each node, every node that runs on
 * **every** path from `entry` to it, itself included.
 *
 * The standard iterative fixpoint, which is small enough to be obvious and
 * terminates whatever the graph looks like — including a cyclic one, which is
 * reported separately rather than assumed away.
 */
function computeDominators(
  entry: NodeId,
  flow: ReadonlyMap<NodeId, readonly NodeId[]>,
): Map<NodeId, Set<NodeId>> {
  const reachable = new Set<NodeId>();
  const frontier: NodeId[] = [entry];

  while (frontier.length > 0) {
    const current = frontier.shift();
    if (current === undefined || reachable.has(current)) {
      continue;
    }
    reachable.add(current);
    frontier.push(...(flow.get(current) ?? []));
  }

  const predecessors = new Map<NodeId, NodeId[]>();
  for (const from of reachable) {
    for (const to of flow.get(from) ?? []) {
      if (!reachable.has(to)) {
        continue;
      }
      const list = predecessors.get(to) ?? [];
      list.push(from);
      predecessors.set(to, list);
    }
  }

  const dominators = new Map<NodeId, Set<NodeId>>();
  for (const id of reachable) {
    dominators.set(id, id === entry ? new Set([entry]) : new Set(reachable));
  }

  let changed = true;
  while (changed) {
    changed = false;

    for (const id of reachable) {
      if (id === entry) {
        continue;
      }

      const preds = predecessors.get(id) ?? [];
      const next = new Set<NodeId>();

      if (preds.length === 0) {
        next.add(id);
      } else {
        const [first, ...rest] = preds;
        for (const candidate of dominators.get(first as NodeId) ?? []) {
          if (rest.every((pred) => dominators.get(pred)?.has(candidate) === true)) {
            next.add(candidate);
          }
        }
        next.add(id);
      }

      const current = dominators.get(id);
      if (current === undefined || current.size !== next.size) {
        dominators.set(id, next);
        changed = true;
        continue;
      }

      for (const member of next) {
        if (!current.has(member)) {
          dominators.set(id, next);
          changed = true;
          break;
        }
      }
    }
  }

  return dominators;
}

/**
 * Analyze a parsed definition's graph: missing targets, ownership, reachability,
 * acyclicity and dominance, in that order.
 *
 * It never throws. Every problem it finds becomes a {@link ValidationIssue}, and
 * the relations it computed are returned beside them so that the binding and
 * schema rules can be checked against the same model rather than rebuilding it.
 */
export function analyzeGraph(definition: WorkflowDefinition): GraphAnalysis {
  const { issues: missingIssues, missing } = collectMissingTargets(definition);
  const { issues: regionIssues, regionOf, regions } = assignRegions(definition, missing);
  const cycleIssues = collectCycleIssues(definition, missing);

  const flow = buildFlowGraph(definition, regionOf, missing);
  const dominators = missing.has(definition.entry)
    ? new Map<NodeId, Set<NodeId>>()
    : computeDominators(definition.entry, flow);

  return {
    issues: [...missingIssues, ...regionIssues, ...cycleIssues],
    regionOf,
    regions,
    dominators,
    missingTargets: missing,
  };
}
