// The public surface of `@internal/core`.
//
// Milestone 1 fills this package with the contracts specified in
// `docs/milestones/build-plan.md` section 5. Present so far: the execution
// context (M1-T7), the error taxonomy (M1-T8), the schema boundary, `Job`,
// `DomainDefinition` and `defineDomain()` (M1-T3), `AgentRuntime` with
// `AgentExecution` (M1-T5), `createHarness()` (M1-T4), and the capability
// registry with its canonical-JSON fingerprint scheme (M1-T9).
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

// The immutable unit of work (M1-T3; M2-T2 finalizes the schema).
export type { Job, JobContracts } from "./job.js";

// JSON value model.
export type { JsonArray, JsonObject, JsonPrimitive, JsonValue } from "./json.js";

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

// Trace boundary. The full event schema is M2-T3; `TraceWriter` is stated by
// M2-T4 and declared here because the execution context has to hold one.
export type { TraceEvent, TraceWriter } from "./trace.js";
export { createNoopTraceWriter } from "./trace.js";
