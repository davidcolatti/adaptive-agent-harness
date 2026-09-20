import { parseCapabilityRefString } from "./capabilities.js";
import type { Budget, ToolGrant, ToolGrantMode } from "./context.js";
import type { ValidationIssue } from "./errors.js";
import {
  collectRefIssues,
  EXACT_VERSION_MESSAGE,
  IDENTIFIER_MESSAGE,
  isCapabilityIdentifier,
  isExactVersion,
} from "./identifiers.js";
import { isJsonValue, isPlainObject, type JsonValue } from "./json.js";

/**
 * The nodes a workflow is made of (M4-T2, M4-T3, M4-T4), and the binding model
 * that feeds them (M4-T1).
 *
 * This module holds the node half of the workflow IR; `workflow-ir.ts` holds
 * the definition that contains them, the parse boundary and the fingerprint.
 * The split is one-directional on purpose — nodes know nothing about the
 * definition — so there is no import cycle between the two.
 *
 * Three properties hold for everything declared here, and the rest of Milestone
 * 4 depends on all three:
 *
 * - **Every node is a `JsonValue`.** A workflow is canonicalized, fingerprinted,
 *   stored, diffed and replayed, so nothing in a node may be a live value, a
 *   closure or a class instance. What a node *does* is named by a
 *   {@link CapabilityRef} and resolved against the capability registry
 *   (AD-015, ADR-0015); it is never embedded.
 * - **Every node declares its own limits.** Input and output schemas, timeout,
 *   retry policy, budget and tool grants are per-node fields, not inherited from
 *   the workflow or from a parent node. North-star invariants 5 and 7 are the
 *   reason: every node has typed input and output, and every external write has
 *   explicit permission semantics.
 * - **Repetition is declared, never implied.** Only `map`, `reduce` and `loop`
 *   may execute a node more than once, and each of the three carries an explicit
 *   bound. Every other edge is a straight line. North-star invariant 6, "every
 *   loop is bounded"; the validator (M4-T4/M4-T9) is what rejects a cycle that
 *   is not one of these three, and this module is what makes the legitimate
 *   shapes expressible.
 *
 * What this module does **not** do: resolve a capability reference, check that a
 * `next` target exists, detect a cycle, or decide that a `code` node's empty
 * `permissions` is actually empty. Those are graph-level questions and belong to
 * `compileWorkflow()` in `@internal/workflow` (M4-T4, M4-T9). Everything here is
 * shape: what fields a node has, and what a well-formed value of each looks like
 * on its own.
 */

/**
 * The identifier of one node within a workflow.
 *
 * A plain `string` alias rather than a brand. A node id is scoped to its
 * workflow, is written by hand in a DSL (`"initial-classification"`) or by the
 * compiler, and is used as an object key in
 * `WorkflowDefinition.nodes`; a brand would have to be stripped at every one of
 * those sites and would buy nothing, because the only real confusion — a node id
 * that names no node — is a graph question the validator answers, not a type
 * question.
 *
 * The rule it must satisfy is `identifiers.ts`'s: letters, digits, `.`, `-` and
 * `_`, starting with a letter or digit. It is the same rule a domain or a
 * capability id obeys, stated once, so that a node id can be embedded in an
 * idempotency key or a trace event without needing an escape.
 */
export type NodeId = string;

/** True when `value` is a well-formed {@link NodeId}. */
export function isNodeId(value: unknown): value is NodeId {
  return isCapabilityIdentifier(value);
}

/**
 * The five executable node types (M4-T3) and the five control shapes (M4-T4),
 * in the order a canonical listing uses.
 *
 * `escalate` sits with the executable types rather than with the control shapes
 * because it is a leaf that produces a value — a {@link FallbackContext} — and
 * not a shape that composes other nodes. Build plan section 5 lists it under
 * `ControlNode`; this ordering is a presentation choice and nothing branches on
 * it. {@link CONTROL_NODE_TYPES} is the authoritative answer to "is this a
 * control shape?".
 */
export const NODE_TYPES = [
  "code",
  "call",
  "jev",
  "agent",
  "artifact",
  "escalate",
  "chain",
  "branch",
  "map",
  "reduce",
  "loop",
] as const;

/** One of the eleven node types this version of the IR understands. */
export type WorkflowNodeType = (typeof NODE_TYPES)[number];

/**
 * The control shapes: the node types that reference other nodes rather than
 * doing work themselves.
 *
 * `map`, `reduce` and `loop` are also the **only** three that may execute a node
 * more than once, and each carries its own explicit bound (`maxItems`,
 * `items`, `maxIterations`). Anything else that loops is a cycle the validator
 * rejects.
 */
export const CONTROL_NODE_TYPES = ["chain", "branch", "map", "reduce", "loop"] as const;

/** One of the five control shapes. */
export type ControlNodeType = (typeof CONTROL_NODE_TYPES)[number];

/**
 * The node types build plan M4-T3 says to "reserve but do not implement until
 * needed".
 *
 * They are **rejected by name with their own message**, not silently treated as
 * unknown. The distinction matters to whoever hits it: "reserved for a later
 * milestone" tells an author the type is coming and their design is not wrong,
 * whereas "unknown node type" would send them looking for a typo. Reserving the
 * names also stops a domain from defining its own incompatible `human` node in
 * the meantime.
 */
export const RESERVED_NODE_TYPES = ["human", "subworkflow"] as const;

/** One of the reserved-but-unimplemented node types. */
export type ReservedNodeType = (typeof RESERVED_NODE_TYPES)[number];

/**
 * What an external `call` node does to the world (M4-T7).
 *
 * The runtime's retry behavior turns on this and on nothing else, which is why
 * it is a required declaration rather than an inference:
 *
 * | Effect | Retry | Protection |
 * | --- | --- | --- |
 * | `read-only` | Freely. | None needed. |
 * | `idempotent-write` | Freely; the callee absorbs the duplicate. | None needed. |
 * | `non-idempotent-write` | Only under protection. | Required. |
 *
 * A tool that charges a card, sends an email or files a ticket is the third
 * kind, and the harness may not discover that by retrying one.
 */
export const CALL_EFFECTS = ["read-only", "idempotent-write", "non-idempotent-write"] as const;

/** One of the three effect declarations a `call` node must carry. */
export type CallEffect = (typeof CALL_EFFECTS)[number];

/**
 * The kinds of question a `jev` node may ask.
 *
 * Milestone 3 owns the question contract itself; these three names are the
 * shapes of answer a workflow has to be able to branch on, and they are
 * deliberately the smallest set that covers the build plan's examples. A `jev`
 * node **names** a question, it does not define one; see {@link JevNode}.
 */
