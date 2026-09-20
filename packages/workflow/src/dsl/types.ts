import type {
  Budget,
  CallEffect,
  JevQuestionKind,
  JsonValue,
  NodeId,
  NodeProtection,
  RetryPolicy,
  ToolGrant,
  WorkflowDefinition,
} from "@internal/core";

/**
 * The authoring surface of the typed workflow DSL (M4-T5): what a caller writes.
 *
 * Every type here describes *input to the builder*, never the IR. The IR's own
 * types live in `@internal/core` and are what `build()` returns. The two are
 * deliberately different: an option type is permissive where the IR is exact (a
 * capability reference may be written `"vendor.finalize@2.0.0"` or
 * `{ id, version }`), and optional where the IR is total (a node's timeout,
 * retry policy, budget and version all have defaults). Turning the
 * first into the second is the builder's whole job, and ADR-0041 records which
 * defaults it applies and why.
 */

/**
 * A capability reference, in either form the DSL accepts.
 *
 * The string form `id@version` is what a human writes and what `Job.contracts`
 * already uses; the object form is what the IR stores for everything except a
 * schema. `parseCapabilityRefString()` in `@internal/core` is the one parser, so
 * an ill-formed string fails at definition time with the message the rest of the
 * harness already gives.
 */
export type RefInput = string | { readonly id: string; readonly version: string };

/**
 * A `Binding` whose `node` references are narrowed to the ids declared so far.
 *
 * This is the one piece of type-level help the DSL offers, and it is cheap:
 * `TIds` is the union of node ids already added to the enclosing builder, so
 * `{ kind: "node", node: "clasify" }` is a type error at the call site rather
 * than a `ValidationError` at `build()`. It is assignable to the IR's `Binding`
 * in every case, because `NodeId` is `string`.
 *
 * It deliberately does **not** infer schemas. Whether a binding actually
 * produces the shape a node's `inputSchema` promises is a runtime question the
 * validator (M4-T9) and the runtime (M4-T6) answer against the capability
 * registry; a type-level schema system would duplicate that check somewhere it
 * cannot be kept honest.
 */
export type TypedBinding<TIds extends string> =
  | { readonly kind: "input" }
  | { readonly kind: "node"; readonly node: TIds; readonly path?: readonly string[] }
  | { readonly kind: "item" }
  | { readonly kind: "literal"; readonly value: JsonValue }
  | { readonly kind: "object"; readonly fields: { readonly [field: string]: TypedBinding<TIds> } };

/** How a `branch` chooses its label, with the policy reference in either form. */
export type BranchSelectorInput =
  | { readonly kind: "field"; readonly path: readonly string[] }
  | { readonly kind: "policy"; readonly policy: RefInput };

/** How a `loop` decides it is finished, with the policy reference in either form. */
export type LoopConditionInput =
  | { readonly kind: "field"; readonly path: readonly string[]; readonly equals: JsonValue }
  | { readonly kind: "policy"; readonly policy: RefInput };

/**
 * The per-node settings every node type accepts, and the shape of the
 * workflow-level `defaults` block that sets all of them at once.
 *
 * Absent means "use the workflow's default", which in turn falls back to
 * {@link DSL_NODE_DEFAULTS}. There is no way to say "no timeout" or "no
 * version": the IR requires both, and an absent value in the IR would describe
 * a different node.
 */
export interface NodeDefaults {
  /** Wall-clock limit for one attempt, in milliseconds. */
  readonly timeoutMs?: number;
  /** What to do when an attempt fails. */
  readonly retry?: RetryPolicy;
  /** The limits the node must stay inside. `{}` means no node-level limit. */
  readonly budget?: Budget;
  /** The node's own exact `major.minor.patch` version. */
  readonly version?: string;
}

/**
 * The defaults the DSL applies when neither the node nor the workflow's
 * `defaults` block says otherwise.
 *
 * The build plan leaves all five open, so AD-016 requires the choice to be
 * recorded rather than implied; ADR-0041 carries the reasoning. In short: one
 * minute is long enough for an agent node and short enough that a hung node
 * fails rather than hangs; `maxAttempts: 1` means "do not retry", the only safe
 * default for a node whose effect on the world the DSL cannot see; `{}` and `[]`
 * are the IR's own "no node-level limit" and "nothing granted" values; and
 * `1.0.0` is the version a node that has never been replaced is on.
 */
