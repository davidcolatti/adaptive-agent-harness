import type { Budget } from "./context.js";
import { ValidationError, type ValidationIssue } from "./errors.js";
import { canonicalJson, fingerprint } from "./fingerprint.js";
import { deepFreeze } from "./freeze.js";
import {
  EXACT_VERSION_MESSAGE,
  IDENTIFIER_MESSAGE,
  isCapabilityIdentifier,
  isExactVersion,
  throwIfIssues,
} from "./identifiers.js";
import { isJsonValue, isPlainObject, type JsonValue } from "./json.js";
import { isNodeId, type NodeId, readWorkflowNode, type WorkflowNode } from "./workflow-nodes.js";

/**
 * The serializable workflow IR (M4-T1) and its parse boundary.
 *
 * This is the **authoritative** representation of a compiled workflow's
 * semantics (AD-013, ADR-0006, ADR-0007). The typed DSL (M4-T5) compiles *to*
 * it, the local runtime (M4-T6) interprets it, the code generator (M8) reads it,
 * and the fingerprint that decides whether two runs are comparable is taken over
 * it. Generated TypeScript is an artifact of the IR and never the other way
 * round: "the IR, not builder object identity, is fingerprinted".
 *
 * Three things follow from that, and they are why this module looks the way it
 * does:
 *
 * - **Everything is JSON.** {@link parseWorkflowDefinition} asserts it, so
 *   canonicalization is total and a workflow can be stored, diffed, reviewed and
 *   replayed. What a node *does* is named by a capability reference and resolved
 *   against the registry (AD-015); no import path, no source text and no closure
 *   is ever embedded.
 * - **Parse is strict and structural.** An unknown field is an error at every
 *   level, exactly as `parseJob()` treats one, because a workflow is a
 *   reproducible record and a field this version does not understand means the
 *   value was not written by this version.
 * - **Parse is not validation.** This module answers "is this a well-formed
 *   value?" and stops there. "Does every edge point at a node? Is every node
 *   reachable? Is every capability registered? Is this cycle a declared bounded
 *   loop?" are graph questions, answered by `compileWorkflow()` in
 *   `@internal/workflow` (M4-T4, M4-T9). The split is the same one `parseJob()`
 *   makes when it declines to validate `input` against a domain schema: a
 *   boundary function checks what it can see.
 *
 * `docs/contracts/workflow-ir.md` states the full contract, including the
 * per-node-execution idempotency key (M4-T7), which is deliberately **not** a
 * field here: a key is a property of a run, not of a workflow.
 */

/**
 * The IR format's own version.
 *
 * A literal `1`, so a future format change is a type error at every read site
 * rather than a silent misparse. It is the *format's* version and has nothing to
 * do with {@link WorkflowDefinition.version}, which is the workflow's.
 */
export const WORKFLOW_SCHEMA_VERSION = 1;

/**
 * One compiled workflow, as build plan M4-T1 states it plus the one field it
 * omits.
 *
 * **`version` is added** (ADR-0038). The plan's example has `id` but no
 * `version`, and three things need one: north-star invariants 3 and 4 ("every
 * workflow version is inspectable", "every behavior-affecting version is
 * fingerprinted"), `FallbackContext.workflow.version` in the plan's own section
 * 5, and the idempotency-key formula in M4-T7, which is literally "run +
 * **workflow version** + node + logical item + attempt". A workflow with no
 * version could satisfy none of them.
 *
 * **`domain` stays a plain id**, as the plan writes it, and deliberately does
 * **not** pin a domain version the way `Job.domain` does. A workflow is matched
 * to a job by the router (M5) on domain id plus job type, and a workflow that
 * pinned a domain version would stop matching the moment the domain's version
 * moved, for a reason that has nothing to do with the workflow. What the
 * workflow *does* pin is every capability it uses, exactly and by version, which
 * is where the compatibility question actually lives (AD-015, ADR-0015).
 *
 * Nodes live in a flat map rather than a tree. Control shapes reference their
 * sub-graphs by id, so `chain`, `branch`, `map`, `reduce` and `loop` are
 * ordinary entries in the same map as everything else. That is what makes the
 * graph enumerable without traversal — reachability, duplicate ids and unbounded
 * cycles are all questions about one object — and it is why a node's id appears
 * both as its key and as its `id` field.
 */