export const JEV_QUESTION_KINDS = ["boolean", "choice", "score"] as const;

/** One of the three answer shapes a `jev` node may ask for. */
export type JevQuestionKind = (typeof JEV_QUESTION_KINDS)[number];

/**
 * A reference to a versioned capability, as a node carries it.
 *
 * The same `{ id, version }` pair `CapabilityRef` and `DomainRef` already are.
 * It is redeclared structurally here rather than imported so that this module's
 * value-level code does not depend on `capabilities.ts` for a type; the two are
 * the identical shape and are mutually assignable.
 *
 * Nodes carry references in two forms, and the difference is deliberate:
 *
 * - **Schemas are reference strings** (`"vendor-triage.input@1.0.0"`), matching
 *   `Job.contracts`, because that is the form a human writes and the form
 *   already in use.
 * - **Everything else is an object** (`{ "id": "vendor-researcher", "version":
 *   "1.0.0" }`), matching the JSON AD-015 shows verbatim for an `agent` node.
 */
export interface NodeCapabilityRef {
  /** The capability's stable id, e.g. `vendor-researcher`. */
  readonly id: string;
  /** The capability's exact `major.minor.patch` version. */
  readonly version: string;
}

/**
 * How one node's input is built out of the run's state.
 *
 * **This is not an expression language, and that is the point** (AD-013,
 * ADR-0038). A workflow's semantics must be inspectable by reading the IR, and
 * an embedded expression language would mean the IR carried code a reviewer has
 * to interpret, a compiler could invent and a fingerprint could not distinguish
 * from data. AD-013 limits v1 compilation to *structural* composition of
 * registered capabilities, so the data flow between them is structural too:
 * five closed cases, no operators, no functions, no conditionals. A
 * transformation that needs any of those is a `code` node calling a registered
 * handler, where it is versioned, fingerprinted and testable.
 *
 * Run state is `{ input: <the job's input>, nodes: { [nodeId]: <that node's
 * output> } }`, and the five cases read from it:
 *
 * | Case | Reads |
 * | --- | --- |
 * | `input` | The whole job input. |
 * | `node` | Another node's output, optionally narrowed by `path`. |
 * | `item` | The current element, inside a `map` body only. |
 * | `literal` | A constant baked into the workflow. |
 * | `object` | An object assembled from other bindings. |
 *
 * ```ts
 * // { candidate: <job input>, prior: <the "classify" node's .label> }
 * const binding: Binding = {
 *   kind: "object",
 *   fields: {
 *     candidate: { kind: "input" },
 *     prior: { kind: "node", node: "classify", path: ["label"] },
 *   },
 * };
 * ```
 *
 * `path` is a list of **object keys**, not a path expression: no wildcards, no
 * array indices, no filters. Reading into an array is a `map`, which is a node
 * and therefore visible in the graph.
 */
export type Binding =
  | BindingFromInput
  | BindingFromNode
  | BindingFromItem
  | BindingLiteral
  | BindingObject;

/** The whole job input. */
export interface BindingFromInput {
  readonly kind: "input";
}

/** Another node's recorded output, optionally narrowed to one field path. */
export interface BindingFromNode {
  readonly kind: "node";
  /** The node whose output to read. The validator checks that it exists and precedes this one. */
  readonly node: NodeId;
  /** Object keys to follow into that output. Absent means the whole output. */
  readonly path?: readonly string[];
}

/**
 * The current element of the enclosing `map`.
 *
 * Valid only inside a `map` node's body sub-graph. Using it anywhere else is a
 * graph error the validator reports (M4-T4); parse only knows the shape.
 */
export interface BindingFromItem {
  readonly kind: "item";
}

/** A constant value baked into the workflow and covered by its fingerprint. */
export interface BindingLiteral {
  readonly kind: "literal";
  readonly value: JsonValue;
}

/** An object assembled from other bindings, one per field. */
export interface BindingObject {
  readonly kind: "object";
  readonly fields: { readonly [field: string]: Binding };
}

/** The five binding kinds, and the only five {@link Binding} admits. */
export const BINDING_KINDS = ["input", "node", "item", "literal", "object"] as const;

/** One of the five binding kinds. */
export type BindingKind = (typeof BINDING_KINDS)[number];

/**
 * A node's retry policy (M4-T2).
 *
 * `maxAttempts` counts the **total** attempts including the first, so `1` means
 * "do not retry" and is the honest way to say it: an absent policy would leave
 * the reader guessing whether the default is none or the runtime's. Whether a
 * retry is *permitted* at all is a separate question a `call` node answers with
 * its {@link CallEffect}.
 */
export interface RetryPolicy {
  /** Total attempts including the first. A whole number >= 1. */
  readonly maxAttempts: number;
  /** Delay before a retry, in milliseconds. Absent means the runtime's default. */
  readonly backoffMs?: number;
}

/**
 * Protection for a `call` node that is not safe to repeat (M4-T7).
 *
 * One kind today, `idempotency-key`: the runtime derives a key per logical
 * execution and passes it to the tool, which is what lets a retried call be
 * recognized by the callee as the same call. The IR **stores no key**, only the
 * declaration that one is required; the key is a property of a run, not of a
 * workflow, and its formula is in `docs/contracts/workflow-ir.md`.
 *
 * It is an object rather than a boolean so that a later protection mechanism —
 * a reservation, a two-phase commit, a compare-and-set — is a new `kind` rather
 * than a breaking change to the field.
 */
export interface NodeProtection {
  readonly kind: "idempotency-key";
}

/**
 * The fields every node carries, whatever its type (M4-T2).
 *
 * Build plan M4-T2 lists eight: id, type, input schema, output schema, timeout,
 * retry policy, budget, permissions, version. All eight are here, plus `input`,
 * which is the ninth thing a node needs and which the plan's list omits because
 * it lists a node's *contract* rather than its wiring: a node with typed input
 * and no statement of where that input comes from cannot execute.
 */
