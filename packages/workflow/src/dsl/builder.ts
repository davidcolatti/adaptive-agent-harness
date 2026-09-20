import {
  type Binding,
  type Budget,
  formatCapabilityRef,
  type NodeId,
  parseCapabilityRefString,
  parseWorkflowDefinition,
  type RetryPolicy,
  type ToolGrant,
  ValidationError,
  type ValidationIssue,
  type WorkflowDefinition,
  type WorkflowNodeType,
} from "@internal/core";
import {
  type AgentNodeOptions,
  type ArtifactNodeOptions,
  type BranchNodeOptions,
  type BranchSelectorInput,
  type CallNodeOptions,
  type ChainNodeOptions,
  type CodeNodeOptions,
  type CommonNodeOptions,
  DSL_NODE_DEFAULTS,
  DSL_WORKFLOW_VERSION_DEFAULT,
  type EscalateNodeOptions,
  type JevNodeOptions,
  type LoopConditionInput,
  type LoopNodeOptions,
  type MapNodeOptions,
  type NodeDefaults,
  type ReduceNodeOptions,
  type RefInput,
  SUB_GRAPH_END,
  type SubGraph,
  type SubGraphBuilder,
  type SubGraphEnd,
  type WorkflowBuilder,
  type WorkflowOptions,
} from "./types.js";

/**
 * The typed workflow DSL (M4-T5): a fluent builder that compiles to workflow IR.
 *
 * AD-007 and ADR-0007 fix the shape of this module — **the public authoring
 * experience is a typed TypeScript DSL, and a serializable IR exists underneath
 * it** — and everything here follows from one consequence of that: the builder
 * is a *front end* with no runtime meaning of its own. It holds drafts, applies
 * defaults, wires edges and emits a `WorkflowDefinition`. Nothing downstream
 * ever sees a builder, which is M4-T5's own rule: "the IR, not builder object
 * identity, is fingerprinted".
 *
 * Three properties hold, and ADR-0041 records why each was chosen:
 *
 * - **`build()` parses.** It returns `parseWorkflowDefinition(ir)`, so a value
 *   that leaves this module is shape-valid and deep-frozen. A builder that could
 *   emit an ill-formed definition would push its own bugs downstream into the
 *   validator, the runtime and the fingerprint.
 * - **Wiring is by construction, not by instruction.** A node's `next` is the
 *   node added after it, its `input` is the preceding node's output, and its
 *   `inputSchema` follows from that binding. The common case is correct without
 *   being stated, and every departure from it is stated explicitly.
 * - **One node has exactly one owner.** The IR's graph model says a node is
 *   either reached by an edge from `entry` or contained by exactly one
 *   container. The DSL cannot express anything else: a sub-graph is a nested
 *   builder callback, and the only way to point at a node another part of the
 *   graph already owns is `.goto()`, which sets an edge rather than taking
 *   ownership.
 *
 * It does **not** resolve capabilities, and must not: `compileWorkflow()` owns
 * that boundary (M4-T9), and this module never imports it. A DSL that resolved
 * references would need a registry at authoring time, which would make a
 * workflow module impossible to import without one.
 */

/** A node reference the builder must check once every node has been declared. */
interface PendingNodeRef {
  /** The node id the author wrote. */
  readonly target: NodeId;
  /** Where it was written, for the issue path. */
  readonly path: readonly (string | number)[];
}

/** One node as the builder holds it, before wiring and schemas are resolved. */
interface Draft {
  readonly id: NodeId;
  readonly type: WorkflowNodeType;
  /** The type-specific fields (`handler`, `cases`, `steps`, ...), already normalized. */
  readonly extra: Record<string, unknown>;
  /** Whether this node type carries a `next` field. False for `branch` and `escalate`. */
  readonly hasNext: boolean;
  /** `undefined` until wiring is closed; then a node id or `null`. */
  next: NodeId | null | undefined;
  /** The binding the author stated, if any. */
  readonly statedInput: Binding | undefined;
  /** The binding this position implies. `undefined` means the author must state one. */
  readonly defaultInput: Binding | undefined;
  readonly statedInputSchema: string | undefined;
  readonly statedOutputSchema: string | undefined;
  /**
   * Whether this node's output schema falls back to its input schema.
   *
   * True for `branch` and `escalate`, the two types that do not transform what
   * they are given: a branch chooses a path and an escalation stops, so making
   * either restate its input's schema would be ceremony.
   */
  readonly passesInputThrough: boolean;
  /**
   * Whether this node belongs to the graph reachable by edges from `entry`.
   *
   * True for the top-level chain **and** for a branch case or default, because
   * `cases` and `default` are edges: a case continues the main graph rather than
   * returning to the branch. False inside a `map` body, a `loop` body and a
   * `chain`'s steps, which are containment and do return to their container.
   * The distinction decides whether a node whose `next` is `null` ends the
   * workflow, and therefore whether its output schema is the workflow's.
   */
  readonly inMainGraph: boolean;
  readonly timeoutMs: number;
  readonly retry: RetryPolicy;
  readonly budget: Budget;
  readonly permissions: readonly ToolGrant[];
  readonly version: string;
}

