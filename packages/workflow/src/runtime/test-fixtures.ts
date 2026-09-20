import type {
  AgentNode,
  ArtifactNode,
  Binding,
  BranchNode,
  Budget,
  CallNode,
  CapabilityRegistry,
  ChainNode,
  CodeNode,
  DomainRef,
  EscalateNode,
  ExecutionContext,
  JevNode,
  Job,
  JsonValue,
  LoopNode,
  MapNode,
  NodeId,
  ReduceNode,
  Schema,
  ToolGrant,
  WorkflowDefinition,
  WorkflowNode,
} from "@internal/core";
import {
  canonicalWorkflowIr,
  createCapabilityRegistry,
  createExecutionContext,
  newJobId,
  newRunId,
  parseWorkflowDefinition,
  workflowFingerprint,
} from "@internal/core";
import { createRecordingTraceWriter, type RecordingTraceWriter } from "@internal/testing";
import type { CompiledWorkflow } from "../compiled.js";

/**
 * Fixtures shared by the runtime's test files.
 *
 * It is a plain module rather than a `*.test.ts` one so that importing it does
 * not re-run another file's suite, and it is deliberately **not** re-exported
 * from `src/index.ts` or `src/runtime/index.ts`: nothing outside these tests
 * should be able to reach it.
 *
 * Every schema here is a hand-written Standard Schema. `@internal/workflow`
 * declares no third-party dependency and must keep none, so a fixture that
 * needed `zod` would be the first one (ADR-0027 is what makes the hand-written
 * form possible: a schema is structural, not a library).
 */

/** A schema that accepts anything and returns it unchanged. */
export function passSchema(): Schema<unknown> {
  return {
    "~standard": { version: 1, vendor: "harness-test", validate: (value: unknown) => ({ value }) },
  };
}

/** A schema that accepts only values `predicate` approves of. */
export function guardSchema(
  predicate: (value: unknown) => boolean,
  message: string,
): Schema<unknown> {
  return {
    "~standard": {
      version: 1,
      vendor: "harness-test",
      validate: (value: unknown) =>
        predicate(value) ? { value } : { issues: [{ message, path: [] }] },
    },
  };
}

/** A schema that requires an object with a `label` string, which is what a `branch` outputs. */
export function labelSchema(): Schema<unknown> {
  return guardSchema(
    (value) =>
      typeof value === "object" &&
      value !== null &&
      typeof (value as { label?: unknown }).label === "string",
    "expected `{ label: string }`",
  );
}

/** Register `id@1.0.0` as a `schema` capability. */
export function registerSchema(
  registry: CapabilityRegistry,
  id: string,
  schema: Schema<unknown> = passSchema(),
): void {
  registry.register("schema", {
    id,
    version: "1.0.0",
    module: "src/schemas.ts",
    exportName: id,
    value: schema,
  });
}

/** Register a callable capability (`handler`, `tool` or `policy`) at `1.0.0`. */
export function registerFunction(
  registry: CapabilityRegistry,
  kind: "handler" | "tool" | "policy",
  id: string,
  value: (...args: never[]) => unknown,
): void {
  registry.register(kind, {
    id,
    version: "1.0.0",
    module: `src/${kind}s.ts`,
    exportName: id,
    value,
  });
}

/** A registry with `test.any@1.0.0` registered, which most fixture nodes use. */
export function createTestRegistry(): CapabilityRegistry {
  const registry = createCapabilityRegistry();

  registerSchema(registry, "test.any");

  return registry;
}

/** The capability reference every fixture node uses unless it needs its own. */
export const ANY_SCHEMA = "test.any@1.0.0";

/** The fields every fixture node shares, so a test states only what it is about. */
interface NodeCommon {
  readonly input?: Binding;
  readonly inputSchema?: string;
  readonly outputSchema?: string;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
  readonly backoffMs?: number;
  readonly budget?: Budget;
  readonly permissions?: readonly ToolGrant[];
}