export const DSL_NODE_DEFAULTS = {
  timeoutMs: 60_000,
  retry: { maxAttempts: 1 },
  budget: {},
  permissions: [],
  version: "1.0.0",
} as const satisfies Required<NodeDefaults> & { readonly permissions: readonly ToolGrant[] };

/** The workflow `version` used when {@link WorkflowOptions} omits one. */
export const DSL_WORKFLOW_VERSION_DEFAULT = "1.0.0";

/** What `workflow()` takes. */
export interface WorkflowOptions {
  /** The workflow's stable id, by the identifier rule. */
  readonly id: string;
  /** The workflow's exact version. Defaults to {@link DSL_WORKFLOW_VERSION_DEFAULT}. */
  readonly version?: string;
  /** The domain this workflow belongs to. A plain id, never version-pinned. */
  readonly domain: string;
  /** The job type within that domain this workflow handles. */
  readonly jobType: string;
  /** The schema the workflow's input satisfies. */
  readonly input: RefInput;
  /** The schema the workflow's output satisfies. */
  readonly output: RefInput;
  /** Node settings applied to every node that does not override them. */
  readonly defaults?: NodeDefaults;
}

/** The settings and wiring overrides shared by every node method. */
export interface CommonNodeOptions<TIds extends string> extends NodeDefaults {
  /**
   * Where this node's input comes from.
   *
   * Absent means the builder's default for this position: `{ kind: "input" }`
   * for the workflow's first node, `{ kind: "item" }` for the head of a `map`
   * body, and `{ kind: "node", node: <the preceding node> }` everywhere else,
   * where "preceding" is the enclosing container for the head of a sub-graph.
   * The head of a top-level segment that follows a `branch` or an `escalate`
   * has no unique predecessor, so it MUST state its own binding.
   */
  readonly input?: TypedBinding<TIds>;
  /**
   * The schema this node's input satisfies.
   *
   * Absent means "derive it from the input binding": the workflow's input
   * schema for `{ kind: "input" }`, and the referenced node's output schema for
   * an unnarrowed `{ kind: "node" }`. Any other binding has no derivable schema,
   * and the node must state one.
   */
  readonly inputSchema?: RefInput;
  /**
   * The schema this node's output satisfies.
   *
   * Absent means "derive it": the workflow's output schema for the terminal node
   * of the top-level graph, and the node's own input schema for a `branch` or an
   * `escalate`, neither of which transforms what it is given. Every other node
   * must state one.
   */
  readonly outputSchema?: RefInput;
}

/**
 * The grants an `agent` or a `call` node carries, and the only two node types
 * that may carry any (M4-T8).
 *
 * `permissions` is **deliberately not** part of {@link NodeDefaults}, so it is
 * absent from the workflow-level `defaults` block and from every other node
 * type's options. A default that granted a tool to every node would grant one to
 * a `code` node, and "a `code` node does not inherit agent tools" is the rule
 * M4-T8 exists to state. The validator rejects a non-empty `permissions` on any
 * other type; here it is simply unwritable.
 */
export interface GrantingNodeOptions<TIds extends string> extends CommonNodeOptions<TIds> {
  /**
   * The tools this node may use, and the only ones.
   *
   * Not inherited from the job, from the workflow or from another node.
   */
  readonly permissions?: readonly ToolGrant[];
}

/**
 * `code`: a pure deterministic handler.
 *
 * It takes no `permissions` option, because a `code` node uses no tools and does
 * not inherit an agent's (M4-T8).
 */
export interface CodeNodeOptions<TIds extends string> extends CommonNodeOptions<TIds> {
  /** The registered `handler` capability to run. */
  readonly handler: RefInput;
}

/**
 * `call`: a direct call to a registered external tool (M4-T3, M4-T7, M4-T8).
 *
 * If `permissions` is absent the DSL grants exactly this node's own tool, at the
 * mode its `effect` requires: `read` for a `read-only` call and `write` for
 * either write effect. A `call` node calls one tool by reference, so restating
 * its id in a grant is a transcription step with nothing to decide. State
 * `permissions` explicitly to add a scope or a second grant.
 */