/** Everything one `workflow()` call accumulates, shared by every nested builder. */
interface BuilderState {
  readonly workflowId: string;
  readonly workflowVersion: string;
  readonly domain: string;
  readonly jobType: string;
  readonly inputSchema: string;
  readonly outputSchema: string;
  readonly defaults: Required<NodeDefaults>;
  readonly drafts: Map<NodeId, Draft>;
  /** Registration order, which fixes `entry` and keeps the emitted IR stable. */
  readonly order: NodeId[];
  /** Node references written by the author, checked once every node exists. */
  readonly pendingRefs: PendingNodeRef[];
  /** The top-level node whose `next` is still open, if any. */
  openTail: NodeId | undefined;
  /** The first node added, which becomes `entry`. */
  entry: NodeId | undefined;
}

/** Throw a `ValidationError` naming the workflow being built. */
function fail(state: BuilderState, message: string, issues: readonly ValidationIssue[]): never {
  throw new ValidationError(`workflow \`${state.workflowId}\`: ${message}`, { issues });
}

/** Normalize a capability reference written in either accepted form. */
function toRef(value: RefInput): { readonly id: string; readonly version: string } {
  return typeof value === "string"
    ? parseCapabilityRefString(value)
    : parseCapabilityRefString(formatCapabilityRef(value));
}

/** Normalize a schema reference to the `id@version` string the IR stores. */
function toSchemaRef(value: RefInput): string {
  return formatCapabilityRef(toRef(value));
}

/**
 * Rebuild a binding as exactly one of the IR's five cases.
 *
 * Reconstructed rather than passed through, so that the emitted IR is the DSL's
 * own value: two builds of the same workflow are deep-equal whatever the author
 * later does with their literals, and a `path` array is never shared between a
 * caller's object and a frozen definition.
 */
function toBinding(binding: Binding): Binding {
  switch (binding.kind) {
    case "input":
      return { kind: "input" };
    case "item":
      return { kind: "item" };
    case "literal":
      return { kind: "literal", value: binding.value };
    case "node":
      return binding.path === undefined
        ? { kind: "node", node: binding.node }
        : { kind: "node", node: binding.node, path: [...binding.path] };
    case "object": {
      const fields: Record<string, Binding> = {};
      for (const [field, nested] of Object.entries(binding.fields)) {
        fields[field] = toBinding(nested);
      }
      return { kind: "object", fields };
    }
  }
}

/** Record every `{ kind: "node" }` reference inside a binding, for the build-time check. */
function collectBindingRefs(
  binding: Binding,
  path: readonly (string | number)[],
  into: PendingNodeRef[],
): void {
  if (binding.kind === "node") {
    into.push({ target: binding.node, path: [...path, "node"] });
    return;
  }
  if (binding.kind === "object") {
    for (const [field, nested] of Object.entries(binding.fields)) {
      collectBindingRefs(nested, [...path, "fields", field], into);
    }
  }
}

/** Normalize a retry policy, omitting an absent backoff rather than emitting `undefined`. */
function toRetry(retry: RetryPolicy): RetryPolicy {
  return retry.backoffMs === undefined
    ? { maxAttempts: retry.maxAttempts }
    : { maxAttempts: retry.maxAttempts, backoffMs: retry.backoffMs };
}

/** Normalize a budget to the dimensions actually declared. `{}` means no node-level limit. */
function toBudget(budget: Budget): Budget {
  const out: { -readonly [K in keyof Budget]: Budget[K] } = {};
  if (budget.maxCostUsd !== undefined) {
    out.maxCostUsd = budget.maxCostUsd;
  }
  if (budget.maxDurationMs !== undefined) {
    out.maxDurationMs = budget.maxDurationMs;
  }
  if (budget.maxModelCalls !== undefined) {
    out.maxModelCalls = budget.maxModelCalls;
  }
  if (budget.maxToolCalls !== undefined) {
    out.maxToolCalls = budget.maxToolCalls;
  }
  return out;
}

/** Normalize the tool grants, omitting an absent scope. */
function toPermissions(permissions: readonly ToolGrant[]): readonly ToolGrant[] {
  return permissions.map((grant) =>
    grant.scope === undefined
      ? { toolId: grant.toolId, mode: grant.mode }
      : { toolId: grant.toolId, mode: grant.mode, scope: grant.scope },
  );
}

/** Normalize a `branch` selector, with the policy reference in either form. */
function toSelector(on: BranchSelectorInput): Record<string, unknown> {
  return on.kind === "field"
    ? { kind: "field", path: [...on.path] }
    : { kind: "policy", policy: toRef(on.policy) };
}

/** Normalize a `loop` condition, with the policy reference in either form. */
function toCondition(until: LoopConditionInput): Record<string, unknown> {
  return until.kind === "field"
    ? { kind: "field", path: [...until.path], equals: until.equals }
    : { kind: "policy", policy: toRef(until.policy) };
}

