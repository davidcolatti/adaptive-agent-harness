This directory is reserved for dated Vercel-specific research notes, per AD-011
(`docs/decisions/0011-no-vercel-implementation-detail-may-be-guessed.md`), following the naming
convention `docs/research/vercel/YYYY-MM-DD-<slug>.md` and covering findings about packages such as
`eve`, the AI SDK, the Workflow SDK, or `@vercel/sandbox`.

- [`2026-09-19-m1-eve-ai-sdk-install-survey.md`](2026-09-19-m1-eve-ai-sdk-install-survey.md):
  written by M1-T1, the task that installed `eve` 0.63.0 and `ai` 7.0.107. Covers the installed
  versions and peer dependencies, the eve/ai compatibility finding, the inventory of the docs
  `eve` ships, both public export maps, the `eve` CLI surface, and the explicit list of behaviour
  that is not provided publicly and must therefore be harness-owned.

- [`2026-09-19-m1-eve-project-scaffold.md`](2026-09-19-m1-eve-project-scaffold.md): written by
  M1-T2, the task that scaffolded `apps/example-agent` as a real `eve` project. Covers the authored
  filesystem layout the installed docs define, path-derived capability naming, the `define*`
  surface actually used and the declaration files that establish it, the absence of any read-only
  or side-effect flag on a tool definition, the `.js`-extension finding for relative imports,
  eve's optional default tools (including the live web tools this fixture domain disables), the
  exact `eve info` and `eve build` output, and the questions M1-T4 and M1-T6 still have to answer.

- [`2026-09-19-m1-eve-programmatic-execution.md`](2026-09-19-m1-eve-programmatic-execution.md):
  the M1-T6 research checkpoint, answering how a TypeScript caller drives an `eve` agent. Records
  that `eve` 0.63.0 exposes no in-process run API and that `eve/client` over HTTP against a running
  server is the documented surface (eve's own Next/Nuxt/SvelteKit adapters spawn one as a child
  process); covers per-turn `outputSchema`, `mockModel` as the credential-free test double, turn
  cancellation through `MessageResponse.cancel()`, the `step.completed` usage and cost fields the
  harness must aggregate itself, why per-run tool permissions and `Job.budget` have no eve
  equivalent, what a run writes under `.eve/`, the built-in `agent` tool's cost at zero subagents,
  and a recommended `EveAgentRuntime` design with every step marked documented or harness-owned.

- [`2026-09-20-m3-ai-sdk-evaluate.md`](2026-09-20-m3-ai-sdk-evaluate.md): the M3-T1/M3-T2 research
  checkpoint, answering what the installed AI SDK evaluation API actually provides. Covers the three
  question kinds and their criteria and answer shapes, when a probability distribution is present
  and when it is optional, the SDK's own statement that no portable confidence measure exists, the
  absence of any cost field (which constrains M3-T3), the four documented ways to name an
  evaluation model and `@ai-sdk/gateway`'s confirmation that Jev is `typesafe-ai/jev`, the
  before-any-I/O unsupported-question-kind error, two facts read from the compiled `evaluate`
  implementation because the types leave them open, batching by shared state, and the explicit list
  of what Milestone 3 must own because the API does not provide it.

- [`2026-09-20-m5-eve-client-context-for-fallback.md`](2026-09-20-m5-eve-client-context-for-fallback.md):
  the M5-T6 research checkpoint, answering which documented eve surface carries a fallback envelope
  to a full agent. Records that the turn's `clientContext` is the one: an object is JSON-serialized
  into a single user-role context message that is present on every model call of the turn and then
  discarded, and is never persisted to durable session history, which is exactly a one-shot
  escalation's lifetime. Covers the wire type
  (`string | readonly string[] | JsonObject`), the constraint that message-free session creation
  accepts no turn-scoped `clientContext`, the absence of any documented size limit in 0.63.0, which
  parts are therefore harness-owned (the `harness.fallback` key and the envelope's shape), and the
  four rejected alternatives — the message text, user-role instructions, the sandbox workspace and
  session state — each with the installed-doc sentence that rules it out.

The Workflow SDK and `@vercel/sandbox` are still not installed, so no note covers them yet.
