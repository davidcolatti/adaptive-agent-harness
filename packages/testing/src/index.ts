export type { CreateFakeClockOptions, FakeClock } from "./clock.js";
export { createFakeClock } from "./clock.js";
export type {
  CreateFakeAgentRuntimeOptions,
  FakeAgentRuntime,
  FakeAgentRuntimeBehaviour,
  FakeAgentRuntimeCall,
  FakeAgentRuntimeHandler,
  FakeAgentRuntimeHandlerOptions,
  FakeAgentRuntimeResultOptions,
} from "./fake-agent-runtime.js";
export { createFakeAgentRuntime } from "./fake-agent-runtime.js";
// A scripted `DecisionEngine` (M3-T2). The default engine for a decision test:
// Milestone 3 requires that "decision tests use fake engines by default; live
// Jev tests are explicitly tagged".
export type {
  CreateFakeDecisionEngineOptions,
  FakeDecisionEngine,
  FakeDecisionEngineCall,
  FakeDecisionScript,
  ScriptedAnswer,
} from "./fake-decision-engine.js";
export { createFakeDecisionEngine } from "./fake-decision-engine.js";
// An in-memory `Storage` (M2-T5). A real implementation of the port, not a
// stub: it runs the same `storage.contract.test.ts` suite as the Supabase one.
export type { InMemoryStorage } from "./in-memory-storage.js";
export { createInMemoryStorage } from "./in-memory-storage.js";
export type { RecordingTraceWriter } from "./recording-trace-writer.js";
export { createRecordingTraceWriter } from "./recording-trace-writer.js";