/** Where a node is being added, which fixes its default input binding and its terminality. */
interface Placement {
  /** True when the node belongs to the edge-reachable graph rather than to a container. */
  readonly inMainGraph: boolean;
  /** The binding this position implies, or `undefined` when the author must state one. */
  readonly defaultInput: Binding | undefined;
}

/** The fields shared by every node method, once defaults have been applied. */
interface CommonResolved {
  readonly timeoutMs: number;
  readonly retry: RetryPolicy;
  readonly budget: Budget;
  readonly permissions: readonly ToolGrant[];
  readonly version: string;
  readonly statedInput: Binding | undefined;
  readonly statedInputSchema: string | undefined;
  readonly statedOutputSchema: string | undefined;
}

/**
 * Apply the workflow's defaults to one node's common options.
 *
 * `permissions` is passed in rather than read off `options`, because only an
 * `agent` and a `call` node have that option at all: M4-T8's "a `code` node does
 * not inherit agent tools" is enforced by the option types, and a node that
 * cannot be granted anything is given `[]` here.
 */
function resolveCommon(
  state: BuilderState,
  options: CommonNodeOptions<string>,
  permissions: readonly ToolGrant[] = [],
): CommonResolved {
  return {
    timeoutMs: options.timeoutMs ?? state.defaults.timeoutMs,
    retry: toRetry(options.retry ?? state.defaults.retry),
    budget: toBudget(options.budget ?? state.defaults.budget),
    permissions,
    version: options.version ?? state.defaults.version,
    statedInput: options.input === undefined ? undefined : toBinding(options.input),
    statedInputSchema:
      options.inputSchema === undefined ? undefined : toSchemaRef(options.inputSchema),
    statedOutputSchema:
      options.outputSchema === undefined ? undefined : toSchemaRef(options.outputSchema),
  };
}

/**
 * Register one node, rejecting a duplicate id the moment it is written.
 *
 * Duplicate ids are the one class of error the DSL refuses to defer to
 * `build()`: the author is standing at the call site that caused it, and a
 * second node under an existing id would otherwise silently replace the first.
 */
function register(
  state: BuilderState,
  id: NodeId,
  type: WorkflowNodeType,
  hasNext: boolean,
  passesInputThrough: boolean,
  extra: Record<string, unknown>,
  placement: Placement,
  common: CommonResolved,
): Draft {
  if (state.drafts.has(id)) {
    fail(state, `duplicate node id \`${id}\``, [
      {
        path: ["nodes", id],
        message: `node id \`${id}\` is already used; every node id in a workflow must be unique`,
      },
    ]);
  }

  const draft: Draft = {
    id,
    type,
    extra,
    hasNext,
    next: undefined,
    statedInput: common.statedInput,
    defaultInput: placement.defaultInput,
    statedInputSchema: common.statedInputSchema,
    statedOutputSchema: common.statedOutputSchema,
    passesInputThrough,
    inMainGraph: placement.inMainGraph,
    timeoutMs: common.timeoutMs,
    retry: common.retry,
    budget: common.budget,
    permissions: common.permissions,
    version: common.version,
  };

  state.drafts.set(id, draft);
  state.order.push(id);

  if (common.statedInput !== undefined) {
    collectBindingRefs(common.statedInput, ["nodes", id, "input"], state.pendingRefs);
  }

  return draft;
}

/** How a nested builder wires the nodes added to it. */
type SubGraphMode = "sequence" | "steps";

/** Everything a container tells its sub-graph builder. */
interface SubGraphContext {
  readonly mode: SubGraphMode;
  readonly containerId: NodeId;
  /** The binding the sub-graph's first node defaults to. */
  readonly headInput: Binding | undefined;
  /** Whether the sub-graph continues the main graph (a branch case) or returns to its container. */
  readonly inMainGraph: boolean;
  /** How this sub-graph is named in an error message. */
  readonly label: string;
}

// --- one draft factory per node type ------------------------------------------

function codeDraft(
  state: BuilderState,
  id: NodeId,
  options: CodeNodeOptions<string>,
  placement: Placement,
): Draft {
  return register(
    state,
    id,
    "code",
    true,
    false,
    { handler: toRef(options.handler) },
    placement,
    resolveCommon(state, options),
  );
}

function callDraft(
  state: BuilderState,
  id: NodeId,
  options: CallNodeOptions<string>,
  placement: Placement,
): Draft {
  const tool = toRef(options.tool);

  // A `call` node calls exactly one tool, by reference, and the validator
  // requires a grant for it at the mode the effect needs. Restating the tool's
  // id in a grant is a transcription step with nothing to decide, so an absent
  // `permissions` means "grant this node's own tool"; an explicit one is used as
  // written, which is how a scope or a second grant is added.
  const permissions: readonly ToolGrant[] =
    options.permissions === undefined
      ? [{ toolId: tool.id, mode: options.effect === "read-only" ? "read" : "write" }]
      : toPermissions(options.permissions);

  return register(
    state,
    id,
    "call",
    true,
    false,
    {
      tool,
      effect: options.effect,
      ...(options.protection === undefined
        ? {}
        : { protection: { kind: options.protection.kind } }),
    },
    placement,
    resolveCommon(state, options, permissions),
  );
}

