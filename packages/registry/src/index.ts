// The public surface of `@internal/registry` (M5-T1, M5-T2).
//
// The workflow registry service: it registers a `CompiledWorkflow` as a draft
// version, promotes and retires versions through the `Storage` port's
// compare-and-set, and answers "which active version can serve this job?" with
// core's pure `selectCompatibleWorkflow()`.
//
// The model itself — the seven statuses, the transition table,
// `WorkflowCompatibility`, the records and the selector — lives in
// `@internal/core`, because it is a contract and core is where contracts are
// declared (ADR-0043). This package is the half that needs a `Storage`.
//
// Re-exports are listed by name rather than starred, so this file states the
// package's public surface and a symbol becomes public deliberately.

// The rolling-window circuit breaker (M5-T7). `evaluate()` reads the last N
// runs of one version through the `Storage` port and reports; `trip()` retires
// the version through the registry. Nothing calls `trip()` on a timer: AD-005
// keeps a human in front of every status change.
export type {
  CircuitBreaker,
  CircuitBreakerReading,
  CircuitBreakerThresholds,
  CircuitBreakerWindow,
  CreateCircuitBreakerOptions,
} from "./circuit-breaker.js";
export { createCircuitBreaker } from "./circuit-breaker.js";
// The router (M5-T3 through M5-T6). It **is** an `AgentRuntime`, so
// `createHarness({ agentRuntime: router })` needs no new option: the same
// harness call executes either the compiled workflow or the full agent, and an
// escalation reaches the full agent with what the workflow established.
// ADR-0044 records the composition, the fallback contract and the trace link.
export type {
  CreateRouterOptions,
  RouteDecision,
  RouteRefusal,
  Router,
} from "./router.js";
export {
  capFallbackOutputs,
  createRouter,
  FALLBACK_ENVELOPE_MAX_BYTES,
  remainingBudgetAfter,
} from "./router.js";
export type {
  CreateWorkflowRegistryOptions,
  FindActiveOptions,
  PromoteWorkflowOptions,
  RegisterWorkflowOptions,
  WorkflowRegistry,
} from "./workflow-registry.js";
export { createWorkflowRegistry, HARNESS_VERSION } from "./workflow-registry.js";