export interface WorkflowDefinition {
  /** The IR format version. Always {@link WORKFLOW_SCHEMA_VERSION}. */
  readonly schemaVersion: 1;
  /** The workflow's stable id, e.g. `vendor-triage`. */
  readonly id: string;
  /** The workflow's own exact `major.minor.patch` version. */
  readonly version: string;
  /** The domain id this workflow belongs to. Not version-pinned; see above. */
  readonly domain: string;
  /** The job type within that domain this workflow handles, e.g. `vendor-triage`. */
  readonly jobType: string;
  /** The schema the workflow's input satisfies, as `id@version`. */
  readonly inputSchema: string;
  /** The schema the workflow's output satisfies, as `id@version`. */
  readonly outputSchema: string;
  /** The node execution starts at. */
  readonly entry: NodeId;
  /**
   * Every node, keyed by its id.
   *
   * The workflow's output is the output of the node that ends the traversal:
   * the terminal node, whose `next` is `null`.
   */
  readonly nodes: { readonly [nodeId: string]: WorkflowNode };
}

/**
 * Why a compiled workflow handed the job back to the full agent.
 *
 * A **closed** union, because `FallbackContext.reason` is stored, aggregated and
 * compared: M5 counts fallbacks per reason to decide whether a workflow is
 * carrying its weight, and M6/M7 compare them across replays. A free-form string
 * would make "the same reason" a text-matching problem.
 *
 * **These are the build plan's eight M5-T4 reasons, not M4's six** (ADR-0044).
 * M4 named the six *mechanical* ways the interpreter stops — `escalate-node`,
 * `node-failed`, `budget-exceeded`, `validation-failed`, `decision-failed`,
 * `timeout`. Those answer "what did the runtime hit?", which is a question the
 * trace already answers through `detail` and `nodeId`. What a fallback is *for*
 * is telling the full agent, and later a human reading aggregates, **why the
 * compiled path could not be trusted with this job**, and that is the question
 * these eight answer. The mapping is explicit and lives in
 * `@internal/workflow`'s `escalationReasonFor()`.
 *
 * | Reason | Meaning | Raised by |
 * | --- | --- | --- |
 * | `low_confidence` | A judgment was made but is not confident enough to act on. | M3's policy layer. Never by the interpreter. |
 * | `unsupported_case` | The graph has no route it can justify for this job. | An `escalate` node, which is the designed exit. |
 * | `missing_evidence` | The evidence a route needs was not established. | A domain policy or an `escalate` node that says so. |
 * | `budget` | A budget dimension ran out, or a wall-clock limit expired. | `BudgetExceededError`, a node timeout. |
 * | `tool_failure` | A `call` node's tool kept failing. | A `call` node that exhausted its retries. |
 * | `schema_mismatch` | An input or output did not satisfy its schema. | `ValidationError`, at a node or at the workflow's own contract. |
 * | `policy` | Permission or policy refused the work. | `PermissionDeniedError`. |
 * | `workflow_error` | The compiled path broke in a way none of the above names. | An exhausted non-`call` node, an unusable decision. |
 *
 * A **closed** union, because `FallbackContext.reason` is stored, aggregated and
 * compared: M5 counts fallbacks per reason to decide whether a workflow is
 * carrying its weight, and M6/M7 compare them across replays. A free-form string
 * would make "the same reason" a text-matching problem. The free text that a
 * particular stop deserves lives in {@link FallbackContext.detail}, which is
 * never compared.
 */
export const FALLBACK_REASONS = [
  "low_confidence",
  "unsupported_case",
  "missing_evidence",
  "budget",
  "tool_failure",
  "schema_mismatch",
  "policy",
  "workflow_error",
] as const;

/** One of the eight reasons a workflow falls back to the full agent. */
export type FallbackReason = (typeof FALLBACK_REASONS)[number];

