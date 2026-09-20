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
// An in-memory `Storage` (M2-T5). A real implementation of the port, not a
// stub: it runs the same `storage.contract.test.ts` suite as the Supabase one.
export type { InMemoryStorage } from "./in-memory-storage.js";
export { createInMemoryStorage } from "./in-memory-storage.js";
export type { RecordingTraceWriter } from "./recording-trace-writer.js";
export { createRecordingTraceWriter } from "./recording-trace-writer.js";