function base(
  id: string,
  common: NodeCommon,
): {
  readonly id: NodeId;
  readonly version: string;
  readonly inputSchema: string;
  readonly outputSchema: string;
  readonly timeoutMs: number;
  readonly retry: { readonly maxAttempts: number; readonly backoffMs?: number };
  readonly budget: Budget;
  readonly permissions: readonly ToolGrant[];
  readonly input: Binding;
} {
  return {
    id,
    version: "1.0.0",
    inputSchema: common.inputSchema ?? ANY_SCHEMA,
    outputSchema: common.outputSchema ?? ANY_SCHEMA,
    timeoutMs: common.timeoutMs ?? 1_000,
    retry: {
      maxAttempts: common.maxAttempts ?? 1,
      ...(common.backoffMs === undefined ? {} : { backoffMs: common.backoffMs }),
    },
    budget: common.budget ?? {},
    permissions: common.permissions ?? [],
    input: common.input ?? { kind: "input" },
  };
}

/** Build a `code` node. */
export function codeNode(
  id: string,
  handler: string,
  next: NodeId | null,
  common: NodeCommon = {},
): CodeNode {
  return {
    ...base(id, common),
    type: "code",
    handler: { id: handler, version: "1.0.0" },
    next,
  };
}

/** Build a `call` node. */
export function callNode(
  id: string,
  tool: string,
  effect: CallNode["effect"],
  next: NodeId | null,
  common: NodeCommon & { readonly protection?: { readonly kind: "idempotency-key" } } = {},
): CallNode {
  return {
    ...base(id, common),
    type: "call",
    tool: { id: tool, version: "1.0.0" },
    effect,
    ...(common.protection === undefined ? {} : { protection: common.protection }),
    next,
  };
}

/** Build a `jev` node. */
export function jevNode(
  id: string,
  question: string,
  questionKind: JevNode["questionKind"],
  next: NodeId | null,
  common: NodeCommon = {},
): JevNode {
  return {
    ...base(id, common),
    type: "jev",
    question: { id: question, version: "1.0.0" },
    questionKind,
    next,
  };
}

/** Build an `agent` node. */
export function agentNode(
  id: string,
  agent: string,
  next: NodeId | null,
  common: NodeCommon = {},
): AgentNode {
  return { ...base(id, common), type: "agent", agent: { id: agent, version: "1.0.0" }, next };
}

/** Build an `artifact` node. */
export function artifactNode(
  id: string,
  name: string,
  next: NodeId | null,
  common: NodeCommon & { readonly contentType?: string } = {},
): ArtifactNode {
  return {
    ...base(id, common),
    type: "artifact",
    name,
    ...(common.contentType === undefined ? {} : { contentType: common.contentType }),
    next,
  };
}

/** Build an `escalate` node. */
export function escalateNode(id: string, reason: string, common: NodeCommon = {}): EscalateNode {
  return { ...base(id, common), type: "escalate", reason };
}

/** Build a `chain` node. */
export function chainNode(
  id: string,
  steps: readonly NodeId[],
  next: NodeId | null,
  common: NodeCommon = {},
): ChainNode {
  return { ...base(id, common), type: "chain", steps, next };
}

/** Build a `branch` node. */
export function branchNode(
  id: string,
  on: BranchNode["on"],
  cases: BranchNode["cases"],
  fallback: NodeId,
  common: NodeCommon = {},
): BranchNode {
  return { ...base(id, common), type: "branch", on, cases, default: fallback };
}

/** Build a `map` node. */
export function mapNode(
  id: string,
  items: Binding,
  body: NodeId,
  maxItems: number,
  next: NodeId | null,
  common: NodeCommon & { readonly concurrency?: number } = {},
): MapNode {
  return {
    ...base(id, common),
    type: "map",
    items,
    body,
    maxItems,
    ...(common.concurrency === undefined ? {} : { concurrency: common.concurrency }),
    next,
  };
}

