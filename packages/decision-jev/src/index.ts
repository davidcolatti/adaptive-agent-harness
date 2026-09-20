// The Jev decision adapter (M3-T2).
//
// `@internal/core` declares the decision contract; this package is the only one
// that may import the AI SDK's experimental evaluation API, per the build
// plan's Milestone 3 ("Keep that experimental API isolated inside the adapter
// package") and `tests/architecture/boundaries.ts`, which lists this package
// among the declared adapters allowed to depend on `ai`.
//
// Re-exports are listed by name rather than starred, so this file states the
// package's public surface and a symbol becomes public deliberately.
export type {
  CreateJevDecisionEngineOptions,
  JevDecisionEngine,
  JevHeaders,
  JevProviderOptions,
} from "./jev-decision-engine.js";
export {
  createJevDecisionEngine,
  DEFAULT_STRING_MODEL_PROVIDER,
  JEV_GATEWAY_MODEL_ID,
} from "./jev-decision-engine.js";
