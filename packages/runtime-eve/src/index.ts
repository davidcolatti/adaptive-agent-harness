// The public surface of `@internal/runtime-eve`: the `eve` adapter.
//
// `EveAgentRuntime` (M1-T6) is the first real `AgentRuntime`. Everything `eve`
// knows stops here: no `MessageStreamEvent`, no `MessageResult`, no
// `ClientSession` is re-exported, and the only `eve` identifiers that leave the
// package are the option types a caller needs to configure a `Client` and the
// opaque session/turn ids that travel inside `RuntimeInfo.metadata` and trace
// payloads (build plan section 4, ADR-0003).
//
// The server-spawning helper is deliberately **not** here. It lives behind the
// `./testing` subpath, so importing the adapter never pulls in
// `node:child_process` and nothing about a production caller suggests the
// adapter manages processes (ADR-0028).
//
// Re-exports are listed by name rather than starred, so a symbol becomes public
// deliberately.

// `AgentDefinition` is a documented public export of the `eve` root entrypoint
// (`eve/docs/reference/typescript-api.md`, "Imports at a glance"). It predates
// the adapter and is kept because it is the one `eve` type a consuming domain
// legitimately names when authoring an agent.
export type { AgentDefinition as EveAgentDefinition } from "eve";
export type {
  EveAgentRuntimeOptions,
  EveClientLike,
  EveClock,
  EveDomainOutputSchema,
  EveTurnResponse,
} from "./eve-agent-runtime.js";
export { EveAgentRuntime, eveVersion } from "./eve-agent-runtime.js";
// The tool id the adapter uses for eve's framework `load_skill` action, which
// carries no name of its own on the wire. Exported so a domain can write the
// matching `ToolGrant` without guessing.
export { LOAD_SKILL_TOOL_ID } from "./eve-events.js";