export interface WorkflowNodeBase {
  /**
   * The node's id, which MUST equal its key in `WorkflowDefinition.nodes`.
   *
   * Stored twice on purpose. The key is what an edge points at; the field is
   * what survives when a node is read, traced or reported on its own, and
   * `TraceEvent.node` carries it. Parse enforces the equality, so the
   * duplication cannot become a disagreement.
   */
  readonly id: NodeId;
  /** Which of the eleven node types this is. The discriminant. */
  readonly type: WorkflowNodeType;
  /**
   * The node's own exact version.
   *
   * Per-node rather than per-workflow, because a node is the unit the compiler
   * replaces: promoting a cheaper `code` node in place of an `agent` node is a
   * change to that node's version and to the workflow's, and the two need to be
   * distinguishable when replay asks which node's behavior moved.
   */
  readonly version: string;
  /** The schema the node's input satisfies, as `id@version`. */
  readonly inputSchema: string;
  /** The schema the node's output satisfies, as `id@version`. */
  readonly outputSchema: string;
  /** Wall-clock limit for one attempt, in milliseconds. A whole number >= 1. */
  readonly timeoutMs: number;
  /** What to do when an attempt fails. */
  readonly retry: RetryPolicy;
  /**
   * The limits this node must stay inside.
   *
   * `{}` is the ordinary value and means "no node-level limit": the run's own
   * budget still applies, and a node budget can only narrow it. Every dimension
   * is optional, exactly as `Job.budget`'s is.
   */
  readonly budget: Budget;
  /**
   * The tools this node may use, and the only ones (M4-T8).
   *
   * **Not inherited.** An `agent` node receives exactly these grants and nothing
   * the job or another node holds; a `code` node does not inherit agent tools.
   * That is M4-T8 stated as a data structure rather than as a runtime rule, and
   * it is what makes "an agent node cannot call an ungranted tool" checkable
   * before anything runs.
   *
   * Empty for every type except `agent` and `call`, which is a rule the
   * validator enforces because it is about what a node *is* rather than about
   * whether this value is well formed.
   */
  readonly permissions: readonly ToolGrant[];
  /** Where this node's input comes from. */
  readonly input: Binding;
}

/**
 * A pure deterministic handler (M4-T3).
 *
 * No tools, no model, no network: the cheapest primitive in the optimization
 * target `Full Agent -> Specialized Agent -> Jev Decision -> Deterministic Code
 * -> Direct API Call`, and the one the compiler is trying to reach. Its
 * `permissions` MUST be empty, which the validator enforces.
 */
export interface CodeNode extends WorkflowNodeBase {
  readonly type: "code";
  /** The registered `handler` capability to run. */
  readonly handler: NodeCapabilityRef;
  /** The next node, or `null` when this node's output is the workflow's. */
  readonly next: NodeId | null;
}

/**
 * A direct call to a registered external tool (M4-T3, M4-T7).
 *
 * The last stop in the optimization target: no model in the loop at all. Because
 * it is the node that touches the outside world, it is the node that has to
 * declare what touching it costs, which is what `effect` and `protection` are
 * for.
 */
export interface CallNode extends WorkflowNodeBase {
  readonly type: "call";
  /** The registered `tool` capability to call. */
  readonly tool: NodeCapabilityRef;
  /** What the call does to the world. See {@link CALL_EFFECTS}. */
  readonly effect: CallEffect;
  /**
   * How a repeat of this call is made safe.
   *
   * REQUIRED when `effect` is `non-idempotent-write`, and the validator is what
   * enforces that; parse only checks the shape. Meaningful but optional for the
   * other two effects, where a caller may still want the callee to deduplicate.
   */
  readonly protection?: NodeProtection;
  /** The next node, or `null` when this node's output is the workflow's. */
  readonly next: NodeId | null;
}

/**
 * A bounded probabilistic judgment (M4-T3).
 *
 * **This node names a question; it does not define one.** Milestone 3 owns the
 * question contract, the `DecisionEngine` interface and the Jev implementation
 * behind it, and a question is deliberately *not* a
 * {@link CapabilityKind}: the five kinds are schema, agent, tool, handler and
 * policy, and a question is none of them. The consequence for M4-T9 is explicit:
 * capability resolution does **not** resolve `question`, because there is
 * nothing to resolve it against. Validating that a named question exists is
 * M3's boundary, applied when a workflow is registered (M5).
 *
 * `questionKind` is carried here rather than looked up so that the branch that
 * consumes the answer can be type-checked without M3 being present at all, which
 * is what lets M4 and M3 proceed in parallel.
 */
export interface JevNode extends WorkflowNodeBase {
  readonly type: "jev";
  /** The question to ask, by id and exact version. Owned and resolved by M3. */
  readonly question: NodeCapabilityRef;
  /** The shape of answer expected, so a consuming `branch` can be checked. */
  readonly questionKind: JevQuestionKind;
  /** The next node, or `null` when this node's output is the workflow's. */
  readonly next: NodeId | null;
}

/**
 * A registered agent, run with exactly the tools this node grants (M4-T3,
 * M4-T8).
 *
 * The most expensive primitive a compiled workflow may use, and the one the
 * compiler exists to replace. It is still a *node*: bounded by this node's
 * timeout, retry policy, budget and grants rather than by the job's, so a
 * workflow that contains an agent is not a workflow that has given up control.
 */
export interface AgentNode extends WorkflowNodeBase {
  readonly type: "agent";
  /** The registered `agent` capability to run. */
  readonly agent: NodeCapabilityRef;
  /** The next node, or `null` when this node's output is the workflow's. */
  readonly next: NodeId | null;
}

/**
 * Store this node's input as a durable artifact and output a reference to it
 * (M4-T3).
 *
 * The point of the indirection is that evidence outlives a run's trace: replay
 * (M6) and evals (M7) need the value, and a reference is what a later node,
 * a {@link FallbackContext} and a run record can all carry cheaply.
 *
 * `name` is the artifact's role within the workflow (`"research-notes"`), not a
 * file path. Where an artifact is actually stored is M5's decision; nothing
 * about a path, a bucket or a key belongs in the IR, which is also what keeps
 * path traversal out of a compiled workflow's reach.
 */
export interface ArtifactNode extends WorkflowNodeBase {
  readonly type: "artifact";
  /** The artifact's role within this workflow, as an identifier. */
  readonly name: string;
  /** The media type of the stored value, when the domain knows it. */
  readonly contentType?: string;
  /** The next node, or `null` when the artifact reference is the workflow's output. */
  readonly next: NodeId | null;
}

/**
 * Hand the job back to the full agent (M4-T3).
 *
 * **Terminal**, and therefore carries no `next` at all: an escalation is where
 * the compiled path stops and north-star invariant 1, "a domain can always fall
 * back to its full agent", takes over. Its output is a {@link FallbackContext},
 * which M5 hands to the registered full-agent runtime alongside the original
 * immutable `Job`.
 *
 * `reason` is the workflow author's static explanation of why this branch gives
 * up ("classification was uncertain"). It is not the `FallbackReason`: that is
 * chosen at runtime and is a closed union, whereas this is prose that ends up in
 * a trace and in a review.
 */