/**
 * The envelope a fallback carries to the full agent, exactly as build plan
 * section 5 states it.
 *
 * North-star invariant 1 is "a domain can always fall back to its full agent",
 * and this is what makes the fallback useful rather than merely possible: the
 * agent is handed the original immutable `Job` **plus** what the compiled path
 * already established, so it does not redo research the workflow already paid
 * for (invariant 9).
 *
 * `trusted` on a completed node is the load-bearing field. A node whose output
 * passed its schema and whose capability resolved is trusted; one that failed,
 * timed out or produced something unvalidated is not, and the agent is told
 * which is which rather than being handed a flat list it has to take on faith.
 *
 * It is declared here, beside the IR, because every field of it is about a
 * workflow. M5 is what constructs one and hands it to a runtime adapter.
 */
export interface FallbackContext {
  /** Why the compiled path stopped. */
  readonly reason: FallbackReason;
  /**
   * One line of free text saying what actually happened, for the agent and for
   * a human reading a trace.
   *
   * It carries what the closed {@link FallbackReason} deliberately cannot: an
   * `escalate` node's authored prose, the message of the error that exhausted a
   * node, the budget dimension that ran out. **Nothing compares it** — every
   * aggregate is over `reason` — so it is free to be specific (ADR-0044).
   */
  readonly detail: string;
  /**
   * The node that gave up, or `null` when the workflow itself did.
   *
   * `null` is the honest answer for a stop that belongs to no node: the
   * workflow's own input or output contract failing, or a budget that ran out
   * between nodes.
   */
  readonly nodeId: NodeId | null;
  /** Which workflow stopped, by id, version and IR fingerprint. */
  readonly workflow: {
    readonly id: string;
    readonly version: string;
    readonly fingerprint: string;
  };
  /** What the compiled path already completed, and whether each result is trusted. */
  readonly completedNodes: readonly {
    readonly nodeId: NodeId;
    /**
     * The durable pointer to this node's result, `node:<id>`.
     *
     * Build plan section 5's field, kept unchanged. It is what a reader with
     * access to the run's trace or storage resolves; {@link output} is what a
     * reader with neither can use.
     */
    readonly outputRef: string;
    readonly trusted: boolean;
    /**
     * The node's **validated output**, inline, or `null` when it could not be
     * carried (ADR-0044).
     *
     * A deviation from build plan section 5, which names only `outputRef`. That
     * shape assumes the agent can dereference a pointer, and across the only
     * channel a fallback actually has — the runtime adapter's context surface,
     * a turn's `clientContext` for eve — it cannot: an agent is a model, not a
     * process with a `Storage` handle. An envelope of pointers nothing can
     * follow would make M5-T5's "the full agent should not blindly repeat
     * completed research" unachievable, so the evidence travels with the
     * reference rather than instead of it.
     *
     * **Every entry in `completedNodes` validated**, or it would not be listed,
     * so M5-T6's "failed/partial node output is not automatically reusable" is
     * satisfied by the list's membership rather than by this field: a failed or
     * partial node is absent, not present with a `null` output.
     *
     * `trusted` still decides how the value may be *used*, and carrying an
     * untrusted output is deliberate: an `agent` or `jev` result is exactly
     * what a full agent most needs to see and least should take on faith, and
     * telling it "this exists, here it is, weigh it" is stronger than telling
     * it "this exists somewhere".
     *
     * `null` means the value was dropped to keep the envelope inside its size
     * budget, never that the node failed. `outputRef` still points at it, and
     * `detail` says so.
     */
    readonly output: JsonValue | null;
  }[];
  /** References to the evidence gathered so far, so the agent need not re-research. */
  readonly evidenceRefs: readonly string[];
  /** What is left of the job's budget. */
  readonly remainingBudget: Budget;
}

/**
 * The nine fields a workflow definition has, and the only nine
 * {@link parseWorkflowDefinition} accepts.
 */
const DEFINITION_FIELDS = [
  "schemaVersion",
  "id",
  "version",
  "domain",
  "jobType",
  "inputSchema",
  "outputSchema",
  "entry",
  "nodes",
] as const;

