// The public surface of `@internal/workflow`: graph validation, the typed DSL
// and the local deterministic runtime for the workflow IR.
//
// The split this package rests on is the one `@internal/trace` already follows,
// and ADR-0038 records it: `@internal/core` owns the **contract** — the
// `WorkflowDefinition` types, the strict `parseWorkflowDefinition()` boundary,
// `canonicalWorkflowIr()` and `workflowFingerprint()` — and this package owns
// **behavior over it**. Core therefore stays a contract package with no
// execution in it, and the runtime, the validator and the DSL can grow here
// without widening what every other package depends on.
//
// M4-T1/M4-T2 scaffolded this package and gave it exactly one export, the
// result type the rest of Milestone 4 hands between its halves. M4-T4/M4-T9
// added `compileWorkflow()` and `validateWorkflow()`, M4-T5 added the typed
// DSL, and M4-T3/M4-T6/M4-T7/M4-T8 added the local deterministic interpreter.
//
// The package declares no third-party dependency and must keep none; it is not
// an adapter, so `tests/architecture/boundaries.ts` gives it the same bans
// `@internal/core` carries.
//
// Re-exports are listed by name rather than starred, so a symbol becomes public
// deliberately.

// Graph validation, node rules and capability resolution (M4-T4, M4-T9).
// `compileWorkflow()` is the only way to obtain a `CompiledWorkflow`;
// `validateWorkflow()` is the same checks without the throw, for the DSL and the
// inspector. ADR-0039 records the graph model, the one-owner rule and the
// reference-equality schema check.
export { compileWorkflow } from "./compile.js";
export type { CompiledWorkflow } from "./compiled.js";
// The typed DSL (M4-T5). `workflow()` is the authoring entry point; it compiles
// to `WorkflowDefinition` and is fingerprinted through the IR, never through
// builder identity. It never resolves capabilities: hand its output to
// `compileWorkflow()` for that. ADR-0041 records the builder design and its
// defaults.
export {
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
  type GrantingNodeOptions,
  type JevNodeOptions,
  type LoopConditionInput,
  type LoopNodeOptions,
  type MapNodeOptions,
  type NodeDefaults,
  type ReduceNodeOptions,
  type RefInput,
  type SubGraph,
  type SubGraphBuilder,
  type SubGraphEnd,
  type TypedBinding,
  type WorkflowBuilder,
  type WorkflowOptions,
  workflow,
} from "./dsl/index.js";
// The local deterministic runtime (M4-T3 execution half, M4-T6, M4-T7, M4-T8).
// `createWorkflowRuntime()` interprets a `CompiledWorkflow` and nothing else;
// `asAgentRuntime()` presents one to `createHarness()` so trace, storage and
// `pnpm harness run show` keep working with no router. The three ports
// (`WorkflowDecisionPort` for M3, `ArtifactStorePort` for M5,
// `ProtectedEffectStore` for M4-T7's protection) default to in-memory
// implementations, because M4-T6 says not to build durability yet. ADR-0040
// records the run-state model, the two idempotency keys, the `node.*` payload
// amendment to ADR-0031 and the escalation policy.
//
// The binding evaluator (`evaluateBinding`, `readPath`, `asJsonValue`), the
// budget ledger (`createBudgetLedger`, `narrowBudget`) and the grant assertions
// (`assertGrantsWithinJob`, `assertToolGranted`, `requiredMode`) are
// deliberately **not** here, nor are their types. They are how the interpreter
// is built rather than what a caller of it needs, and the package's rule is that
// a symbol becomes public deliberately. They stay exported from
// `./runtime/index.js`, which is how this package's own tests reach them.
//
// The two idempotency-key functions are the exception, because
// `docs/contracts/workflow-ir.md` states their formula as part of the contract,
// so something outside this package will eventually derive the same key. They
// take a structural argument, so a caller writes an object literal rather than
// naming `IdempotencyCoordinates`. `fallbackContextPayload` is public because
// M5's router has to read an escalation's envelope as JSON.
export type {
  AbortedWorkflowRun,
  ArtifactSaveInput,
  ArtifactStorePort,
  CompletedWorkflowRun,
  CreateDecisionPortOptions,
  CreateWorkflowRuntimeOptions,
  DecisionNodeOutput,
  EscalatedWorkflowRun,
  FailedWorkflowRun,
  InMemoryArtifact,
  InMemoryArtifactStore,
  InMemoryProtectedEffectStore,
  NodeExecutionRecord,
  ProtectedEffectRecord,
  ProtectedEffectStore,
  QuestionRegistry,
  SavedArtifact,
  WorkflowDecisionPort,
  WorkflowDecisionRequest,
  WorkflowRunResult,
  WorkflowRuntime,
} from "./runtime/index.js";
export {
  attemptIdempotencyKey,
  // The bridge from `WorkflowDecisionPort` to M3's `DecisionEngine` (M3-T2).
  // A `jev` node names a question; this is what looks one up and answers it.
  createDecisionPort,
  createInMemoryArtifactStore,
  createInMemoryProtectedEffectStore,
  createWorkflowRuntime,
  fallbackContextPayload,
  protectionIdempotencyKey,
} from "./runtime/index.js";
export type { GraphAnalysis, Region } from "./validate/index.js";
export { analyzeGraph, validateWorkflow } from "./validate/index.js";