export interface EscalateNode extends WorkflowNodeBase {
  readonly type: "escalate";
  /** Why this branch escalates, in one phrase, for a human reading the trace. */
  readonly reason: string;
}

/**
 * Run a fixed sequence of nodes in order (M4-T4).
 *
 * `steps` is an explicit list rather than a chain of `next` pointers because a
 * sequence that is one node is easier to validate, to diff and to compile than a
 * sequence that is a linked list discovered by traversal.
 */
export interface ChainNode extends WorkflowNodeBase {
  readonly type: "chain";
  /** The nodes to run in order. Non-empty. */
  readonly steps: readonly NodeId[];
  /** The next node after the chain, or `null` to end the workflow. */
  readonly next: NodeId | null;
}

/** How a `branch` decides which label it produced. */
export type BranchSelector = BranchOnField | BranchOnPolicy;

/** Take the label from a string field of this node's input. */
export interface BranchOnField {
  readonly kind: "field";
  /** Object keys to follow into the input. The value found must be a string. */
  readonly path: readonly string[];
}

/**
 * Ask a registered `policy` capability for the label.
 *
 * This is the AD-009 separation in the IR: a `jev` node produces *judgment*, a
 * policy turns judgment into a *decision*, and the two are different
 * capabilities with different versions so that a threshold can move without the
 * question changing.
 */
export interface BranchOnPolicy {
  readonly kind: "policy";
  /** The registered `policy` capability that returns the label. */
  readonly policy: NodeCapabilityRef;
}

/**
 * Take one of several labelled paths (M4-T4).
 *
 * It carries **no `next`**: each case target continues the graph on its own, and
 * a shared continuation is expressed by pointing several cases at the same node.
 * A single `next` would mean every branch reconverges, which is exactly the
 * assumption that makes an escalating branch hard to express.
 *
 * `default` is the escalation target, and the validator treats a `branch`
 * without one as invalid — that is what M4-T4's "missing escalation target"
 * rejection means. A selector can always produce a label nobody enumerated (a
 * policy is code, a field is data), and the alternative to a default is a run
 * that stops with no successor and no explanation.
 */
export interface BranchNode extends WorkflowNodeBase {
  readonly type: "branch";
  /** Where the label comes from. */
  readonly on: BranchSelector;
  /** Label to node. Non-empty. */
  readonly cases: { readonly [label: string]: NodeId };
  /** Where an unmatched label goes. The validator requires it. */
  readonly default?: NodeId;
}

/**
 * Run a sub-graph once per element of a list (M4-T4).
 *
 * One of the three shapes that may repeat, and bounded by `maxItems`: a list
 * longer than that is a failure, not a truncation, because silently processing
 * a prefix would be a wrong answer that looks like a right one.
 *
 * Inside `body`, `{ kind: "item" }` is the current element.
 */
export interface MapNode extends WorkflowNodeBase {
  readonly type: "map";
  /** The list to iterate. Must evaluate to an array at runtime. */
  readonly items: Binding;
  /** The first node of the sub-graph run per element. */
  readonly body: NodeId;
  /** The hard upper bound on elements. A whole number >= 1. */
  readonly maxItems: number;
  /** How many elements may be in flight at once. Absent means the runtime's default. */
  readonly concurrency?: number;
  /** The next node after the map, or `null` to end the workflow. */
  readonly next: NodeId | null;
}

/**
 * Fold a list into one value with a registered handler (M4-T4).
 *
 * `handler` is a `(accumulator, item) => accumulator` deterministic handler. The
 * bound is the list itself: a reduce runs exactly once per element and can no
 * more diverge than the list can be infinite.
 */
export interface ReduceNode extends WorkflowNodeBase {
  readonly type: "reduce";
  /** The list to fold. Must evaluate to an array at runtime. */
  readonly items: Binding;
  /** The registered `handler` capability applied to `(accumulator, item)`. */
  readonly handler: NodeCapabilityRef;
  /** The starting accumulator, baked into the workflow. */
  readonly initial: JsonValue;
  /** The next node after the reduce, or `null` to end the workflow. */
  readonly next: NodeId | null;
}

/** How a `loop` decides it is finished. */
export type LoopCondition = LoopUntilField | LoopUntilPolicy;

/** Stop when a field of the body's output equals a constant. */
export interface LoopUntilField {
  readonly kind: "field";
  /** Object keys to follow into the body's output. */
  readonly path: readonly string[];
  /** The value that ends the loop, compared for deep equality. */
  readonly equals: JsonValue;
}

/** Stop when a registered `policy` capability says so. */
export interface LoopUntilPolicy {
  readonly kind: "policy";
  /** The registered `policy` capability that decides. */
  readonly policy: NodeCapabilityRef;
}

/**
 * The bounded loop (M4-T4), and the only cycle the IR admits.
 *
 * Both limits are mandatory and independent: `until` is the intent, and
 * `maxIterations` is the guarantee. A loop whose condition never becomes true
 * stops at the bound and fails; it does not run forever. That is north-star
 * invariant 6 and the hard prohibition "no unbounded loops in workflow
 * definitions", made structural — there is no way to write an unbounded loop in
 * this IR, so validation rejecting one is a second line of defence rather than
 * the only one.
 */
export interface LoopNode extends WorkflowNodeBase {
  readonly type: "loop";
  /** The first node of the sub-graph run per iteration. */
  readonly body: NodeId;
  /** The hard upper bound on iterations. A whole number >= 1. */
  readonly maxIterations: number;
  /** The intended stopping condition, checked after each iteration. */
  readonly until: LoopCondition;
  /** The next node after the loop, or `null` to end the workflow. */
  readonly next: NodeId | null;
}

/**
 * One node of a workflow: a discriminated union on `type`.
 *
 * Exhaustive by construction — every member's `type` is a distinct literal from
 * {@link NODE_TYPES} — so a `switch` over it that misses a case is a compile
 * error in the runtime, the validator and the code generator alike.
 */
export type WorkflowNode =
  | CodeNode
  | CallNode
  | JevNode
  | AgentNode
  | ArtifactNode
  | EscalateNode
  | ChainNode
  | BranchNode
  | MapNode
  | ReduceNode
  | LoopNode;

/** The ten fields {@link WorkflowNodeBase} declares, shared by every node type. */
const BASE_NODE_FIELDS = [
  "id",
  "type",
  "version",
  "inputSchema",
  "outputSchema",
  "timeoutMs",
  "retry",
  "budget",
  "permissions",
  "input",
] as const;

/**
 * The extra fields each node type adds to {@link BASE_NODE_FIELDS}.
 *
 * Together they are the closed field list for each type, which is what makes
 * "an unknown field is rejected" checkable per type rather than per union. Note
 * which types have **no** `next`: `escalate` is terminal, and `branch`
 * continues through its cases.
 */