function jevDraft(
  state: BuilderState,
  id: NodeId,
  options: JevNodeOptions<string>,
  placement: Placement,
): Draft {
  return register(
    state,
    id,
    "jev",
    true,
    false,
    { question: toRef(options.question), questionKind: options.questionKind },
    placement,
    resolveCommon(state, options),
  );
}

function agentDraft(
  state: BuilderState,
  id: NodeId,
  options: AgentNodeOptions<string>,
  placement: Placement,
): Draft {
  return register(
    state,
    id,
    "agent",
    true,
    false,
    { agent: toRef(options.agent) },
    placement,
    resolveCommon(state, options, toPermissions(options.permissions ?? [])),
  );
}

function artifactDraft(
  state: BuilderState,
  id: NodeId,
  options: ArtifactNodeOptions<string>,
  placement: Placement,
): Draft {
  return register(
    state,
    id,
    "artifact",
    true,
    false,
    {
      name: options.name,
      ...(options.contentType === undefined ? {} : { contentType: options.contentType }),
    },
    placement,
    resolveCommon(state, options),
  );
}

function escalateDraft(
  state: BuilderState,
  id: NodeId,
  options: EscalateNodeOptions<string>,
  placement: Placement,
): Draft {
  return register(
    state,
    id,
    "escalate",
    false,
    true,
    { reason: options.reason },
    placement,
    resolveCommon(state, options),
  );
}

function reduceDraft(
  state: BuilderState,
  id: NodeId,
  options: ReduceNodeOptions<string>,
  placement: Placement,
): Draft {
  const items = toBinding(options.items);
  collectBindingRefs(items, ["nodes", id, "items"], state.pendingRefs);

  return register(
    state,
    id,
    "reduce",
    true,
    false,
    { items, handler: toRef(options.handler), initial: options.initial },
    placement,
    resolveCommon(state, options),
  );
}

function chainDraft(
  state: BuilderState,
  id: NodeId,
  options: ChainNodeOptions<string>,
  placement: Placement,
): Draft {
  const draft = register(
    state,
    id,
    "chain",
    true,
    false,
    { steps: [] },
    placement,
    resolveCommon(state, options),
  );

  draft.extra.steps = [
    ...runSubGraph(state, options.steps, {
      mode: "steps",
      containerId: id,
      headInput: { kind: "node", node: id },
      inMainGraph: false,
      label: `chain \`${id}\`'s steps`,
    }),
  ];

  return draft;
}

function branchDraft(
  state: BuilderState,
  id: NodeId,
  options: BranchNodeOptions<string>,
  placement: Placement,
): Draft {
  const draft = register(
    state,
    id,
    "branch",
    false,
    true,
    { on: toSelector(options.on), cases: {} },
    placement,
    resolveCommon(state, options),
  );

  const labels = Object.keys(options.cases);
  if (labels.length === 0) {
    fail(state, `branch \`${id}\` has no cases`, [
      {
        path: ["nodes", id, "cases"],
        message: "a `branch` must enumerate at least one labelled case",
      },
    ]);
  }

  const cases: Record<string, NodeId> = {};
  for (const label of labels) {
    // `labels` came from `Object.keys`, so the lookup is always present.
    const subGraph = options.cases[label] as SubGraph<string>;
    cases[label] = runBody(state, subGraph, {
      mode: "sequence",
      containerId: id,
      headInput: { kind: "node", node: id },
      inMainGraph: true,
      label: `branch \`${id}\` case \`${label}\``,
    });
  }
  draft.extra.cases = cases;

  draft.extra.default = runBody(state, options.default, {
    mode: "sequence",
    containerId: id,
    headInput: { kind: "node", node: id },
    inMainGraph: true,
    label: `branch \`${id}\`'s default`,
  });

  return draft;
}

function mapDraft(
  state: BuilderState,
  id: NodeId,
  options: MapNodeOptions<string>,
  placement: Placement,
): Draft {
  const items = toBinding(options.items);
  collectBindingRefs(items, ["nodes", id, "items"], state.pendingRefs);

  const draft = register(
    state,
    id,
    "map",
    true,
    false,
    {
      items,
      body: "",
      maxItems: options.maxItems,
      ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
    },
    placement,
    resolveCommon(state, options),
  );

  draft.extra.body = runBody(state, options.body, {
    mode: "sequence",
    containerId: id,
    headInput: { kind: "item" },
    inMainGraph: false,
    label: `map \`${id}\`'s body`,
  });

  return draft;
}

