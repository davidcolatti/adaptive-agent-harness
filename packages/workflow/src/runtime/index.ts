// The local deterministic workflow runtime (M4-T3, M4-T6, M4-T7, M4-T8).
//
// This barrel is the runtime half of `@internal/workflow`'s public surface; the
// package's own `src/index.ts` re-exports it by name. Re-exports are listed
// rather than starred, so a symbol becomes public deliberately.

export type { BindingItem, BindingScope } from "./bindings.js";
export { asJsonValue, evaluateBinding, readPath } from "./bindings.js";
export type { BudgetLedger, BudgetTotals } from "./budget.js";
export { createBudgetLedger, narrowBudget } from "./budget.js";
export { assertGrantsWithinJob, assertToolGranted, requiredMode } from "./grants.js";
export type { IdempotencyCoordinates } from "./idempotency.js";
export { attemptIdempotencyKey, NO_ITEM_INDEX, protectionIdempotencyKey } from "./idempotency.js";
export type {
  ArtifactSaveInput,
  ArtifactStorePort,
  InMemoryArtifact,
  InMemoryArtifactStore,
  InMemoryProtectedEffectStore,
  ProtectedEffectRecord,
  ProtectedEffectStore,
  SavedArtifact,
  WorkflowDecisionPort,
  WorkflowDecisionRequest,
} from "./ports.js";
export { createInMemoryArtifactStore, createInMemoryProtectedEffectStore } from "./ports.js";
export type {
  AbortedWorkflowRun,
  CompletedWorkflowRun,
  CreateWorkflowRuntimeOptions,
  EscalatedWorkflowRun,
  FailedWorkflowRun,
  NodeExecutionRecord,
  WorkflowRunResult,
  WorkflowRuntime,
} from "./workflow-runtime.js";
export { createWorkflowRuntime, fallbackContextPayload } from "./workflow-runtime.js";