export interface CallNodeOptions<TIds extends string> extends GrantingNodeOptions<TIds> {
  /** The registered `tool` capability to call. */
  readonly tool: RefInput;
  /** What the call does to the world. */
  readonly effect: CallEffect;
  /** How a repeat is made safe. The validator requires it for a non-idempotent write. */
  readonly protection?: NodeProtection;
}

/** `jev`: a bounded probabilistic judgment. The question is M3's, not a capability. */
export interface JevNodeOptions<TIds extends string> extends CommonNodeOptions<TIds> {
  /** The question to ask, by id and exact version. */
  readonly question: RefInput;
  /** The shape of answer expected, so a consuming `branch` can be checked. */
  readonly questionKind: JevQuestionKind;
}

/** `agent`: a registered agent, run with exactly this node's grants (M4-T8). */
export interface AgentNodeOptions<TIds extends string> extends GrantingNodeOptions<TIds> {
  /** The registered `agent` capability to run. */
  readonly agent: RefInput;
}

/** `artifact`: store the input durably and output a reference to it. */
export interface ArtifactNodeOptions<TIds extends string> extends CommonNodeOptions<TIds> {
  /** The artifact's role within this workflow, as an identifier. Not a path. */
  readonly name: string;
  /** The media type of the stored value, when the domain knows it. */
  readonly contentType?: string;
}

/** `escalate`: hand the job back to the full agent. Terminal. */
export interface EscalateNodeOptions<TIds extends string> extends CommonNodeOptions<TIds> {
  /** Why this branch gives up, in one phrase, for a human reading the trace. */
  readonly reason: string;
}

/** `reduce`: fold a list into one value with a registered handler. */
export interface ReduceNodeOptions<TIds extends string> extends CommonNodeOptions<TIds> {
  /** The list to fold. */
  readonly items: TypedBinding<TIds>;
  /** The registered `handler` capability applied to `(accumulator, item)`. */
  readonly handler: RefInput;
  /** The starting accumulator, baked into the workflow. */
  readonly initial: JsonValue;
}

/** The brand key on {@link SubGraphEnd}. Not part of the authoring surface. */
export const SUB_GRAPH_END: unique symbol = Symbol("@internal/workflow:sub-graph-end");

/**
 * The marker a sub-graph callback must return.
 *
 * It exists so that forgetting to terminate a sub-graph is a *type* error rather
 * than a silently dangling edge. Only `.end()`, `.goto()`, `.branch()` and
 * `.escalate()` produce one, and the value carries nothing: the nodes were
 * registered as they were written.
 */
export interface SubGraphEnd {
  /** Discriminates the marker from anything else a callback might return. */
  readonly [SUB_GRAPH_END]: true;
}

/** A sub-graph: a callback that adds nodes to a nested builder and terminates it. */
export type SubGraph<TIds extends string> = (builder: SubGraphBuilder<TIds>) => SubGraphEnd;

/** `chain`: a fixed sequence, each step a container child in its own right. */
export interface ChainNodeOptions<TIds extends string> extends CommonNodeOptions<TIds> {
  /**
   * The steps, in order.
   *
   * Every node the callback adds becomes one entry of `steps`, and each one is
   * terminal (`next: null`), because a chain's steps are *contained* by the
   * chain rather than wired to each other: a step pointed at by both the `steps`
   * list and a sibling's `next` would have two owners, which the IR graph model
   * forbids.
   */
  readonly steps: SubGraph<TIds>;
}

/** `branch`: take one of several labelled paths. No `next`; every case continues the graph. */
export interface BranchNodeOptions<TIds extends string> extends CommonNodeOptions<TIds> {
  /** Where the label comes from. */
  readonly on: BranchSelectorInput;
  /** Label to sub-graph. Non-empty. */
  readonly cases: { readonly [label: string]: SubGraph<TIds> };
  /**
   * Where an unmatched label goes.
   *
   * Required by the DSL, not merely by the validator: a selector can always
   * produce a label nobody enumerated, and the alternative is a run that stops
   * with no successor and no explanation.
   */
  readonly default: SubGraph<TIds>;
}