function loopDraft(
  state: BuilderState,
  id: NodeId,
  options: LoopNodeOptions<string>,
  placement: Placement,
): Draft {
  const draft = register(
    state,
    id,
    "loop",
    true,
    false,
    { body: "", maxIterations: options.maxIterations, until: toCondition(options.until) },
    placement,
    resolveCommon(state, options),
  );

  draft.extra.body = runBody(state, options.body, {
    mode: "sequence",
    containerId: id,
    headInput: { kind: "node", node: id },
    inMainGraph: false,
    label: `loop \`${id}\`'s body`,
  });

  return draft;
}

// --- the nested builder --------------------------------------------------------

/** The marker `.end()`, `.goto()`, `.branch()` and `.escalate()` return. */
const SUB_GRAPH_END_MARKER: SubGraphEnd = Object.freeze({ [SUB_GRAPH_END]: true as const });

/**
 * The nested builder behind every sub-graph callback.
 *
 * In `sequence` mode its nodes are wired to one another and the last must be
 * terminated with `.end()`, `.goto()` or a terminal node. In `steps` mode each
 * node is a separate child of a `chain` and terminal on its own, because a step
 * reachable from a sibling's `next` **and** listed in `steps` would have two
 * owners, which the IR graph model forbids.
 */
class SubGraphBuilderImpl implements SubGraphBuilder<string> {
  readonly #state: BuilderState;
  readonly #context: SubGraphContext;
  readonly #ids: NodeId[] = [];
  #tail: NodeId | undefined;
  #directTarget: NodeId | undefined;
  #finished = false;

  constructor(state: BuilderState, context: SubGraphContext) {
    this.#state = state;
    this.#context = context;
  }

  /** The ids added, in order. The first is the sub-graph's head. */
  get ids(): readonly NodeId[] {
    return this.#ids;
  }

  /**
   * The node this sub-graph starts at.
   *
   * Usually the first node it added. A branch case that adds nothing and only
   * `goto`s is the exception: the case target *is* the node it names, which is
   * how "this label goes straight to `finalize`" is written without inventing a
   * pass-through node nobody asked for.
   */
  get head(): NodeId | undefined {
    return this.#ids[0] ?? this.#directTarget;
  }

  #placement(): Placement {
    const previous = this.#ids.at(-1);
    return {
      inMainGraph: this.#context.inMainGraph,
      defaultInput:
        previous === undefined ? this.#context.headInput : { kind: "node", node: previous },
    };
  }

  #attach(draft: Draft): this {
    if (this.#finished) {
      fail(this.#state, `${this.#context.label} continues after it was terminated`, [
        {
          path: ["nodes", draft.id],
          message: `\`${draft.id}\` was added to ${this.#context.label} after it ended`,
        },
      ]);
    }

    if (this.#context.mode === "steps") {
      if (draft.hasNext) {
        draft.next = null;
      }
    } else if (this.#tail !== undefined) {
      const previous = this.#state.drafts.get(this.#tail);
      if (previous?.hasNext) {
        previous.next = draft.id;
      }
    }

    this.#ids.push(draft.id);
    this.#tail = draft.hasNext ? draft.id : undefined;
    if (!draft.hasNext) {
      this.#finished = true;
    }
    return this;
  }

  code(id: string, options: CodeNodeOptions<string>): SubGraphBuilder<string> {
    return this.#attach(codeDraft(this.#state, id, options, this.#placement()));
  }

  call(id: string, options: CallNodeOptions<string>): SubGraphBuilder<string> {
    return this.#attach(callDraft(this.#state, id, options, this.#placement()));
  }

  jev(id: string, options: JevNodeOptions<string>): SubGraphBuilder<string> {
    return this.#attach(jevDraft(this.#state, id, options, this.#placement()));
  }

  agent(id: string, options: AgentNodeOptions<string>): SubGraphBuilder<string> {
    return this.#attach(agentDraft(this.#state, id, options, this.#placement()));
  }

  artifact(id: string, options: ArtifactNodeOptions<string>): SubGraphBuilder<string> {
    return this.#attach(artifactDraft(this.#state, id, options, this.#placement()));
  }

  chain(id: string, options: ChainNodeOptions<string>): SubGraphBuilder<string> {
    return this.#attach(chainDraft(this.#state, id, options, this.#placement()));
  }

  map(id: string, options: MapNodeOptions<string>): SubGraphBuilder<string> {
    return this.#attach(mapDraft(this.#state, id, options, this.#placement()));
  }

  reduce(id: string, options: ReduceNodeOptions<string>): SubGraphBuilder<string> {
    return this.#attach(reduceDraft(this.#state, id, options, this.#placement()));
  }

  loop(id: string, options: LoopNodeOptions<string>): SubGraphBuilder<string> {
    return this.#attach(loopDraft(this.#state, id, options, this.#placement()));
  }

  branch(id: string, options: BranchNodeOptions<string>): SubGraphEnd {
    this.#attach(branchDraft(this.#state, id, options, this.#placement()));
    return SUB_GRAPH_END_MARKER;
  }

  escalate(id: string, options: EscalateNodeOptions<string>): SubGraphEnd {
    this.#attach(escalateDraft(this.#state, id, options, this.#placement()));
    return SUB_GRAPH_END_MARKER;
  }

  end(): SubGraphEnd {
    this.#requireNonEmpty();
    if (this.#tail !== undefined) {
      const draft = this.#state.drafts.get(this.#tail);
      if (draft?.hasNext && draft.next === undefined) {
        draft.next = null;
      }
    }
    this.#finished = true;
    return SUB_GRAPH_END_MARKER;
  }

  goto(target: NodeId): SubGraphEnd {
    if (!this.#context.inMainGraph) {
      fail(this.#state, `${this.#context.label} cannot use \`goto\``, [
        {
          path: ["nodes", this.#context.containerId],
          message:
            "only a branch case or default may `goto` another node; a `map` body, a `loop` " +
            "body and a `chain` step return to their container, so they end with `end()`",
        },
      ]);
    }

    if (this.#ids.length === 0) {
      // The case adds nothing of its own: its target is the node it names.
      this.#directTarget = target;
      this.#state.pendingRefs.push({
        target,
        path: ["nodes", this.#context.containerId],
      });
      this.#finished = true;
      return SUB_GRAPH_END_MARKER;
    }

    const tail = this.#tail;
    if (tail === undefined) {
      fail(this.#state, `${this.#context.label} cannot \`goto\` after a terminal node`, [
        {
          path: ["nodes", this.#context.containerId],
          message: "`goto` follows a node that carries a `next`; a terminal node ends the path",
        },
      ]);
    }

    const draft = this.#state.drafts.get(tail);
    if (draft !== undefined) {
      draft.next = target;
      this.#state.pendingRefs.push({ target, path: ["nodes", tail, "next"] });
    }

    this.#finished = true;
    return SUB_GRAPH_END_MARKER;
  }

  #requireNonEmpty(): void {
    if (this.head === undefined) {
      fail(this.#state, `${this.#context.label} is empty`, [
        {
          path: ["nodes", this.#context.containerId],
          message: `${this.#context.label} must add at least one node before it ends`,
        },
      ]);
    }
  }
}

