// `@internal/runtime-eve/testing`: the pieces a caller needs to run the adapter
// against a real `eve` server, kept out of the package's main entrypoint.
//
// Separate because `startEveDevServer()` imports `node:child_process` and
// spawns a process, and `EveAgentRuntime` does neither (ADR-0028). A production
// caller importing the adapter should not acquire either capability by
// accident, and the import path should say which one it is asking for.

export type { EveDevServer, StartEveDevServerOptions } from "./dev-server.js";
export { readRecordedDevServerUrl, startEveDevServer } from "./dev-server.js";