/** `map`: run a sub-graph once per element of a list, bounded by `maxItems`. */
export interface MapNodeOptions<TIds extends string> extends CommonNodeOptions<TIds> {
  /** The list to iterate. */
  readonly items: TypedBinding<TIds>;
  /** The sub-graph run per element. Inside it, `{ kind: "item" }` is the element. */
  readonly body: SubGraph<TIds>;
  /** The hard upper bound on elements. */
  readonly maxItems: number;
  /** How many elements may be in flight at once. */
  readonly concurrency?: number;
}

/** `loop`: the bounded loop, and the only cycle the IR admits. */
export interface LoopNodeOptions<TIds extends string> extends CommonNodeOptions<TIds> {
  /** The sub-graph run per iteration. */
  readonly body: SubGraph<TIds>;
  /** The hard upper bound on iterations. */
  readonly maxIterations: number;
  /** The intended stopping condition, checked after each iteration. */
  readonly until: LoopConditionInput;
}

/**
 * The top-level builder `workflow()` returns.
 *
 * Nodes are wired into one chain in the order they are added: each node's `next`
 * is the following node, and the last node is terminal. A `branch` and an
 * `escalate` carry no `next`, so they end that chain; a node added after one
 * starts a new segment and must state its own `input` binding, because it has no
 * unique predecessor to derive one from.
 *
 * Every method returns a builder whose id union has grown by the id just added,
 * which is what makes a later `{ kind: "node", node: <id> }` binding
 * typo-checked. The builder is **immutable in appearance only**: the methods
 * mutate shared draft state and return `this`, so a builder value must be used
 * linearly, exactly as a fluent chain does.
 */
export interface WorkflowBuilder<TIds extends string = never> {
  /** Add a `code` node: a pure deterministic handler. */
  code<TId extends string>(id: TId, options: CodeNodeOptions<TIds>): WorkflowBuilder<TIds | TId>;
  /** Add a `call` node: a direct call to a registered external tool. */
  call<TId extends string>(id: TId, options: CallNodeOptions<TIds>): WorkflowBuilder<TIds | TId>;
  /** Add a `jev` node: a bounded probabilistic judgment. */
  jev<TId extends string>(id: TId, options: JevNodeOptions<TIds>): WorkflowBuilder<TIds | TId>;
  /** Add an `agent` node: a registered agent with exactly this node's grants. */
  agent<TId extends string>(id: TId, options: AgentNodeOptions<TIds>): WorkflowBuilder<TIds | TId>;
  /** Add an `artifact` node: store the input durably, output a reference. */
  artifact<TId extends string>(
    id: TId,
    options: ArtifactNodeOptions<TIds>,
  ): WorkflowBuilder<TIds | TId>;
  /** Add an `escalate` node. Terminal, so it ends the current segment. */
  escalate<TId extends string>(
    id: TId,
    options: EscalateNodeOptions<TIds>,
  ): WorkflowBuilder<TIds | TId>;
  /**
   * Add a `chain` node: a fixed sequence of contained steps.
   *
   * Its steps may bind to the chain itself, so the sub-graph sees `TId` in its
   * own id union. The same holds for `branch`, `map` and `loop`.
   */
  chain<TId extends string>(
    id: TId,
    options: ChainNodeOptions<TIds | TId>,
  ): WorkflowBuilder<TIds | TId>;
  /** Add a `branch` node. It has no `next`, so it ends the current segment. */
  branch<TId extends string>(
    id: TId,
    options: BranchNodeOptions<TIds | TId>,
  ): WorkflowBuilder<TIds | TId>;
  /** Add a `map` node: a bounded iteration over a list. */
  map<TId extends string>(
    id: TId,
    options: MapNodeOptions<TIds | TId>,
  ): WorkflowBuilder<TIds | TId>;
  /** Add a `reduce` node: a fold over a list with a registered handler. */
  reduce<TId extends string>(
    id: TId,
    options: ReduceNodeOptions<TIds>,
  ): WorkflowBuilder<TIds | TId>;
  /** Add a `loop` node: the bounded loop. */
  loop<TId extends string>(
    id: TId,
    options: LoopNodeOptions<TIds | TId>,
  ): WorkflowBuilder<TIds | TId>;
  /**
   * Compile to IR and parse it.
   *
   * The returned value has been through `parseWorkflowDefinition()`, so it is
   * shape-valid and deep-frozen. It has **not** been through
   * `compileWorkflow()`: the graph is not validated and no capability is
   * resolved, because the DSL holds no registry and resolution is M4-T9's
   * boundary.
   *
   * @throws {ValidationError} if the workflow is empty, an id is duplicated, a
   * reference names a node that does not exist, or a schema could not be derived
   * and was not stated.
   */
  build(): WorkflowDefinition;
  /**
   * The same IR, **unparsed and unfrozen**.
   *
   * An escape hatch for a test that wants to mutate a field and watch
   * `parseWorkflowDefinition()` reject it. It runs every check `build()` runs
   * except the parse itself, so the value is well wired but not guaranteed
   * shape-valid.
   */
  toIr(): WorkflowDefinition;
}