const EXTRA_NODE_FIELDS: Readonly<Record<WorkflowNodeType, readonly string[]>> = {
  code: ["handler", "next"],
  call: ["tool", "effect", "protection", "next"],
  jev: ["question", "questionKind", "next"],
  agent: ["agent", "next"],
  artifact: ["name", "contentType", "next"],
  escalate: ["reason"],
  chain: ["steps", "next"],
  branch: ["on", "cases", "default"],
  map: ["items", "body", "maxItems", "concurrency", "next"],
  reduce: ["items", "handler", "initial", "next"],
  loop: ["body", "maxIterations", "until", "next"],
};

/** The budget dimensions, and whether each must be a whole number. Mirrors `job.ts`. */
const BUDGET_DIMENSIONS: ReadonlyArray<readonly [keyof Budget, "integer" | "number"]> = [
  ["maxCostUsd", "number"],
  ["maxDurationMs", "integer"],
  ["maxModelCalls", "integer"],
  ["maxToolCalls", "integer"],
];

/** The fields one {@link ToolGrant} has. Mirrors `job.ts`. */
const TOOL_GRANT_FIELDS = ["toolId", "mode", "scope"] as const;

/** The two access modes a grant may confer. Mirrors `job.ts`. */
const TOOL_GRANT_MODES: readonly string[] = ["read", "write"] satisfies readonly ToolGrantMode[];

/** A path into the value being validated, used for every issue's `path`. */
type IssuePath = readonly (string | number)[];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** Report every key of `record` that is not in `allowed`. Mirrors `job.ts`. */
function collectUnknownKeyIssues(
  record: { readonly [key: string]: unknown },
  allowed: readonly string[],
  path: IssuePath,
): ValidationIssue[] {
  return Object.keys(record)
    .filter((key) => !allowed.includes(key))
    .map((key) => ({ path: [...path, key], message: "unknown field" }));
}

/**
 * Validate a whole number within `[min, Infinity)`.
 *
 * Every bound in the IR is a count or a millisecond, so a fraction is always a
 * mistake rather than a precision the harness could honour.
 */
function collectPositiveIntegerIssues(
  value: unknown,
  path: IssuePath,
  min: number,
): ValidationIssue[] {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
    return [{ path: [...path], message: `expected a whole number >= ${String(min)}` }];
  }
  return [];
}

/** Validate a capability reference in its string form, `id@version`. */
function collectRefStringIssues(value: unknown, path: IssuePath): ValidationIssue[] {
  if (typeof value !== "string") {
    return [
      {
        path: [...path],
        message: "expected a capability reference string, e.g. `vendor-triage.input@1.0.0`",
      },
    ];
  }

  try {
    parseCapabilityRefString(value);
    return [];
  } catch {
    // `parseCapabilityRefString` throws with a root-path issue of its own; the
    // message is restated here so the path points at this field rather than at
    // nothing. Anything it can throw is a `ValidationError`.
    return [
      {
        path: [...path],
        message: "expected a capability reference string, e.g. `vendor-triage.input@1.0.0`",
      },
    ];
  }
}

/** Validate a capability reference in its object form, `{ id, version }`. */
function collectRefObjectIssues(value: unknown, path: IssuePath): ValidationIssue[] {
  if (!isPlainObject(value)) {
    return [{ path: [...path], message: "expected an `{ id, version }` capability reference" }];
  }

  return [
    ...collectUnknownKeyIssues(value, ["id", "version"], path),
    ...collectRefIssues(value.id, value.version, path),
  ];
}

/** A capability reference rebuilt from a validated object value. */
function readRef(value: { readonly [key: string]: unknown }): NodeCapabilityRef {
  return { id: value.id as string, version: value.version as string };
}

/** Validate a node id used as an edge target. */
function collectNodeIdIssues(value: unknown, path: IssuePath): ValidationIssue[] {
  if (!isNodeId(value)) {
    return [{ path: [...path], message: IDENTIFIER_MESSAGE }];
  }
  return [];
}

/** Validate a list of object keys used as a field path. */
function collectFieldPathIssues(value: unknown, path: IssuePath): ValidationIssue[] {
  if (!Array.isArray(value)) {
    return [{ path: [...path], message: "expected an array of object keys" }];
  }

  return (value as readonly unknown[]).flatMap((segment, index) =>
    typeof segment === "string" && segment !== ""
      ? []
      : [{ path: [...path, index], message: "expected a non-empty object key" }],
  );
}

/**
 * The deepest a {@link Binding} tree may nest.
 *
 * Not a semantic limit; a stack guard. See {@link collectBindingIssues}.
 */
export const MAX_BINDING_DEPTH = 32;

/**
 * Validate one {@link Binding}, recursively.
 *
 * `depth` bounds the recursion. A binding tree is written by hand or by the
 * compiler and is never deep; the limit exists so that a hostile or corrupt
 * value cannot exhaust the stack inside a parse boundary whose whole job is to
 * survive untrusted input. It is generous enough that no legitimate workflow can
 * reach it.
 */
