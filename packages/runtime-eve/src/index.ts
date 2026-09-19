// Adapter boundary for the `eve` agent framework.
//
// `EveAgentRuntime` is M1-T6; this package is deliberately empty of behaviour
// until then. The single re-export below is a typed smoke surface: it proves
// that the documented public entrypoint `eve` resolves and typechecks from
// this package, and nothing more. No `eve` session detail may leak past this
// package into `@internal/core` (build plan section 4, ADR-0003).
//
// `AgentDefinition` is a documented public export of the `eve` root
// entrypoint:
//   node_modules/eve/docs/reference/typescript-api.md ("Imports at a glance",
//   row `eve`) and node_modules/eve/dist/src/public/index.d.ts.
export type { AgentDefinition as EveAgentDefinition } from "eve";
