// Adapter boundary for the Vercel AI SDK (`ai`).
//
// The `AgentRuntime` contract is M1-T5; this package is deliberately empty of
// behaviour until then. The single re-export below is a typed smoke surface:
// it proves that the documented public entrypoint `ai` resolves and typechecks
// from this package, and nothing more. AI SDK concepts stop here and must not
// appear in `@internal/core` (build plan section 4, ADR-0003).
//
// `LanguageModel` is a documented public export of the `ai` root entrypoint:
//   node_modules/ai/dist/index.d.ts (final `export { ... }`, `type LanguageModel`)
//   and node_modules/ai/docs/02-foundations/02-providers-and-models.mdx.
export type { LanguageModel as AiSdkLanguageModel } from "ai";