function collectBindingIssues(value: unknown, path: IssuePath, depth = 0): ValidationIssue[] {
  if (depth > MAX_BINDING_DEPTH) {
    return [
      {
        path: [...path],
        message: `binding nesting exceeds the limit of ${String(MAX_BINDING_DEPTH)}`,
      },
    ];
  }

  if (!isPlainObject(value)) {
    return [{ path: [...path], message: "expected a binding object" }];
  }

  const { kind } = value;

  if (typeof kind !== "string" || !(BINDING_KINDS as readonly string[]).includes(kind)) {
    return [
      {
        path: [...path, "kind"],
        message: `expected one of ${BINDING_KINDS.map((name) => `\`${name}\``).join(", ")}`,
      },
    ];
  }

  switch (kind as BindingKind) {
    case "input":
    case "item":
      return collectUnknownKeyIssues(value, ["kind"], path);
    case "node":
      return [
        ...collectUnknownKeyIssues(value, ["kind", "node", "path"], path),
        ...collectNodeIdIssues(value.node, [...path, "node"]),
        ...(value.path === undefined ? [] : collectFieldPathIssues(value.path, [...path, "path"])),
      ];
    case "literal":
      return [
        ...collectUnknownKeyIssues(value, ["kind", "value"], path),
        ...(isJsonValue(value.value)
          ? []
          : [{ path: [...path, "value"], message: "expected a JSON value" }]),
      ];
    case "object": {
      if (!isPlainObject(value.fields)) {
        return [
          ...collectUnknownKeyIssues(value, ["kind", "fields"], path),
          { path: [...path, "fields"], message: "expected an object of bindings" },
        ];
      }

      const fields = value.fields;

      return [
        ...collectUnknownKeyIssues(value, ["kind", "fields"], path),
        ...Object.keys(fields).flatMap((field) =>
          collectBindingIssues(fields[field], [...path, "fields", field], depth + 1),
        ),
      ];
    }
  }
}

/** A binding rebuilt from a validated value, carrying only the fields it declared. */
function readBinding(value: { readonly [key: string]: unknown }): Binding {
  switch (value.kind as BindingKind) {
    case "input":
      return { kind: "input" };
    case "item":
      return { kind: "item" };
    case "node": {
      const binding: BindingFromNode = { kind: "node", node: value.node as NodeId };
      return value.path === undefined
        ? binding
        : { ...binding, path: [...(value.path as readonly string[])] };
    }
    case "literal":
      return { kind: "literal", value: value.value as JsonValue };
    case "object": {
      const fields = value.fields as { readonly [key: string]: unknown };
      const rebuilt: { [field: string]: Binding } = {};

      for (const field of Object.keys(fields)) {
        rebuilt[field] = readBinding(fields[field] as { readonly [key: string]: unknown });
      }

      return { kind: "object", fields: rebuilt };
    }
  }
}

/** Validate a {@link RetryPolicy}. */
function collectRetryIssues(value: unknown, path: IssuePath): ValidationIssue[] {
  if (!isPlainObject(value)) {
    return [{ path: [...path], message: "expected a retry policy object" }];
  }

  return [
    ...collectUnknownKeyIssues(value, ["maxAttempts", "backoffMs"], path),
    ...collectPositiveIntegerIssues(value.maxAttempts, [...path, "maxAttempts"], 1),
    ...(value.backoffMs === undefined
      ? []
      : collectPositiveIntegerIssues(value.backoffMs, [...path, "backoffMs"], 0)),
  ];
}

/** A retry policy rebuilt from a validated value. */
function readRetry(value: { readonly [key: string]: unknown }): RetryPolicy {
  const retry: RetryPolicy = { maxAttempts: value.maxAttempts as number };

  return value.backoffMs === undefined ? retry : { ...retry, backoffMs: value.backoffMs as number };
}

/** Validate a {@link Budget}. Mirrors `job.ts`, which owns the same rules for a job. */
function collectBudgetIssues(value: unknown, path: IssuePath): ValidationIssue[] {
  if (!isPlainObject(value)) {
    return [{ path: [...path], message: "expected a budget object" }];
  }

  const issues: ValidationIssue[] = [
    ...collectUnknownKeyIssues(
      value,
      BUDGET_DIMENSIONS.map(([dimension]) => dimension),
      path,
    ),
  ];

  for (const [dimension, kind] of BUDGET_DIMENSIONS) {
    const limit = value[dimension];

    if (limit === undefined) {
      continue;
    }

    if (typeof limit !== "number" || !Number.isFinite(limit) || limit < 0) {
      issues.push({
        path: [...path, dimension],
        message: "expected a finite number >= 0, or no value at all for unlimited",
      });
      continue;
    }

    if (kind === "integer" && !Number.isInteger(limit)) {
      issues.push({ path: [...path, dimension], message: "expected a whole number" });
    }
  }

  return issues;
}

/** A budget rebuilt from a validated value, carrying only the dimensions it set. */
function readBudget(value: { readonly [key: string]: unknown }): Budget {
  const budget: { -readonly [TDimension in keyof Budget]: Budget[TDimension] } = {};

  for (const [dimension] of BUDGET_DIMENSIONS) {
    const limit = value[dimension];

    if (limit !== undefined) {
      budget[dimension] = limit as number;
    }
  }

  return budget;
}

/** Validate one {@link ToolGrant}. Mirrors `job.ts`. */
function collectToolGrantIssues(value: unknown, path: IssuePath): ValidationIssue[] {
  if (!isPlainObject(value)) {
    return [{ path: [...path], message: "expected a tool grant object" }];
  }

  const issues: ValidationIssue[] = [...collectUnknownKeyIssues(value, TOOL_GRANT_FIELDS, path)];

  if (!isNonEmptyString(value.toolId)) {
    issues.push({ path: [...path, "toolId"], message: "expected a non-empty string" });
  }

  if (typeof value.mode !== "string" || !TOOL_GRANT_MODES.includes(value.mode)) {
    issues.push({ path: [...path, "mode"], message: "expected `read` or `write`" });
  }

  if (value.scope !== undefined && !isNonEmptyString(value.scope)) {
    issues.push({
      path: [...path, "scope"],
      message: "expected a non-empty string, or no value at all for an unnarrowed grant",
    });
  }

  return issues;
}

/** A grant rebuilt from a validated value. Mirrors `job.ts`. */
function readToolGrant(value: { readonly [key: string]: unknown }): ToolGrant {
  const grant: ToolGrant = { toolId: value.toolId as string, mode: value.mode as ToolGrantMode };

  return value.scope === undefined ? grant : { ...grant, scope: value.scope as string };
}

/** Validate the `next` edge every non-terminal node carries. */
function collectNextIssues(value: unknown, path: IssuePath): ValidationIssue[] {
  if (value === null) {
    return [];
  }

  if (!isNodeId(value)) {
    return [
      {
        path: [...path],
        message: "expected a node id, or `null` when this node's output is the workflow's",
      },
    ];
  }

  return [];
}

/** Validate a {@link BranchSelector} or a {@link LoopCondition}. */
function collectSelectorIssues(
  value: unknown,
  path: IssuePath,
  extraFieldFields: readonly string[],
): ValidationIssue[] {
  if (!isPlainObject(value)) {
    return [{ path: [...path], message: "expected a `field` or `policy` selector object" }];
  }

  if (value.kind === "field") {
    return [
      ...collectUnknownKeyIssues(value, ["kind", "path", ...extraFieldFields], path),
      ...collectFieldPathIssues(value.path, [...path, "path"]),
      ...(extraFieldFields.includes("equals") && !isJsonValue(value.equals)
        ? [{ path: [...path, "equals"], message: "expected a JSON value" }]
        : []),
    ];
  }

  if (value.kind === "policy") {
    return [
      ...collectUnknownKeyIssues(value, ["kind", "policy"], path),
      ...collectRefObjectIssues(value.policy, [...path, "policy"]),
    ];
  }

  return [{ path: [...path, "kind"], message: "expected `field` or `policy`" }];
}

/** Validate the non-empty `cases` map a `branch` carries. */
function collectCasesIssues(value: unknown, path: IssuePath): ValidationIssue[] {
  if (!isPlainObject(value)) {
    return [{ path: [...path], message: "expected an object mapping labels to node ids" }];
  }

  const labels = Object.keys(value);

  if (labels.length === 0) {
    return [{ path: [...path], message: "expected at least one case" }];
  }

  return labels.flatMap((label) =>
    label === ""
      ? [{ path: [...path, label], message: "expected a non-empty label" }]
      : collectNodeIdIssues(value[label], [...path, label]),
  );
}

/** Validate the non-empty `steps` list a `chain` carries. */
function collectStepsIssues(value: unknown, path: IssuePath): ValidationIssue[] {
  if (!Array.isArray(value)) {
    return [{ path: [...path], message: "expected an array of node ids" }];
  }

  const steps = value as readonly unknown[];

  if (steps.length === 0) {
    return [{ path: [...path], message: "expected at least one step" }];
  }

  return steps.flatMap((step, index) => collectNodeIdIssues(step, [...path, index]));
}

/**
 * Validate the fields {@link WorkflowNodeBase} declares.
 *
 * Split from the per-type check so that a malformed node reports its base
 * problems *and* its type-specific ones in one pass, which is what a caller
 * fixing a hand-written workflow wants.
 */
function collectBaseIssues(
  value: { readonly [key: string]: unknown },
  path: IssuePath,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  issues.push(...collectNodeIdIssues(value.id, [...path, "id"]));

  if (!isExactVersion(value.version)) {
    issues.push({ path: [...path, "version"], message: EXACT_VERSION_MESSAGE });
  }

  issues.push(...collectRefStringIssues(value.inputSchema, [...path, "inputSchema"]));
  issues.push(...collectRefStringIssues(value.outputSchema, [...path, "outputSchema"]));
  issues.push(...collectPositiveIntegerIssues(value.timeoutMs, [...path, "timeoutMs"], 1));
  issues.push(...collectRetryIssues(value.retry, [...path, "retry"]));
  issues.push(...collectBudgetIssues(value.budget, [...path, "budget"]));

  if (!Array.isArray(value.permissions)) {
    issues.push({ path: [...path, "permissions"], message: "expected an array of tool grants" });
  } else {
    issues.push(
      ...(value.permissions as readonly unknown[]).flatMap((grant, index) =>
        collectToolGrantIssues(grant, [...path, "permissions", index]),
      ),
    );
  }

  issues.push(...collectBindingIssues(value.input, [...path, "input"]));

  return issues;
}

/** The base fields rebuilt from a validated value. */
function readBase(value: { readonly [key: string]: unknown }, type: WorkflowNodeType) {
  return {
    id: value.id as NodeId,
    type,
    version: value.version as string,
    inputSchema: value.inputSchema as string,
    outputSchema: value.outputSchema as string,
    timeoutMs: value.timeoutMs as number,
    retry: readRetry(value.retry as { readonly [key: string]: unknown }),
    budget: readBudget(value.budget as { readonly [key: string]: unknown }),
    permissions: (value.permissions as readonly unknown[]).map((grant) =>
      readToolGrant(grant as { readonly [key: string]: unknown }),
    ),
    input: readBinding(value.input as { readonly [key: string]: unknown }),
  };
}

/** Validate a value against a closed set of string literals. */
function collectEnumIssues(
  value: unknown,
  allowed: readonly string[],
  path: IssuePath,
): ValidationIssue[] {
  if (typeof value === "string" && allowed.includes(value)) {
    return [];
  }

  return [
    {
      path: [...path],
      message: `expected one of ${allowed.map((name) => `\`${name}\``).join(", ")}`,
    },
  ];
}

/** Validate the optional {@link NodeProtection} a `call` node may declare (M4-T7). */
function collectProtectionIssues(value: unknown, path: IssuePath): ValidationIssue[] {
  if (value === undefined) {
    return [];
  }

  if (!isPlainObject(value) || value.kind !== "idempotency-key") {
    return [{ path: [...path], message: 'expected `{ kind: "idempotency-key" }`' }];
  }

  return collectUnknownKeyIssues(value, ["kind"], path);
}

/** Validate the fields one node type adds to the base. */
function collectTypeIssues(
  value: { readonly [key: string]: unknown },
  type: WorkflowNodeType,
  path: IssuePath,
): ValidationIssue[] {
  switch (type) {
    case "code":
      return [
        ...collectRefObjectIssues(value.handler, [...path, "handler"]),
        ...collectNextIssues(value.next, [...path, "next"]),
      ];
    case "call":
      return [
        ...collectRefObjectIssues(value.tool, [...path, "tool"]),
        ...collectEnumIssues(value.effect, CALL_EFFECTS, [...path, "effect"]),
        ...collectProtectionIssues(value.protection, [...path, "protection"]),
        ...collectNextIssues(value.next, [...path, "next"]),
      ];
    case "jev":
      return [
        ...collectRefObjectIssues(value.question, [...path, "question"]),
        ...collectEnumIssues(value.questionKind, JEV_QUESTION_KINDS, [...path, "questionKind"]),
        ...collectNextIssues(value.next, [...path, "next"]),
      ];
    case "agent":
      return [
        ...collectRefObjectIssues(value.agent, [...path, "agent"]),
        ...collectNextIssues(value.next, [...path, "next"]),
      ];
    case "artifact":
      return [
        ...(isNodeId(value.name) ? [] : [{ path: [...path, "name"], message: IDENTIFIER_MESSAGE }]),
        ...(value.contentType === undefined || isNonEmptyString(value.contentType)
          ? []
          : [{ path: [...path, "contentType"], message: "expected a non-empty string" }]),
        ...collectNextIssues(value.next, [...path, "next"]),
      ];
    case "escalate":
      return isNonEmptyString(value.reason)
        ? []
        : [{ path: [...path, "reason"], message: "expected a non-empty string" }];
    case "chain":
      return [
        ...collectStepsIssues(value.steps, [...path, "steps"]),
        ...collectNextIssues(value.next, [...path, "next"]),
      ];
    case "branch":
      return [
        ...collectSelectorIssues(value.on, [...path, "on"], []),
        ...collectCasesIssues(value.cases, [...path, "cases"]),
        ...(value.default === undefined
          ? []
          : collectNodeIdIssues(value.default, [...path, "default"])),
      ];
    case "map":
      return [
        ...collectBindingIssues(value.items, [...path, "items"]),
        ...collectNodeIdIssues(value.body, [...path, "body"]),
        ...collectPositiveIntegerIssues(value.maxItems, [...path, "maxItems"], 1),
        ...(value.concurrency === undefined
          ? []
          : collectPositiveIntegerIssues(value.concurrency, [...path, "concurrency"], 1)),
        ...collectNextIssues(value.next, [...path, "next"]),
      ];
    case "reduce":
      return [
        ...collectBindingIssues(value.items, [...path, "items"]),
        ...collectRefObjectIssues(value.handler, [...path, "handler"]),
        ...(isJsonValue(value.initial)
          ? []
          : [{ path: [...path, "initial"], message: "expected a JSON value" }]),
        ...collectNextIssues(value.next, [...path, "next"]),
      ];
    case "loop":
      return [
        ...collectNodeIdIssues(value.body, [...path, "body"]),
        ...collectPositiveIntegerIssues(value.maxIterations, [...path, "maxIterations"], 1),
        ...collectSelectorIssues(value.until, [...path, "until"], ["equals"]),
        ...collectNextIssues(value.next, [...path, "next"]),
      ];
  }
}

/** A branch selector or loop condition rebuilt from a validated value. */
function readSelector(value: { readonly [key: string]: unknown }, withEquals: boolean) {
  if (value.kind === "policy") {
    return {
      kind: "policy" as const,
      policy: readRef(value.policy as { readonly [key: string]: unknown }),
    };
  }

  const base = { kind: "field" as const, path: [...(value.path as readonly string[])] };

  return withEquals ? { ...base, equals: value.equals as JsonValue } : base;
}

/** One node rebuilt from a value both {@link collectBaseIssues} and {@link collectTypeIssues} accepted. */
function readNode(
  value: { readonly [key: string]: unknown },
  type: WorkflowNodeType,
): WorkflowNode {
  const base = readBase(value, type);
  const next = value.next as NodeId | null;

  switch (type) {
    case "code":
      return {
        ...base,
        type,
        handler: readRef(value.handler as { readonly [key: string]: unknown }),
        next,
      };
    case "call": {
      const node: CallNode = {
        ...base,
        type,
        tool: readRef(value.tool as { readonly [key: string]: unknown }),
        effect: value.effect as CallEffect,
        next,
      };
      return value.protection === undefined
        ? node
        : { ...node, protection: { kind: "idempotency-key" } };
    }
    case "jev":
      return {
        ...base,
        type,
        question: readRef(value.question as { readonly [key: string]: unknown }),
        questionKind: value.questionKind as JevQuestionKind,
        next,
      };
    case "agent":
      return {
        ...base,
        type,
        agent: readRef(value.agent as { readonly [key: string]: unknown }),
        next,
      };
    case "artifact": {
      const node: ArtifactNode = { ...base, type, name: value.name as string, next };
      return value.contentType === undefined
        ? node
        : { ...node, contentType: value.contentType as string };
    }
    case "escalate":
      return { ...base, type, reason: value.reason as string };
    case "chain":
      return { ...base, type, steps: [...(value.steps as readonly NodeId[])], next };
    case "branch": {
      const cases = value.cases as { readonly [key: string]: unknown };
      const rebuilt: { [label: string]: NodeId } = {};

      for (const label of Object.keys(cases)) {
        rebuilt[label] = cases[label] as NodeId;
      }

      const node: BranchNode = {
        ...base,
        type,
        on: readSelector(value.on as { readonly [key: string]: unknown }, false) as BranchSelector,
        cases: rebuilt,
      };

      return value.default === undefined ? node : { ...node, default: value.default as NodeId };
    }
    case "map": {
      const node: MapNode = {
        ...base,
        type,
        items: readBinding(value.items as { readonly [key: string]: unknown }),
        body: value.body as NodeId,
        maxItems: value.maxItems as number,
        next,
      };
      return value.concurrency === undefined
        ? node
        : { ...node, concurrency: value.concurrency as number };
    }
    case "reduce":
      return {
        ...base,
        type,
        items: readBinding(value.items as { readonly [key: string]: unknown }),
        handler: readRef(value.handler as { readonly [key: string]: unknown }),
        initial: value.initial as JsonValue,
        next,
      };
    case "loop":
      return {
        ...base,
        type,
        body: value.body as NodeId,
        maxIterations: value.maxIterations as number,
        until: readSelector(
          value.until as { readonly [key: string]: unknown },
          true,
        ) as LoopCondition,
        next,
      };
  }
}

/**
 * Validate one node and, when it is well formed, rebuild it.
 *
 * Exported for `workflow-ir.ts` and for nothing else; it is not part of the
 * package's public surface. The contract matches `readJob`'s: issues and no
 * node, or no issues and a node rebuilt from exactly the fields that were
 * validated.
 *
 * `key` is the node's key in `WorkflowDefinition.nodes`, checked against the
 * node's own `id`. That check lives here rather than in the caller so that every
 * per-node rule is reported with a per-node path.
 */
export function readWorkflowNode(
  value: unknown,
  key: string,
  path: IssuePath,
): { readonly issues: readonly ValidationIssue[]; readonly node?: WorkflowNode } {
  if (!isPlainObject(value)) {
    return { issues: [{ path: [...path], message: "expected a workflow node object" }] };
  }

  const rawType = value.type;

  if (typeof rawType === "string" && (RESERVED_NODE_TYPES as readonly string[]).includes(rawType)) {
    return {
      issues: [
        {
          path: [...path, "type"],
          message: `\`${rawType}\` is reserved for a later milestone and cannot be used yet`,
        },
      ],
    };
  }

  if (typeof rawType !== "string" || !(NODE_TYPES as readonly string[]).includes(rawType)) {
    return {
      issues: [
        {
          path: [...path, "type"],
          message: `expected one of ${NODE_TYPES.map((name) => `\`${name}\``).join(", ")}`,
        },
      ],
    };
  }

  const type = rawType as WorkflowNodeType;
  const issues: ValidationIssue[] = [
    ...collectUnknownKeyIssues(value, [...BASE_NODE_FIELDS, ...EXTRA_NODE_FIELDS[type]], path),
    ...collectBaseIssues(value, path),
    ...collectTypeIssues(value, type, path),
  ];

  // The key and the `id` are the same fact recorded twice, so a disagreement is
  // always a mistake: an edge would point at one and a trace would report the
  // other.
  if (isNodeId(value.id) && value.id !== key) {
    issues.push({
      path: [...path, "id"],
      message: `expected \`${key}\`, matching this node's key in \`nodes\``,
    });
  }

  if (issues.length > 0) {
    return { issues };
  }

  return { issues, node: readNode(value, type) };
}
