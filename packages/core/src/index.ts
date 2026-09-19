// The public surface of `@internal/core`.
//
// Milestone 1 fills this package with the contracts specified in
// `docs/milestones/build-plan.md` section 5. Two of them exist so far: the
// execution context (M1-T7) and the error taxonomy (M1-T8). `Job`,
// `DomainDefinition`, `AgentRuntime` and `CapabilityRegistry` land in M1-T3
// through M1-T6 and M1-T9.
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
export { createExecutionContext } from "./context.js";

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

// JSON value model.
export type { JsonArray, JsonObject, JsonPrimitive, JsonValue } from "./json.js";

// Trace boundary. The full event schema is M2-T3; `TraceWriter` is stated by
// M2-T4 and declared here because the execution context has to hold one.
export type { TraceEvent, TraceWriter } from "./trace.js";
export { createNoopTraceWriter } from "./trace.js";