/** Build a `reduce` node. */
export function reduceNode(
  id: string,
  items: Binding,
  handler: string,
  initial: JsonValue,
  next: NodeId | null,
  common: NodeCommon = {},
): ReduceNode {
  return {
    ...base(id, common),
    type: "reduce",
    items,
    handler: { id: handler, version: "1.0.0" },
    initial,
    next,
  };
}

/** Build a `loop` node. */
export function loopNode(
  id: string,
  body: NodeId,
  maxIterations: number,
  until: LoopNode["until"],
  next: NodeId | null,
  common: NodeCommon = {},
): LoopNode {
  return { ...base(id, common), type: "loop", body, maxIterations, until, next };
}

/** Options for {@link compiledWorkflow}. */
export interface CompiledWorkflowOptions {
  readonly id?: string;
  readonly version?: string;
  readonly inputSchema?: string;
  readonly outputSchema?: string;
}

/**
 * Build a {@link CompiledWorkflow} by hand: parse, canonicalize, fingerprint.
 *
 * Deliberately **not** through `compileWorkflow()` for most tests. These suites
 * are about what the interpreter does with a workflow whose guarantees already
 * hold, and going through the validator would couple every runtime test to the
 * validator's graph and schema-compatibility rules. One test in
 * `workflow-runtime.test.ts` does go through `compileWorkflow()`, which is what
 * proves the two halves fit together.
 */
export function compiledWorkflow(
  entry: NodeId,
  nodes: readonly WorkflowNode[],
  options: CompiledWorkflowOptions = {},
): CompiledWorkflow {
  const definition: WorkflowDefinition = parseWorkflowDefinition({
    schemaVersion: 1,
    id: options.id ?? "test-workflow",
    version: options.version ?? "1.0.0",
    domain: "test-domain",
    jobType: "test-job",
    inputSchema: options.inputSchema ?? ANY_SCHEMA,
    outputSchema: options.outputSchema ?? ANY_SCHEMA,
    entry,
    nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
  });

  return Object.freeze({
    definition,
    canonicalJson: canonicalWorkflowIr(definition),
    fingerprint: workflowFingerprint(definition),
  });
}

/** The domain every fixture job belongs to. */
export const TEST_DOMAIN: DomainRef = { id: "test-domain", version: "1.0.0" };

/** Options for {@link createRunFixture}. */
export interface RunFixtureOptions {
  readonly input?: unknown;
  readonly budget?: Budget;
  readonly permissions?: readonly ToolGrant[];
  readonly signal?: AbortSignal;
}

/** A job, a context recording into a writer, and the writer. */
export interface RunFixture {
  readonly job: Job;
  readonly context: ExecutionContext;
  readonly trace: RecordingTraceWriter;
}

/** Build the job and execution context a runtime test runs against. */
export function createRunFixture(options: RunFixtureOptions = {}): RunFixture {
  const trace = createRecordingTraceWriter();
  const jobId = newJobId();
  const job: Job = {
    id: jobId,
    domain: TEST_DOMAIN,
    jobType: "test-job",
    objective: "exercise the local workflow runtime",
    input: options.input ?? { value: 1 },
    contracts: { inputSchema: ANY_SCHEMA, outputSchema: ANY_SCHEMA, sop: "test-sop" },
    budget: options.budget ?? {},
    permissions: options.permissions ?? [],
    metadata: {},
  };
  const context = createExecutionContext({
    runId: newRunId(),
    jobId,
    domain: TEST_DOMAIN,
    budget: options.budget ?? {},
    permissions: options.permissions ?? [],
    trace,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });

  return { job, context, trace };
}

/** A `sleep` that records what it was asked to wait for and never actually waits. */
export function recordingSleep(): {
  readonly waits: readonly number[];
  readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
} {
  const waits: number[] = [];

  return {
    waits,
    sleep(ms: number): Promise<void> {
      waits.push(ms);

      return Promise.resolve();
    },
  };
}