/** A path into the value being validated, used for every issue's `path`. */
type IssuePath = readonly (string | number)[];

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
 * Validate a capability reference in its string form, `id@version`.
 *
 * Duplicated from `workflow-nodes.ts` rather than shared, because exporting a
 * collector from that module would widen a surface whose only legitimate
 * consumer is this one.
 */
function collectRefStringIssues(value: unknown, path: IssuePath): ValidationIssue[] {
  if (typeof value !== "string") {
    return [{ path: [...path], message: "expected a capability reference string" }];
  }

  const [id, version, ...rest] = value.split("@");

  if (rest.length > 0 || id === undefined || version === undefined) {
    return [
      {
        path: [...path],
        message: "expected the form `id@version`, e.g. `vendor-triage.input@1.0.0`",
      },
    ];
  }

  const issues: ValidationIssue[] = [];

  if (!isCapabilityIdentifier(id)) {
    issues.push({ path: [...path], message: IDENTIFIER_MESSAGE });
  }

  if (!isExactVersion(version)) {
    issues.push({ path: [...path], message: EXACT_VERSION_MESSAGE });
  }

  return issues;
}

/** Validate the `nodes` map and rebuild every node it contains. */
function readNodes(
  value: unknown,
  path: IssuePath,
): {
  readonly issues: readonly ValidationIssue[];
  readonly nodes?: { readonly [nodeId: string]: WorkflowNode };
} {
  if (!isPlainObject(value)) {
    return { issues: [{ path: [...path], message: "expected an object of workflow nodes" }] };
  }

  const keys = Object.keys(value);

  if (keys.length === 0) {
    return { issues: [{ path: [...path], message: "expected at least one node" }] };
  }

  const issues: ValidationIssue[] = [];
  const nodes: { [nodeId: string]: WorkflowNode } = {};

  for (const key of keys) {
    if (!isNodeId(key)) {
      issues.push({ path: [...path, key], message: IDENTIFIER_MESSAGE });
      continue;
    }

    const result = readWorkflowNode(value[key], key, [...path, key]);

    if (result.node === undefined) {
      issues.push(...result.issues);
      continue;
    }

    nodes[key] = result.node;
  }

  return issues.length > 0 ? { issues } : { issues, nodes };
}

/**
 * The single validation pass {@link isWorkflowDefinition} and
 * {@link parseWorkflowDefinition} share.
 *
 * It returns the issues it found and, when it found none, the definition rebuilt
 * from exactly the fields it validated. Rebuilding rather than casting is what
 * makes "the return value has no unknown fields" true, and it is what makes the
 * canonical bytes a function of the contract rather than of the caller's literal.
 */
function readWorkflowDefinition(
  value: unknown,
  path: IssuePath,
): { readonly issues: readonly ValidationIssue[]; readonly definition?: WorkflowDefinition } {
  if (!isPlainObject(value)) {
    return { issues: [{ path: [...path], message: "expected a workflow definition object" }] };
  }

  // Checked before anything walks the value: `isJsonValue` is also the cycle
  // guard, and every later collector assumes it can recurse safely. A `Date`, a
  // `NaN` or a class instance anywhere in the IR would make canonicalization
  // lossy or impossible, which is the one thing a fingerprinted record cannot
  // tolerate.
  if (!isJsonValue(value)) {
    return {
      issues: [
        {
          path: [...path],
          message:
            "expected a JSON value: no `undefined`, function, `Date`, non-finite number or cycle",
        },
      ],
    };
  }

  const issues: ValidationIssue[] = [...collectUnknownKeyIssues(value, DEFINITION_FIELDS, path)];

  if (value.schemaVersion !== WORKFLOW_SCHEMA_VERSION) {
    issues.push({
      path: [...path, "schemaVersion"],
      message: `expected ${String(WORKFLOW_SCHEMA_VERSION)}, the only workflow IR format this version understands`,
    });
  }

  for (const field of ["id", "domain", "jobType"] as const) {
    if (!isCapabilityIdentifier(value[field])) {
      issues.push({ path: [...path, field], message: IDENTIFIER_MESSAGE });
    }
  }

  if (!isExactVersion(value.version)) {
    issues.push({ path: [...path, "version"], message: EXACT_VERSION_MESSAGE });
  }

  issues.push(...collectRefStringIssues(value.inputSchema, [...path, "inputSchema"]));
  issues.push(...collectRefStringIssues(value.outputSchema, [...path, "outputSchema"]));

  if (!isNodeId(value.entry)) {
    issues.push({ path: [...path, "entry"], message: IDENTIFIER_MESSAGE });
  }

  const nodesResult = readNodes(value.nodes, [...path, "nodes"]);
  issues.push(...nodesResult.issues);

  if (issues.length > 0 || nodesResult.nodes === undefined) {
    return { issues };
  }

  return {
    issues,
    definition: {
      schemaVersion: WORKFLOW_SCHEMA_VERSION,
      id: value.id as string,
      version: value.version as string,
      domain: value.domain as string,
      jobType: value.jobType as string,
      inputSchema: value.inputSchema as string,
      outputSchema: value.outputSchema as string,
      entry: value.entry as NodeId,
      nodes: nodesResult.nodes,
    },
  };
}