/**
 * A nested builder: the sub-graph of a branch case, a branch default, a `map`
 * body, a `loop` body or a `chain`'s steps.
 *
 * Its nodes join the same flat node map the top-level builder writes into — the
 * IR has exactly one — so an id used here collides with an id used anywhere
 * else. What differs is the wiring: a sub-graph's nodes are wired to each other
 * and the last one must be terminated explicitly, except in a `chain`'s steps,
 * where each node is a step of its own.
 */
export interface SubGraphBuilder<TIds extends string = never> {
  /** Add a `code` node: a pure deterministic handler. */
  code<TId extends string>(id: TId, options: CodeNodeOptions<TIds>): SubGraphBuilder<TIds | TId>;
  /** Add a `call` node: a direct call to a registered external tool. */
  call<TId extends string>(id: TId, options: CallNodeOptions<TIds>): SubGraphBuilder<TIds | TId>;
  /** Add a `jev` node: a bounded probabilistic judgment. */
  jev<TId extends string>(id: TId, options: JevNodeOptions<TIds>): SubGraphBuilder<TIds | TId>;
  /** Add an `agent` node: a registered agent with exactly this node's grants. */
  agent<TId extends string>(id: TId, options: AgentNodeOptions<TIds>): SubGraphBuilder<TIds | TId>;
  /** Add an `artifact` node: store the input durably, output a reference. */
  artifact<TId extends string>(
    id: TId,
    options: ArtifactNodeOptions<TIds>,
  ): SubGraphBuilder<TIds | TId>;
  /** Add a `chain` node: a fixed sequence of contained steps. */
  chain<TId extends string>(
    id: TId,
    options: ChainNodeOptions<TIds | TId>,
  ): SubGraphBuilder<TIds | TId>;
  /** Add a `map` node: a bounded iteration over a list. */
  map<TId extends string>(
    id: TId,
    options: MapNodeOptions<TIds | TId>,
  ): SubGraphBuilder<TIds | TId>;
  /** Add a `reduce` node: a fold over a list with a registered handler. */
  reduce<TId extends string>(
    id: TId,
    options: ReduceNodeOptions<TIds>,
  ): SubGraphBuilder<TIds | TId>;
  /** Add a `loop` node: the bounded loop. */
  loop<TId extends string>(
    id: TId,
    options: LoopNodeOptions<TIds | TId>,
  ): SubGraphBuilder<TIds | TId>;
  /** Add a `branch` node. A branch has no `next`, so it terminates the sub-graph. */
  branch<TId extends string>(id: TId, options: BranchNodeOptions<TIds | TId>): SubGraphEnd;
  /** Add an `escalate` node. Terminal: the compiled path stops and the agent takes over. */
  escalate<TId extends string>(id: TId, options: EscalateNodeOptions<TIds>): SubGraphEnd;
  /**
   * End the sub-graph here: the last node's `next` becomes `null` and control
   * returns to the container.
   */
  end(): SubGraphEnd;
  /**
   * End the sub-graph by continuing at `target`, a node defined elsewhere in the
   * workflow.
   *
   * This is how several branch cases rejoin: each case ends with
   * `.goto("finalize")` and `finalize` is added once at the top level. The target
   * may be declared later, so it is checked at `build()` rather than here; an
   * unknown id is a `ValidationError` naming it.
   *
   * Valid only in a sub-graph that continues the *top-level* graph, which means
   * a branch case or a branch default. A `map` body, a `loop` body and a `chain`
   * step must return to their container, so `goto` from one is rejected at
   * definition time.
   */
  goto(target: NodeId): SubGraphEnd;
}
