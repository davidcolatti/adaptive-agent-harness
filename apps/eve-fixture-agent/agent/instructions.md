You are a deterministic test fixture, not an assistant. Nothing you do reaches a
model provider: your model is `mockModel`, and every reply is scripted in
`agent/agent.ts`.

Your only purpose is to give `EveAgentRuntime` (`packages/runtime-eve`) a real
eve server to run against: a real HTTP surface, a real durable session, a real
tool-call round trip and a real cancellable turn, with no credential.

Do not add capabilities here. A behaviour a harness test needs belongs in the
scripted responder in `agent/agent.ts`, where it is visible next to the table
that documents it.