/**
 * True when `value` is a well-formed {@link WorkflowDefinition}.
 *
 * A pure predicate: unlike {@link parseWorkflowDefinition} it freezes nothing
 * and allocates nothing the caller can see. It agrees with
 * `parseWorkflowDefinition` exactly — both run the same pass — so
 * "`isWorkflowDefinition(v)` is true" and "`parseWorkflowDefinition(v)` does not
 * throw" are the same statement.
 *
 * It says nothing about the *graph*. A definition whose `entry` names no node
 * passes here and fails `compileWorkflow()` (M4-T4).
 */
export function isWorkflowDefinition(value: unknown): value is WorkflowDefinition {
  return readWorkflowDefinition(value, []).issues.length === 0;
}

/**
 * Turn an untrusted value into a {@link WorkflowDefinition}, or throw explaining
 * why it is not one.
 *
 * This is the boundary a workflow comes back through, the sibling of
 * `parseJob()` and `parseTraceEvent()`: the DSL's compiled output, a registry
 * row (M5), a replayed workflow (M6) and a compiler proposal (M8) all hold an
 * `unknown` that claims to be a workflow, and this is what makes the claim true
 * rather than asserted. A compiler proposal is the case that matters most: a
 * model may propose IR, and nothing downstream of this function should have to
 * wonder whether the proposal was well formed.
 *
 * ```ts
 * const definition = parseWorkflowDefinition(JSON.parse(row.ir));
 * const digest = workflowFingerprint(definition);
 * ```
 *
 * What it checks:
 *
 * | Field | Rule |
 * | --- | --- |
 * | the whole value | A JSON value: no `undefined`, function, `Date`, non-finite number or cycle. |
 * | `schemaVersion` | Exactly `1`. |
 * | `id`, `domain`, `jobType` | Identifiers, by the rule in `identifiers.ts`. |
 * | `version` | An exact `major.minor.patch` version. |
 * | `inputSchema`, `outputSchema` | Capability reference strings, `id@version`. |
 * | `entry` | An identifier. Whether it names a node is the validator's question. |
 * | `nodes` | Non-empty; every key an identifier; every value a node whose `id` equals its key. |
 * | every node | Its ten base fields plus exactly the extra fields its `type` declares. |
 *
 * The two reserved node types, `human` and `subworkflow`, are rejected **by
 * name** with their own message rather than as unknown types, because "reserved
 * for a later milestone" and "you have a typo" are different problems.
 *
 * Every problem is reported at once, each with the path to the field that caused
 * it. An unknown field anywhere is an error, not something to drop.
 *
 * The returned definition is **deep-frozen**, for the same reason a job is: a
 * workflow read back is as immutable as a workflow just compiled, and a mutated
 * node would silently disagree with the fingerprint taken over it.
 *
 * **It does not validate the graph.** Unreachable nodes, missing nodes,
 * incompatible schemas, undeclared cycles, a `branch` with no `default`, a
 * `code` node with tool grants and a `non-idempotent-write` `call` without
 * protection are all well-formed *values* and invalid *workflows*;
 * `compileWorkflow()` in `@internal/workflow` (M4-T4, M4-T9) is what rejects
 * them, and it also resolves every capability reference, which this function
 * cannot do because it has no registry to ask.
 *
 * @throws {ValidationError} listing every field that failed.
 */
