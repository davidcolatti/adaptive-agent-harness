// The public surface of `@internal/core`.
//
// Milestone 1 fills this package with the contracts specified in
// `docs/milestones/build-plan.md` section 5. Present so far: the execution
// context (M1-T7), the error taxonomy (M1-T8), the schema boundary, `Job`,
// `DomainDefinition` and `defineDomain()` (M1-T3), `AgentRuntime` with
// `AgentExecution` (M1-T5), `createHarness()` (M1-T4), and the capability
// registry with its canonical-JSON fingerprint scheme (M1-T9). Milestone 2 adds
// the sortable entity-ID scheme and its twelve brands (M2-T1), the
// finalized `Job` contract with `deepFreeze` and `parseJob` (M2-T2), and the
// behavior fingerprint (M2-T8). Milestone 4 adds the serializable workflow IR
// and its node contracts (M4-T1, M4-T2), with validation, the typed DSL and the
// local runtime living in `@internal/workflow` (ADR-0038).
//
// Re-exports are listed by name rather than starred, so this file states the
// package's public surface and a symbol becomes public deliberately. Their
// order is the one Biome's import organizer imposes: by module, types before
// values.
//
// The package has no dependencies and must keep none. The dependency rule
// (AGENTS.md, build plan section 4) forbids `core` from importing `eve`,
// Supabase or any domain code, and `tests/architecture/boundaries.ts` enforces
// it.

// Agent runtime contract (M1-T5).
export type {
  AbortedAgentExecution,
  AgentExecution,
  AgentExecutionUsage,
  AgentRuntime,
  CompletedAgentExecution,
  FailedAgentExecution,
} from "./agent-runtime.js";

// The behavior fingerprint (M2-T8; ADR-0034). What is hashed to answer "is this
// the same behavior?": instructions, SOP, skills, tool definitions, model
// configuration, schemas, workflow IR and policy thresholds, component by
// component. ADR-0029 owns *how* it is hashed.
export type {
  BehaviorComponentName,
  BehaviorDescriptor,
  BehaviorFingerprint,
  BehaviorFingerprintAlgorithm,
  BehaviorFingerprintScheme,
  BehaviorSchema,
  BehaviorSkill,
  BehaviorSource,
  BehaviorTool,
} from "./behavior.js";
export {
  BEHAVIOR_COMPONENT_NAMES,
  BEHAVIOR_FINGERPRINT_ALGORITHM,
  BEHAVIOR_FINGERPRINT_SCHEME,
  behaviorFingerprintPayload,
  behaviorFingerprintsMatch,
  createBehaviorFingerprint,
  diffBehaviorComponents,
  resolveBehaviorFingerprint,
} from "./behavior.js";

// Capability registry (M1-T9). AD-015; ADR-0029 for the fingerprint scheme.
export type {
  CapabilityKind,
  CapabilityManifest,
  CapabilityManifestEntry,
  CapabilityRef,
  CapabilityRegistration,
  CapabilityRegistry,
} from "./capabilities.js";
export {
  CAPABILITY_KINDS,
  capabilityFingerprint,
  createCapabilityRegistry,
  formatCapabilityRef,
  parseCapabilityRefString,
} from "./capabilities.js";

// Execution context (M1-T7).
export type {
  Budget,
  CreateExecutionContextInput,
  DomainRef,
  ExecutionContext,
  RuntimeInfo,
  RuntimeInfoInput,
  ToolGrant,
  ToolGrantMode,
} from "./context.js";
export { createExecutionContext, HARNESS_RUNTIME_INFO } from "./context.js";

// The decision contract (M3-T1, M3-T4, M3-T5, M3-T6; ADR-0009, ADR-0042).
// Questions, the `DecisionEngine` port, confidence bands and the deterministic
// policy API. Core declares the contract; `@internal/decision-jev` implements
// the engine over the AI SDK's experimental evaluation API and is the only
// package that may see it.
export type {
  AnswerFor,
  Band,
  BooleanCriteria,
  BooleanDecisionAnswer,
  BooleanQuestion,
  ChoiceDecisionAnswer,
  ChoiceQuestion,
  ConfidenceBands,
  DecisionAnswer,
  DecisionAnswerBase,
  DecisionEngine,
  DecisionModelRef,
  DecisionRequest,
  DecisionResult,
  DecisionUsage,
  DefinePolicyConfig,
  DerivableAnswer,
  Policy,
  PolicyDecision,
  PolicyOutcome,
  Question,
  QuestionBase,
  QuestionKind,
  QuestionSet,
  ScoreDecisionAnswer,
  ScoreQuestion,
  ScoreRange,
} from "./decision.js";
export {
  BANDS,
  bandFor,
  bandForConfidence,
  defineConfidenceBands,
  definePolicy,
  defineQuestion,
  defineQuestionSet,
  deriveConfidence,
  policyFingerprint,
  QUESTION_KINDS,
  scoreRange,
} from "./decision.js";

