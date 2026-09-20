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

export type {
  CreateWorkflowRegistryOptions,
  FindActiveOptions,
  PromoteWorkflowOptions,
  RegisterWorkflowOptions,
  WorkflowRegistry,
} from "./workflow-registry.js";
export { createWorkflowRegistry, HARNESS_VERSION } from "./workflow-registry.js";