export function parseWorkflowDefinition(value: unknown, path: IssuePath = []): WorkflowDefinition {
  const { issues, definition } = readWorkflowDefinition(value, path);

  throwIfIssues("parseWorkflowDefinition: value is not a workflow definition", issues);

  // Unreachable: `readWorkflowDefinition` returns a definition whenever it
  // returns no issues, and `throwIfIssues` has already left if there were any.
  if (definition === undefined) {
    throw new ValidationError("parseWorkflowDefinition: value is not a workflow definition", {
      issues: [{ path: [...path], message: "expected a workflow definition object" }],
    });
  }

  return deepFreeze(definition);
}

/**
 * View a parsed definition as the {@link JsonValue} it provably is.
 *
 * The cast is unavoidable and is the one place it happens. A TypeScript
 * interface without an index signature is not assignable to `JsonObject` even
 * when every one of its properties is a `JsonValue`, so the structural fact that
 * {@link parseWorkflowDefinition} has already established at runtime — the whole
 * value passed `isJsonValue` — cannot be expressed to the compiler any other
 * way. It is a cast, not an `any`: the value has been checked.
 */
function asJson(definition: WorkflowDefinition): JsonValue {
  return definition as unknown as JsonValue;
}

/**
 * The canonical JSON bytes of a workflow definition (M4-T9, step 4 and 6).
 *
 * `canonicalJson` sorts object keys by UTF-16 code unit and preserves array
 * order, so two definitions that describe the same workflow produce identical
 * bytes whatever order their literals were written in (ADR-0029). That is what
 * makes the fingerprint a property of the workflow rather than of the file.
 *
 * It parses first. Canonicalizing an unvalidated value would happily encode a
 * tenth top-level field or a node type this version does not understand, and the
 * resulting digest would claim to describe a workflow the harness cannot run. A
 * caller that already holds a parsed definition pays only the second pass; a
 * caller that does not gets the guarantee.
 *
 * @throws {ValidationError} if `definition` is not a well-formed workflow.
 */
export function canonicalWorkflowIr(definition: unknown): string {
  return canonicalJson(asJson(parseWorkflowDefinition(definition)));
}

/**
 * The workflow fingerprint: `sha256:` + the hex digest of
 * {@link canonicalWorkflowIr}'s bytes.
 *
 * "Same IR produces same workflow fingerprint" is a Milestone 4 acceptance
 * criterion, and "the IR, not builder object identity, is fingerprinted" is
 * M4-T5's rule; both are this function. It is also the `workflowIr` component of
 * the behavior fingerprint (M2-T8, ADR-0034), the value
 * `FallbackContext.workflow.fingerprint` carries, and what M6 compares to decide
 * whether two runs are comparable at all.
 *
 * The digest covers **the whole definition**, including each node's version,
 * timeout, retry policy, budget and tool grants. Narrowing a node's permissions
 * changes the fingerprint, which is correct: it is a behavior change, and
 * invariant 4 says every behavior-affecting version is fingerprinted.
 *
 * It hashes exactly the bytes {@link canonicalWorkflowIr} returns, because
 * `fingerprint()` canonicalizes with the same `canonicalJson()` before hashing
 * (ADR-0029). It is written over the parsed value rather than over that string
 * so the digest is of the canonical **IR**, not of a JSON-escaped copy of it.
 *
 * @throws {ValidationError} if `definition` is not a well-formed workflow.
 */
export function workflowFingerprint(definition: unknown): string {
  return fingerprint(asJson(parseWorkflowDefinition(definition)));
}