// Persisted decision evidence and pure policy replay (M3-T3; ADR-0045). The
// record's `result` is exactly what the engine produced and its `policy` is
// exactly what the organization decided, which is what makes
// `replayDecisions()` a function of stored bytes rather than a second Jev bill.
export type {
  DecisionRecord,
  DecisionReplayReport,
  ReplayedDecision,
  RouteChange,
} from "./decision-record.js";
export { parseDecisionRecord, replayDecisions } from "./decision-record.js";
// Domain definition (M1-T3).
export type {
  CreateJobInput,
  DefineDomainConfig,
  DomainDefinition,
  DomainEval,
} from "./domain.js";
export { defineDomain } from "./domain.js";
// Error taxonomy (M1-T8).
export type {
  BudgetDimension,
  BudgetExceededErrorOptions,
  HarnessErrorCode,
  HarnessErrorOptions,
  PermissionDeniedErrorOptions,
  ReplayMismatchErrorOptions,
  SerializedHarnessError,
  SerializeErrorOptions,
  ToolExecutionErrorOptions,
  ValidationErrorOptions,
  ValidationIssue,
} from "./errors.js";
export {
  AgentExecutionError,
  BudgetExceededError,
  DecisionError,
  HarnessError,
  isHarnessError,
  MAX_SERIALIZED_CAUSE_DEPTH,
  PermissionDeniedError,
  ReplayMismatchError,
  StorageError,
  serializeError,
  ToolExecutionError,
  ValidationError,
  WorkflowError,
} from "./errors.js";
// Canonical JSON and behavior fingerprints (M1-T9; ADR-0029). M2-T8 extends
// what is fingerprinted, not how.
export { canonicalJson, FINGERPRINT_ALGORITHM_PREFIX, fingerprint } from "./fingerprint.js";
// Deep immutability for contract values (M2-T2; ADR-0032). What makes "jobs
// are immutable after execution begins" reach a nested budget or grant.
export { deepFreeze } from "./freeze.js";
// The public entry point (M1-T4).
export type {
  AbortedHarnessRunResult,
  Clock,
  CompletedHarnessRunResult,
  CreateHarnessOptions,
  FailedHarnessRunResult,
  Harness,
  HarnessRunInput,
  HarnessRunResult,
} from "./harness.js";
export { createHarness } from "./harness.js";
// The identifier and version rules shared by `defineDomain()` and the
// capability registry.
export { isCapabilityIdentifier, isExactVersion } from "./identifiers.js";
// Entity identifiers: the sortable UUIDv7 scheme and its twelve brands
// (M2-T1; ADR-0030).
export type {
  AttemptId,
  CompilerRunId,
  DecisionId,
  EntityId,
  EntityKind,
  EvalRunId,
  JobId,
  LearningRunId,
  NodeExecutionId,
  PromotionId,
  RunId,
  TraceEventId,
  WorkflowId,
  WorkflowVersionId,
} from "./ids.js";
export {
  ENTITY_ID_MESSAGE,
  ENTITY_ID_PATTERN,
  ENTITY_ID_SCHEME,
  ENTITY_KINDS,
  entityIdTimestamp,
  entityIdTimestampMs,
  isEntityId,
  newAttemptId,
  newCompilerRunId,
  newDecisionId,
  newEvalRunId,
  newJobId,
  newLearningRunId,
  newNodeExecutionId,
  newPromotionId,
  newRunId,
  newTraceEventId,
  newWorkflowId,
  newWorkflowVersionId,
  parseEntityId,
} from "./ids.js";
// The immutable unit of work (M1-T3; finalized by M2-T2, ADR-0032).
export type { Job, JobContracts } from "./job.js";
export { isJob, parseJob } from "./job.js";
// JSON value model, and the runtime guards M2-T2's boundary validator needs.
export type { JsonArray, JsonObject, JsonPrimitive, JsonValue } from "./json.js";
export { isJsonObject, isJsonValue, isPlainObject } from "./json.js";
// The schema boundary: a harness-owned copy of Standard Schema v1, so that a
// domain can author schemas in any conforming library while this package keeps
// zero dependencies (ADR-0027).
export type {
  InferSchemaInput,
  InferSchemaOutput,
  Schema,
  SchemaFailureResult,
  SchemaIssue,
  SchemaPathSegment,
  SchemaProps,
  SchemaResult,
  SchemaSuccessResult,
  SchemaTypes,
  ValidateWithOptions,
} from "./schema.js";
export { assertIsSchema, isSchema, validateWith } from "./schema.js";
// The `Storage` port (M2-T5) and the outcome ledger row (M2-T7; ADR-0036).
// Declared here, implemented by `@internal/storage-supabase` and by
// `createInMemoryStorage()` in `@internal/testing`, because "core cannot import
// Supabase" (build plan section 4).
export type {
  RunFilter,
  RunFinish,
  RunListCursor,
  RunPage,
  RunRecord,
  RunStart,
  RunStatus,
  SetWorkflowVersionStatusInput,
  Storage,
  TraceCursor,
  TracePage,
  WorkflowVersionFilter,
  WorkflowVersionListCursor,
  WorkflowVersionPage,
} from "./storage.js";
export {
  DEFAULT_RUN_PAGE_SIZE,
  DEFAULT_TRACE_PAGE_SIZE,
  DEFAULT_WORKFLOW_VERSION_PAGE_SIZE,
  isRunStatus,
  MAX_PAGE_SIZE,
  parseRunRecord,
  RUN_STATUSES,
  resolvePageLimit,
} from "./storage.js";
// The trace contract (M2-T3) and the run-scoped recorder that owns a run's
// event order (M2-T3/M2-T4; ADR-0031). `TraceWriter` is the interface M2-T4
// states verbatim; the buffered implementation lives in `@internal/trace`.
export type {
  CreateTraceRecorderOptions,
  TraceClock,
  TraceEvent,
  TraceEventInput,
  TraceEventType,
  TraceEventUsage,
  TraceEventVersion,
  TraceRecorder,
  TraceSpan,
  TraceSpanEndInput,
  TraceWriter,
} from "./trace.js";
export {
  createNoopTraceWriter,
  createTraceRecorder,
  isTraceEventType,
  // The read boundary for a stored, replayed or JSONL-sourced event (M2-T10),
  // beside `parseJob` and `parseRunRecord`. A recorder is the only minter; this
  // is the only way back in.
  parseTraceEvent,
  TRACE_EVENT_TYPES,
  TRACE_EVENT_VERSION,
} from "./trace.js";
// The `verify` primitive (M3-T7; ADR-0045). Engine-agnostic by construction: it
// compiles an output's configured fields into boolean questions and reads the
// answers back as repair instructions, and knows nothing about what answers
// them.
export type {
  CompiledVerification,
  CompileVerificationConfig,
  ResolvedVerificationField,
  UnsupportedVerificationField,
  VerificationFieldConfig,
  VerificationReading,
} from "./verify.js";
export {
  compileVerification,
  DEFAULT_VERIFICATION_QUESTION_ID,
  DEFAULT_VERIFICATION_QUESTION_VERSION,
  readVerification,
} from "./verify.js";