/** Run one sub-graph callback and return the ids it added, in order. */
function runSubGraph(
  state: BuilderState,
  subGraph: SubGraph<string>,
  context: SubGraphContext,
): readonly NodeId[] {
  const builder = new SubGraphBuilderImpl(state, context);
  subGraph(builder);

  if (builder.head === undefined) {
    fail(state, `${context.label} is empty`, [
      {
        path: ["nodes", context.containerId],
        message: `${context.label} must add at least one node, or \`goto\` one`,
      },
    ]);
  }

  return builder.ids;
}

/**
 * The node a container points at, for a container that has exactly one child.
 *
 * Not always a node the sub-graph owns: a branch case written `(b) =>
 * b.goto("finalize")` adds nothing and its target is `finalize`, which the
 * top-level chain owns.
 */
function runBody(
  state: BuilderState,
  subGraph: SubGraph<string>,
  context: SubGraphContext,
): NodeId {
  const builder = new SubGraphBuilderImpl(state, context);
  subGraph(builder);

  const head = builder.head;
  if (head === undefined) {
    fail(state, `${context.label} is empty`, [
      {
        path: ["nodes", context.containerId],
        message: `${context.label} must add at least one node, or \`goto\` one`,
      },
    ]);
  }

  return head;
}

// --- the top-level builder ------------------------------------------------------

class WorkflowBuilderImpl implements WorkflowBuilder<string> {
  readonly #state: BuilderState;

  constructor(state: BuilderState) {
    this.#state = state;
  }

