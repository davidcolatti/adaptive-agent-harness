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
// result type the rest of Milestone 4 hands between its halves. Still to come:
// `compileWorkflow()` (M4-T4, M4-T9), the typed DSL (M4-T5) and the local
// interpreter (M4-T6).
//
// The package declares no third-party dependency and must keep none; it is not
// an adapter, so `tests/architecture/boundaries.ts` gives it the same bans
// `@internal/core` carries.
//
// Re-exports are listed by name rather than starred, so a symbol becomes public
// deliberately.

export type { CompiledWorkflow } from "./compiled.js";