// The serializable workflow IR (M4-T1) and the fallback envelope (ADR-0038).
// Core declares the contract and its parse boundary; `@internal/workflow`
// implements validation, the DSL and the local runtime over it, the same split
// `@internal/trace` follows.
export type {
  FallbackContext,
  FallbackReason,
  WorkflowDefinition,
} from "./workflow-ir.js";
export {
  canonicalWorkflowIr,
  FALLBACK_REASONS,
  isWorkflowDefinition,
  parseWorkflowDefinition,
  WORKFLOW_SCHEMA_VERSION,
  workflowFingerprint,
} from "./workflow-ir.js";

// The node contracts (M4-T2), the node types (M4-T3) and the control shapes
// (M4-T4), including the `call` node's idempotency declarations (M4-T7) and the
// per-node tool grants (M4-T8).
export type {
  AgentNode,
  ArtifactNode,
  Binding,
  BindingFromInput,
  BindingFromItem,
  BindingFromNode,
  BindingKind,
  BindingLiteral,
  BindingObject,
  BranchNode,
  BranchOnField,
  BranchOnPolicy,
  BranchSelector,
  CallEffect,
  CallNode,
  ChainNode,
  CodeNode,
  ControlNodeType,
  EscalateNode,
  JevNode,
  JevQuestionKind,
  LoopCondition,
  LoopNode,
  LoopUntilField,
  LoopUntilPolicy,
  MapNode,
  NodeCapabilityRef,
  NodeId,
  NodeProtection,
  ReduceNode,
  ReservedNodeType,
  RetryPolicy,
  WorkflowNode,
  WorkflowNodeBase,
  WorkflowNodeType,
} from "./workflow-nodes.js";
export {
  BINDING_KINDS,
  CALL_EFFECTS,
  CONTROL_NODE_TYPES,
  isNodeId,
  JEV_QUESTION_KINDS,
  MAX_BINDING_DEPTH,
  NODE_TYPES,
  RESERVED_NODE_TYPES,
} from "./workflow-nodes.js";

// The workflow registry model (M5-T1) and the compatibility selector (M5-T2;
// ADR-0043). Core declares the statuses, the transition table, what a version
// declares about the jobs it can handle, and the pure function that picks one;
// `@internal/registry` is the service that stores and promotes them, the same
// split `@internal/trace` and `@internal/workflow` follow.
export type {
  CompiledWorkflowLike,
  DescribeWorkflowCompatibilityOptions,
  WorkflowCompatibility,
  WorkflowPromotionRecord,
  WorkflowRecord,
  WorkflowRejection,
  WorkflowRejectionReason,
  WorkflowSelection,
  WorkflowSelectionEnvironment,
  WorkflowStatus,
  WorkflowVersionRecord,
} from "./workflow-registry.js";
export {
  canTransition,
  collectRequiredCapabilities,
  compareExactVersions,
  describeWorkflowCompatibility,
  isWorkflowStatus,
  parseWorkflowPromotionRecord,
  parseWorkflowRecord,
  parseWorkflowVersionRecord,
  selectCompatibleWorkflow,
  WORKFLOW_REJECTION_REASONS,
  WORKFLOW_STATUS_TRANSITIONS,
  WORKFLOW_STATUSES,
} from "./workflow-registry.js";