  #placement(): Placement {
    const state = this.#state;
    if (state.entry === undefined) {
      return { inMainGraph: true, defaultInput: { kind: "input" } };
    }
    if (state.openTail === undefined) {
      // The previous top-level node was a `branch` or an `escalate`, so this one
      // has no unique predecessor and must state its own binding.
      return { inMainGraph: true, defaultInput: undefined };
    }
    return { inMainGraph: true, defaultInput: { kind: "node", node: state.openTail } };
  }

  #attach(draft: Draft): this {
    const state = this.#state;

    if (state.entry === undefined) {
      state.entry = draft.id;
    } else if (state.openTail !== undefined) {
      const previous = state.drafts.get(state.openTail);
      if (previous?.hasNext) {
        previous.next = draft.id;
      }
    }

    state.openTail = draft.hasNext ? draft.id : undefined;
    return this;
  }

  code(id: string, options: CodeNodeOptions<string>): WorkflowBuilder<string> {
    return this.#attach(codeDraft(this.#state, id, options, this.#placement()));
  }

  call(id: string, options: CallNodeOptions<string>): WorkflowBuilder<string> {
    return this.#attach(callDraft(this.#state, id, options, this.#placement()));
  }

  jev(id: string, options: JevNodeOptions<string>): WorkflowBuilder<string> {
    return this.#attach(jevDraft(this.#state, id, options, this.#placement()));
  }

  agent(id: string, options: AgentNodeOptions<string>): WorkflowBuilder<string> {
    return this.#attach(agentDraft(this.#state, id, options, this.#placement()));
  }

  artifact(id: string, options: ArtifactNodeOptions<string>): WorkflowBuilder<string> {
    return this.#attach(artifactDraft(this.#state, id, options, this.#placement()));
  }

  escalate(id: string, options: EscalateNodeOptions<string>): WorkflowBuilder<string> {
    return this.#attach(escalateDraft(this.#state, id, options, this.#placement()));
  }

  chain(id: string, options: ChainNodeOptions<string>): WorkflowBuilder<string> {
    return this.#attach(chainDraft(this.#state, id, options, this.#placement()));
  }

  branch(id: string, options: BranchNodeOptions<string>): WorkflowBuilder<string> {
    return this.#attach(branchDraft(this.#state, id, options, this.#placement()));
  }

  map(id: string, options: MapNodeOptions<string>): WorkflowBuilder<string> {
    return this.#attach(mapDraft(this.#state, id, options, this.#placement()));
  }

  reduce(id: string, options: ReduceNodeOptions<string>): WorkflowBuilder<string> {
    return this.#attach(reduceDraft(this.#state, id, options, this.#placement()));
  }

  loop(id: string, options: LoopNodeOptions<string>): WorkflowBuilder<string> {
    return this.#attach(loopDraft(this.#state, id, options, this.#placement()));
  }

  toIr(): WorkflowDefinition {
    return emit(this.#state);
  }

  build(): WorkflowDefinition {
    return parseWorkflowDefinition(emit(this.#state));
  }
}

// --- compilation ----------------------------------------------------------------

/**
 * Turn the drafts into IR: close the open edges, derive the schemas and assemble
 * the definition.
 *
 * Problems are collected rather than thrown one at a time, so an author fixing a
 * workflow sees the whole list. That is the choice `parseWorkflowDefinition()`
 * makes, for the same reason.
 */
function emit(state: BuilderState): WorkflowDefinition {
  const entry = state.entry;
  if (entry === undefined) {
    fail(state, "has no nodes", [
      { path: ["nodes"], message: "a workflow must declare at least one node" },
    ]);
  }

  const issues: ValidationIssue[] = [];

  // 1. Close every edge left open: a node whose successor was never added is
  //    terminal.
  for (const id of state.order) {
    const draft = state.drafts.get(id);
    if (draft?.hasNext && draft.next === undefined) {
      draft.next = null;
    }
  }

  // 2. Every node reference the author wrote must name a node that exists.
  for (const ref of state.pendingRefs) {
    if (!state.drafts.has(ref.target)) {
      issues.push({
        path: ref.path,
        message: `\`${ref.target}\` is not a node of this workflow`,
      });
    }
  }

  // 3. Resolve each node's input binding.
  const bindings = new Map<NodeId, Binding>();
  for (const id of state.order) {
    // Every id in `order` was put in `drafts` by `register`.
    const draft = state.drafts.get(id) as Draft;
    const binding = draft.statedInput ?? draft.defaultInput;
    if (binding === undefined) {
      issues.push({
        path: ["nodes", id, "input"],
        message:
          `\`${id}\` follows a \`branch\` or an \`escalate\`, so it has no unique predecessor; ` +
          "state its `input` binding explicitly",
      });
      continue;
    }
    bindings.set(id, binding);
  }

  // 4. Resolve each node's two schemas, deriving what can be derived.
  const inputSchemas = new Map<NodeId, string>();
  const outputSchemas = new Map<NodeId, string>();
  const resolving = new Set<string>();

  function resolveInputSchema(id: NodeId): string | undefined {
    const known = inputSchemas.get(id);
    if (known !== undefined) {
      return known;
    }
    const draft = state.drafts.get(id);
    if (draft === undefined) {
      return undefined;
    }
    if (draft.statedInputSchema !== undefined) {
      inputSchemas.set(id, draft.statedInputSchema);
      return draft.statedInputSchema;
    }

    const key = `in:${id}`;
    if (resolving.has(key)) {
      return undefined;
    }
    resolving.add(key);

    const binding = bindings.get(id);
    let derived: string | undefined;
    if (binding !== undefined) {
      if (binding.kind === "input") {
        derived = state.inputSchema;
      } else if (binding.kind === "node" && binding.path === undefined) {
        derived = resolveOutputSchema(binding.node);
      }
    }

    resolving.delete(key);

    if (derived === undefined) {
      if (binding !== undefined) {
        issues.push({
          path: ["nodes", id, "inputSchema"],
          message:
            `\`${id}\`'s input schema cannot be derived from its \`${binding.kind}\` binding; ` +
            "state `inputSchema` explicitly",
        });
      }
      return undefined;
    }

    inputSchemas.set(id, derived);
    return derived;
  }

  function resolveOutputSchema(id: NodeId): string | undefined {
    const known = outputSchemas.get(id);
    if (known !== undefined) {
      return known;
    }
    const draft = state.drafts.get(id);
    if (draft === undefined) {
      return undefined;
    }
    if (draft.statedOutputSchema !== undefined) {
      outputSchemas.set(id, draft.statedOutputSchema);
      return draft.statedOutputSchema;
    }

    const key = `out:${id}`;
    if (resolving.has(key)) {
      return undefined;
    }
    resolving.add(key);

    let derived: string | undefined;
    if (draft.passesInputThrough) {
      derived = resolveInputSchema(id);
    } else if (draft.inMainGraph && draft.hasNext && draft.next === null) {
      derived = state.outputSchema;
    }

    resolving.delete(key);

    if (derived === undefined) {
      issues.push({
        path: ["nodes", id, "outputSchema"],
        message:
          `\`${id}\` does not end the workflow, so its output schema cannot be derived; ` +
          "state `outputSchema` explicitly",
      });
      return undefined;
    }

    outputSchemas.set(id, derived);
    return derived;
  }

  for (const id of state.order) {
    resolveOutputSchema(id);
    resolveInputSchema(id);
  }

  if (issues.length > 0) {
    fail(state, "cannot be compiled to IR", issues);
  }

  // 5. Assemble.
  const nodes: Record<string, unknown> = {};
  for (const id of state.order) {
    const draft = state.drafts.get(id) as Draft;
    nodes[id] = {
      id,
      type: draft.type,
      version: draft.version,
      inputSchema: inputSchemas.get(id),
      outputSchema: outputSchemas.get(id),
      timeoutMs: draft.timeoutMs,
      retry: draft.retry,
      budget: draft.budget,
      permissions: draft.permissions,
      input: bindings.get(id),
      ...draft.extra,
      ...(draft.hasNext ? { next: draft.next ?? null } : {}),
    };
  }

  return {
    schemaVersion: 1,
    id: state.workflowId,
    version: state.workflowVersion,
    domain: state.domain,
    jobType: state.jobType,
    inputSchema: state.inputSchema,
    outputSchema: state.outputSchema,
    entry,
    nodes,
  } as WorkflowDefinition;
}

/**
 * Start authoring a workflow.
 *
 * ```ts
 * const definition = workflow({
 *   id: "vendor-triage",
 *   version: "1.0.0",
 *   domain: "vendor-triage",
 *   jobType: "triage",
 *   input: "vendor-triage.input@1.0.0",
 *   output: "vendor-triage.output@1.0.0",
 * })
 *   .jev("classify", {
 *     question: "vendor.classification@1.0.0",
 *     questionKind: "choice",
 *     outputSchema: "vendor-triage.classification@1.0.0",
 *   })
 *   .branch("route", {
 *     on: { kind: "field", path: ["label"] },
 *     cases: {
 *       clear: (b) => b.code("finalize", { handler: "vendor.finalize@1.0.0" }).end(),
 *       research: (b) =>
 *         b
 *           .agent("research", {
 *             agent: "vendor-researcher@1.0.0",
 *             outputSchema: "vendor-triage.evidence@1.0.0",
 *           })
 *           .code("decide", { handler: "vendor.decide@1.0.0" })
 *           .end(),
 *     },
 *     default: (b) => b.escalate("full-agent", { reason: "uncertain classification" }),
 *   })
 *   .build();
 * ```
 *
 * The result is a parsed, deep-frozen `WorkflowDefinition`. It has **not** been
 * graph-validated and no capability has been resolved: hand it to
 * `compileWorkflow()` for that.
 *
 * @throws {ValidationError} if an id, a version or a capability reference is
 * ill-formed. Later problems — a duplicate id, an unknown reference, a schema
 * that cannot be derived — are thrown from the offending method or from
 * `build()`.
 */
export function workflow(options: WorkflowOptions): WorkflowBuilder<never> {
  const state: BuilderState = {
    workflowId: options.id,
    workflowVersion: options.version ?? DSL_WORKFLOW_VERSION_DEFAULT,
    domain: options.domain,
    jobType: options.jobType,
    inputSchema: toSchemaRef(options.input),
    outputSchema: toSchemaRef(options.output),
    defaults: {
      timeoutMs: options.defaults?.timeoutMs ?? DSL_NODE_DEFAULTS.timeoutMs,
      retry: options.defaults?.retry ?? DSL_NODE_DEFAULTS.retry,
      budget: options.defaults?.budget ?? DSL_NODE_DEFAULTS.budget,
      version: options.defaults?.version ?? DSL_NODE_DEFAULTS.version,
    },
    drafts: new Map(),
    order: [],
    pendingRefs: [],
    openTail: undefined,
    entry: undefined,
  };

  return new WorkflowBuilderImpl(state) as unknown as WorkflowBuilder<never>;
}
